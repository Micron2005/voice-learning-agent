import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { requireThat, Store } from "./store.js";

export class PrivateAudio {
  key: Buffer;
  constructor(public store: Store) {
    const path = join(store.dir, ".audio-key");
    if (!existsSync(path)) {
      try {
        writeFileSync(path, randomBytes(32), { mode: 0o600, flag: "wx" });
      } catch (e) {
        if (!existsSync(path)) throw e;
      }
    }
    this.key = readFileSync(path);
  }
  put(id: string, bytes: Buffer) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
    writeFileSync(
      join(this.store.dir, `${id}.audio`),
      Buffer.concat([iv, cipher.getAuthTag(), encrypted]),
      { mode: 0o600 },
    );
  }
  read(id: string) {
    requireThat(/^[a-f0-9-]{36}$/.test(id), "invalid_asset", "Invalid asset.");
    const b = readFileSync(join(this.store.dir, `${id}.audio`));
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      b.subarray(0, 12),
    );
    decipher.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([decipher.update(b.subarray(28)), decipher.final()]);
  }
  remove(id: string) {
    try {
      unlinkSync(join(this.store.dir, `${id}.audio`));
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  sign(owner: string, id: string, expires: number) {
    return createHmac("sha256", this.key)
      .update(`${owner}:${id}:${expires}`)
      .digest("hex");
  }
  verify(owner: string, id: string, expires: number, signature: string) {
    const expected = Buffer.from(this.sign(owner, id, expires));
    const actual = Buffer.from(signature);
    return (
      expires > Date.now() &&
      expires <= Date.now() + 300_000 &&
      expected.length === actual.length &&
      timingSafeEqual(expected, actual)
    );
  }
}

// Decode a copy through a bounded subprocess; original bytes remain unchanged.
export async function inspectAudio(
  input: Buffer,
): Promise<{ pcm: Buffer; report: Record<string, any> }> {
  requireThat(
    input.length <= 50 * 1024 * 1024 && input.length > 44,
    "audio_size",
    "Use a non-empty audio file under 50 MB.",
  );
  const head = input.subarray(0, 16);
  const supported =
    head.toString("ascii", 0, 4) === "RIFF" ||
    head.toString("ascii", 0, 4) === "fLaC" ||
    head.toString("ascii", 0, 3) === "ID3" ||
    head[0] === 0xff ||
    head.readUInt32BE(0) === 0x1a45dfa3 ||
    head.toString("ascii", 4, 8) === "ftyp" ||
    head.toString("ascii", 0, 4) === "OggS";
  requireThat(
    supported,
    "audio_content",
    "File content is not a supported WAV, FLAC, MP3, M4A, Ogg or WebM recording.",
  );
  const pcm = await new Promise<Buffer>((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      [
        "-nostdin",
        "-v",
        "error",
        "-protocol_whitelist",
        "pipe",
        "-i",
        "pipe:0",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-t",
        "1800",
        "-f",
        "s16le",
        "pipe:1",
      ],
      { stdio: ["pipe", "pipe", "ignore"] },
    );
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Audio inspection timed out. Use a shorter file."));
    }, 30_000);
    child.stdout.on("data", (b: Buffer) => {
      size += b.length;
      if (size > 58_000_000) child.kill("SIGKILL");
      else chunks.push(b);
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Audio decoder unavailable. Install ffmpeg."));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && size > 3200) resolve(Buffer.concat(chunks));
      else
        reject(
          new Error(
            "Audio could not be decoded, is too short, or exceeds the limit.",
          ),
        );
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
  let clipped = 0,
    silent = 0,
    sum = 0;
  const frames: number[] = [];
  for (let i = 0; i < pcm.length; i += 2) {
    const x = pcm.readInt16LE(i) / 32768;
    sum += x * x;
    if (Math.abs(x) > 0.98) clipped++;
    if (Math.abs(x) < 0.01) silent++;
  }
  for (let i = 0; i + 640 < pcm.length; i += 640) {
    let s = 0;
    for (let j = i; j < i + 640; j += 2) s += (pcm.readInt16LE(j) / 32768) ** 2;
    frames.push(Math.sqrt(s / 320));
  }
  frames.sort((a, b) => a - b);
  const noiseFloor = frames[Math.floor(frames.length * 0.1)] ?? 0;
  const count = pcm.length / 2,
    duration = count / 16000;
  const warnings = [];
  if (clipped / count > 0.001)
    warnings.push("Clipping detected: reduce microphone gain and retake.");
  if (silent / count > 0.65)
    warnings.push(
      "High silence fraction: trim long pauses in a copy or retake.",
    );
  if (Math.sqrt(sum / count) < 0.025)
    warnings.push("Low input level: move closer or gently raise gain.");
  if (noiseFloor > 0.04)
    warnings.push(
      "Elevated low-percentile energy: check background noise with headphones.",
    );
  if (duration >= 1799)
    warnings.push(
      "Inspection limit reached. Split recordings into clips shorter than 30 minutes.",
    );
  return {
    pcm,
    report: {
      duration,
      clippedFraction: clipped / count,
      silenceFraction: silent / count,
      rms: Math.sqrt(sum / count),
      noiseFloor,
      warnings,
      usable: !warnings.length,
      limitations:
        "Heuristics only. Not speaker verification, speech detection, language identification or a scientific noise score. Listen for music, multiple speakers, echo and room noise.",
    },
  };
}

export function demoWav() {
  const n = 16000,
    b = Buffer.alloc(44 + n * 2);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++)
    b.writeInt16LE(
      Math.round(
        3000 *
          Math.sin((i * 2 * Math.PI * 440) / 16000) *
          Math.sin((Math.PI * i) / n),
      ),
      44 + i * 2,
    );
  return b;
}
