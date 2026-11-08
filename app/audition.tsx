"use client";
import { useEffect, useRef, useState } from "react";

export function Audition({
  original,
  preview,
}: {
  original?: string;
  preview?: string;
}) {
  const audio = useRef<AudioContext | null>(null),
    [telephone, setTelephone] = useState(false),
    [error, setError] = useState(""),
    [playing, setPlaying] = useState("");
  useEffect(
    () => () => {
      void audio.current?.close();
    },
    [],
  );
  const stop = async () => {
    if (audio.current?.state !== "closed") await audio.current?.close();
    setPlaying("");
  };
  const play = async (src: string, name: string) => {
    try {
      await stop();
      setError("");
      const ctx = new AudioContext();
      audio.current = ctx;
      await ctx.resume();
      const response = await fetch(src);
      if (!response.ok)
        throw new Error(
          "Private audio link expired or access was revoked. Inspect the preview again.",
        );
      const decoded = await ctx.decodeAudioData(await response.arrayBuffer());
      const output = ctx.createBuffer(1, decoded.length, decoded.sampleRate),
        samples = output.getChannelData(0);
      for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
        const input = decoded.getChannelData(ch);
        for (let i = 0; i < input.length; i++)
          samples[i] += input[i] / decoded.numberOfChannels;
      }
      let sum = 0,
        peak = 0;
      for (const x of samples) {
        sum += x * x;
        peak = Math.max(peak, Math.abs(x));
      }
      const rms = Math.sqrt(sum / samples.length),
        gain = Math.min(rms > 0 ? 0.1 / rms : 1, peak > 0 ? 0.95 / peak : 1);
      for (let i = 0; i < samples.length; i++) samples[i] *= gain;
      let buffer = output;
      if (telephone) {
        const offline = new OfflineAudioContext(
            1,
            Math.ceil(output.duration * 8000),
            8000,
          ),
          source = offline.createBufferSource();
        source.buffer = output;
        const high = offline.createBiquadFilter(),
          low = offline.createBiquadFilter();
        high.type = "highpass";
        high.frequency.value = 300;
        low.type = "lowpass";
        low.frequency.value = 3400;
        source.connect(high).connect(low).connect(offline.destination);
        source.start();
        buffer = await offline.startRendering();
      }
      if (ctx.state === "closed") return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => setPlaying("");
      source.start();
      setPlaying(name);
    } catch (e: any) {
      setError(e.message);
      await stop();
    }
  };
  return (
    <section className="info">
      <h3>Matched-level comparison · non-destructive</h3>
      <p>
        Playback copies target −20 dBFS RMS, peak-limited to avoid clipping.
        Your originals are never rewritten. Quiet or unusually peaky clips may
        not reach the same level.
      </p>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={telephone}
          onChange={(e) => setTelephone(e.target.checked)}
        />
        Telephone-bandwidth simulation: 8 kHz, 300–3400 Hz
      </label>
      <div className="actions">
        <button
          disabled={!original}
          onClick={() => play(original!, "Original")}
        >
          Audition original
        </button>
        <button disabled={!preview} onClick={() => play(preview!, "Mock tone")}>
          Audition preview
        </button>
        <button onClick={stop}>Stop playback</button>
      </div>
      <p role="status">
        {playing
          ? `Playing ${playing} · ${telephone ? "telephone simulation" : "studio bandwidth"}`
          : "Not playing"}
      </p>
      <small>
        A bandwidth simulation is not a real telephone test. Mock tones cannot
        demonstrate pronunciation, likeness or naturalness.
      </small>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
