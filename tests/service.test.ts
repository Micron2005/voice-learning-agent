import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../server/store.js";
import { VoiceService } from "../server/service.js";
import { createOperator } from "../server/auth.js";
import { demoWav, inspectAudio } from "../server/private-audio.js";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "voice-test-")),
    store = new Store(dir),
    service = new VoiceService(store);
  const owner = createOperator(
    store,
    "owner@example.test",
    "Test-only password 123!",
  );
  const stranger = createOperator(
    store,
    "stranger@example.test",
    "Test-only password 456!",
  );
  service.initialize(owner);
  const v = service.createVoice(owner, "Owner voice");
  service.consent(owner, v.id, true, false);
  service.enrollSimulation(owner, v.id);
  service.tick();
  const ver = store.list(owner, "version")[0];
  service.approveVersion(owner, ver.id);
  const caller = service.caller(owner, "+12025550123");
  service.permission(owner, {
    number: "+12025550124",
    purpose: "owner-test",
    wording: "I request an owner test call.",
    source: "Owner UI test",
  });
  const input = {
    recipient: "+12025550124",
    callerId: caller.id,
    voiceVersion: ver.id,
    knowledgeVersion: store.list(owner, "knowledge")[0].id,
    purpose: "owner-test" as const,
    duration: 10,
    costCapCents: 0,
  };
  return {
    dir,
    store,
    service,
    owner,
    stranger,
    v,
    ver,
    input,
    cleanup: () => {
      store.close();
      rmSync(dir, { recursive: true });
    },
  };
}
function scenario(
  name: string,
  fn: (f: ReturnType<typeof fixture>) => void | Promise<void>,
) {
  test(name, async () => {
    const f = fixture();
    try {
      await fn(f);
    } finally {
      f.cleanup();
    }
  });
}
scenario(
  "default budget is exactly zero, live disabled, simulation labeled",
  (f) => {
    assert.equal(f.service.budget(f.owner).liveEnabled, false);
    assert.equal(f.service.budget(f.owner).remainingCents, 0);
    assert.equal(f.ver.realCloneReady, false);
    assert.match(f.store.list(f.owner, "version")[0].acceptance, /Simulation/);
  },
);
scenario("every private kind is inaccessible to a different operator", (f) => {
  for (const kind of [
    "voice",
    "version",
    "consent",
    "knowledge",
    "caller",
    "permission",
    "budget",
  ]) {
    for (const r of f.store.list(f.owner, kind))
      assert.throws(() => f.store.get(f.stranger, kind, r.id), /not found/);
    assert.equal(f.store.list(f.stranger, kind).length, 0);
  }
});
scenario("voice without ownership consent cannot enroll", (f) => {
  const v = f.service.createVoice(f.owner, "Unconsented");
  assert.throws(() => f.service.enrollSimulation(f.owner, v.id), /consent/);
  assert.throws(
    () => f.service.consent(f.owner, v.id, false, false),
    /own voice/,
  );
});
scenario(
  "revoked consent blocks previews and pending draft authorization",
  (f) => {
    const d = f.service.prepare(f.owner, f.input);
    f.service.revokeVoice(f.owner, f.v.id);
    assert.throws(
      () => f.service.preview(f.owner, f.ver.id, 0, "studio"),
      /consent/,
    );
    assert.throws(() => f.service.authorizeFromUI(f.owner, d.id), /consent/);
  },
);
scenario("unready or unapproved configuration prevents use", (f) => {
  const ver = f.store.get(f.owner, "version", f.ver.id);
  ver.ready = false;
  f.store.save(ver);
  assert.throws(() => f.service.prepare(f.owner, f.input), /not ready/);
  ver.ready = true;
  ver.approved = false;
  f.store.save(ver);
  assert.throws(() => f.service.prepare(f.owner, f.input), /Approve/);
});
scenario(
  "real voice or caller ID cannot be passed off as simulated readiness",
  (f) => {
    const c = f.store.get(f.owner, "caller", f.input.callerId);
    c.simulationOnly = false;
    c.verified = false;
    f.store.save(c);
    assert.throws(() => f.service.prepare(f.owner, f.input), /simulated calls/);
  },
);
scenario("nonzero and negative cost caps are rejected server-side", (f) => {
  for (const costCapCents of [-1, 1, 100])
    assert.throws(() =>
      f.service.prepare(f.owner, { ...f.input, costCapCents }),
    );
});
scenario(
  "purpose-specific permission and suppression checked before dialing",
  (f) => {
    assert.throws(
      () =>
        f.service.prepare(f.owner, {
          ...f.input,
          purpose: "requested-callback",
        }),
      /no active permission/,
    );
    const d = f.service.prepare(f.owner, f.input);
    f.service.authorizeFromUI(f.owner, d.id);
    f.store.add(f.owner, "suppression", { number: f.input.recipient });
    assert.throws(
      () => f.service.place(f.owner, d.id, "test-key-0001"),
      /suppressed/,
    );
  },
);
scenario(
  "grant is single-use, short-lived and bound to exact immutable draft",
  (f) => {
    const d = f.service.prepare(f.owner, f.input);
    assert.throws(
      () => f.service.place(f.owner, d.id, "test-key-0001"),
      /operator UI/,
    );
    const g = f.service.authorizeFromUI(f.owner, d.id);
    assert.ok(g.expires <= Date.now() + 120_000);
    assert.equal(f.service.authorizeFromUI(f.owner, d.id).id, g.id);
    assert.throws(
      () =>
        f.store.save({
          ...d,
          snapshot: { ...d.snapshot, recipient: "+12025550199" },
        }),
      /immutable/,
    );
    for (const change of [
      { recipient: "+12025550199" },
      { voiceVersion: f.stranger },
      { knowledgeVersion: f.stranger },
      { costCapCents: 1 },
    ]) {
      assert.throws(() => {
        const different = f.service.prepare(f.owner, { ...f.input, ...change });
        f.service.place(f.owner, different.id, "changed-key-01");
      });
    }
    const g2 = f.store.get(f.owner, "grant", g.id);
    g2.expires = Date.now() - 1;
    f.store.save(g2);
    assert.throws(
      () => f.service.place(f.owner, d.id, "test-key-0001"),
      /operator UI/,
    );
  },
);
scenario(
  "new script version needs fresh authorization; existing draft remains exact",
  (f) => {
    const d = f.service.prepare(f.owner, f.input);
    f.service.authorizeFromUI(f.owner, d.id);
    const k = f.service.saveKnowledge(
      f.owner,
      "Updated owner product facts. The agent must still identify itself as an AI and ask permission.",
    );
    const fresh = f.service.prepare(f.owner, {
      ...f.input,
      knowledgeVersion: k.id,
    });
    assert.notEqual(fresh.fingerprint, d.fingerprint);
    assert.throws(
      () => f.service.place(f.owner, fresh.id, "new-script-01"),
      /operator UI/,
    );
    assert.equal(
      f.store.get(f.owner, "draft", d.id).snapshot.knowledge.id,
      f.input.knowledgeVersion,
    );
  },
);
scenario(
  "idempotency prevents duplicate calls and does not allow key reuse for another draft",
  (f) => {
    const d = f.service.prepare(f.owner, f.input);
    f.service.authorizeFromUI(f.owner, d.id);
    const c = f.service.place(f.owner, d.id, "test-key-0001");
    assert.equal(f.service.place(f.owner, d.id, "test-key-0001").id, c.id);
    assert.equal(f.store.list(f.owner, "call").length, 1);
    assert.throws(
      () => f.service.place(f.owner, d.id, "test-key-0002"),
      /One active/,
    );
    const d2 = f.service.prepare(f.owner, f.input);
    assert.throws(
      () => f.service.place(f.owner, d2.id, "test-key-0001"),
      /different draft/,
    );
    f.service.stop(f.owner, c.id);
    assert.throws(
      () => f.service.place(f.owner, d.id, "test-key-0002"),
      /operator UI|already exists/,
    );
  },
);
scenario("one active or uncertain call allowed; no automatic redial", (f) => {
  const d = f.service.prepare(f.owner, f.input);
  f.service.authorizeFromUI(f.owner, d.id);
  const c = f.service.place(f.owner, d.id, "test-key-0001");
  c.state = "unknown";
  f.store.save(c);
  const d2 = f.service.prepare(f.owner, f.input);
  f.service.authorizeFromUI(f.owner, d2.id);
  assert.throws(
    () => f.service.place(f.owner, d2.id, "test-key-0002"),
    /One active/,
  );
});
scenario(
  "refusal terminates, suppresses future calls and is idempotent",
  (f) => {
    const d = f.service.prepare(f.owner, f.input);
    f.service.authorizeFromUI(f.owner, d.id);
    const c = f.service.place(f.owner, d.id, "test-key-0001");
    assert.equal(f.service.stop(f.owner, c.id, true).state, "stopped");
    f.service.stop(f.owner, c.id, true);
    f.service.tick();
    assert.equal(f.store.list(f.owner, "suppression").length, 1);
    assert.equal(
      f.service.permissionStatus(f.owner, f.input.recipient).allowed,
      false,
    );
    assert.throws(() => f.service.prepare(f.owner, f.input), /suppressed/);
    assert.equal(f.store.get(f.owner, "call", c.id).state, "stopped");
  },
);
scenario(
  "kill switch stops queued calls and blocks preview and call operations",
  (f) => {
    const d = f.service.prepare(f.owner, f.input);
    f.service.authorizeFromUI(f.owner, d.id);
    const c = f.service.place(f.owner, d.id, "test-key-0001");
    f.service.kill(f.owner, true);
    assert.equal(f.store.get(f.owner, "call", c.id).state, "stopped");
    assert.throws(() => f.service.prepare(f.owner, f.input), /kill switch/);
    assert.throws(
      () => f.service.preview(f.owner, f.ver.id, 0, "studio"),
      /kill switch/,
    );
    assert.equal(f.service.budget(f.owner).reservedCents, 0);
  },
);
scenario(
  "mock preview produces encrypted private audio, never clone evidence",
  (f) => {
    const p = f.service.preview(f.owner, f.ver.id, 0, "studio");
    f.service.tick();
    const result = f.service.previewResult(f.owner, p.id);
    assert.equal(result.state, "ready");
    assert.match(result.label, /not your voice clone/);
    const original = f.service.audio.read(result.audioId);
    assert.equal(original.toString("ascii", 0, 4), "RIFF");
    assert.notEqual(
      readFileSync(join(f.dir, `${result.audioId}.audio`)).toString(
        "ascii",
        0,
        4,
      ),
      "RIFF",
    );
    const expiry = Date.now() + 120000,
      sig = f.service.audio.sign(f.owner, result.audioId, expiry);
    assert.ok(f.service.audio.verify(f.owner, result.audioId, expiry, sig));
    assert.ok(!f.service.audio.verify(f.stranger, result.audioId, expiry, sig));
    assert.ok(
      !f.service.audio.verify(f.owner, result.audioId, Date.now() - 1, sig),
    );
    f.service.revokeVoice(f.owner, f.v.id);
    assert.throws(() => f.service.previewResult(f.owner, p.id), /consent/);
  },
);
scenario(
  "delete generated audio invalidates preview and signed downloads",
  (f) => {
    const p = f.service.preview(f.owner, f.ver.id, 0, "studio");
    f.service.tick();
    const result = f.service.previewResult(f.owner, p.id);
    f.service.deleteAsset(f.owner, result.audioId);
    assert.equal(f.service.previewResult(f.owner, p.id).state, "deleted");
    assert.throws(() => f.service.audio.read(result.audioId));
  },
);
scenario(
  "practice ratings are entered by owner, never fabricated or accepted as real voice evidence",
  (f) => {
    assert.equal(f.store.list(f.owner, "rating").length, 0);
    const p = f.service.preview(f.owner, f.ver.id, 0, "studio");
    f.service.tick();
    const r = f.service.rate(f.owner, {
      previewId: p.id,
      likeness: 1,
      naturalness: 2,
      pronunciation: 1,
      consistency: 2,
      materialError: true,
      notes: "Practice only",
      telephone: false,
    });
    assert.equal(r.simulated, true);
    assert.equal(r.likeness, 1);
  },
);
scenario(
  "audio quality validates file content and reports duration; originals unchanged",
  async (_f) => {
    await assert.rejects(
      () =>
        inspectAudio(
          Buffer.from(
            "This is not an audio file but has enough bytes to look like an upload.",
          ),
        ),
      /File content/,
    );
    const input = demoWav(),
      before = Buffer.from(input);
    const result = await inspectAudio(input);
    assert.ok(Math.abs(result.report.duration - 1) < 0.01);
    assert.deepEqual(input, before);
    assert.match(result.report.limitations, /Not speaker verification/);
  },
);
scenario(
  "database and queued work survive restart without duplicate enrollment",
  (f) => {
    const second = new Store(f.dir),
      s2 = new VoiceService(second);
    s2.tick();
    s2.tick();
    assert.equal(second.list(f.owner, "version").length, 1);
    assert.equal(second.list(f.owner, "voice").length, 1);
    second.close();
  },
);
