import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  ElevenLabsAdapter,
  TwilioAdapter,
  paidPreflight,
  verifyElevenWebhook,
  acceptProviderEvent,
  latencyReport,
  type LivePermit,
} from "../server/providers.js";
import { Store } from "../server/store.js";
import { createOperator } from "../server/auth.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const permit: LivePermit = {
  operatorApproved: true,
  providerUploadApproved: true,
  identityVerified: true,
  modelCompatible: true,
  knowledgeConfirmed: true,
  callerVerified: true,
  recipientPermitted: true,
  suppressed: false,
  retentionReviewed: true,
  capCents: 100,
  reservedCents: 50,
  estimateCents: 20,
};
test("billable operations require owner approval, access checks and positive unreserved budget", () => {
  paidPreflight(permit);
  for (const diff of [
    { capCents: 0 },
    { operatorApproved: false },
    { retentionReviewed: false },
    { modelCompatible: false },
    { estimateCents: 0 },
    { estimateCents: 51 },
    { reservedCents: -1 },
    { capCents: Infinity },
    { capCents: 1.5 },
    { reservedCents: NaN },
  ])
    assert.throws(() => paidPreflight({ ...permit, ...diff }));
});
test("provider metadata is model-specific; stored ID does not mean clone ready", async () => {
  const p = new ElevenLabsAdapter("test-key-not-secret", async () =>
    Response.json({
      voice_id: "voice_1",
      is_owner: true,
      category: "professional",
      fine_tuning: { state: { eleven_multilingual_v2: "fine_tuned" } },
    }),
  );
  assert.equal(
    (await p.voiceStatus("voice_1", "eleven_flash_v2_5")).readiness,
    "not_ready",
  );
  assert.equal(
    (await p.voiceStatus("voice_1", "eleven_multilingual_v2")).compatible,
    true,
  );
});
test("provider timeout never retries a possibly accepted call", async () => {
  let requests = 0;
  const p = new ElevenLabsAdapter("test-key-not-secret", async () => {
    requests++;
    throw new Error("timeout");
  });
  await assert.rejects(
    () => p.createCall("agent_1", "phone_1", "+12025550123", permit),
    /Do not repeat/,
  );
  assert.equal(requests, 1);
});
test("native outbound request disables both recording flags and queued is not connected", async () => {
  const p = new ElevenLabsAdapter("test-key-not-secret", async (url, init) => {
    assert.equal(
      String(url),
      "https://api.elevenlabs.io/v1/convai/twilio/outbound-call",
    );
    const body = JSON.parse(init!.body as string);
    assert.equal(body.call_recording_enabled, false);
    assert.equal(
      body.telephony_call_config.twilio_call_recording_enabled,
      false,
    );
    return Response.json({
      success: true,
      conversation_id: "conv_1",
      callSid: `CA${"1".repeat(32)}`,
    });
  });
  const c = await p.createCall("agent_1", "phone_1", "+12025550123", permit);
  assert.equal(c.state, "queued");
  assert.match(c.evidence, /not a connected/);
  await assert.rejects(
    () =>
      p.createCall("agent_1", "phone_1", "+12025550123", {
        ...permit,
        suppressed: true,
      }),
    /unsuppressed/,
  );
});
test("provider errors are actionable and never leak credentials or raw response", async () => {
  const p = new ElevenLabsAdapter(
    "test-secret-marker",
    async () =>
      new Response("internal credential test-secret-marker", { status: 403 }),
  );
  await assert.rejects(
    () => p.voiceStatus("voice_1", "model"),
    (e: any) => {
      assert.match(e.message, /HTTP 403/);
      assert.ok(!e.message.includes("test-secret-marker"));
      return true;
    },
  );
});
test("verified external caller IDs are outbound-only; termination uses the real CallSid", async () => {
  const callerSid = `PN${"1".repeat(32)}`,
    callSid = `CA${"1".repeat(32)}`;
  const p = new TwilioAdapter(
    `AC${"1".repeat(32)}`,
    "test-auth-not-secret",
    async (url, init) => {
      if (String(url).includes("OutgoingCallerIds"))
        return Response.json({ sid: callerSid, phone_number: "+12025550123" });
      assert.ok(String(url).endsWith(`/Calls/${callSid}.json`));
      assert.equal((init!.body as URLSearchParams).get("Status"), "completed");
      return Response.json({ sid: callSid, status: "completed" });
    },
  );
  const c = await p.verifyCaller(callerSid, "+12025550123");
  assert.equal(c.verified, true);
  assert.equal(c.inboundCapable, false);
  assert.equal(
    (await p.verifyCaller(callerSid, "+12025550199")).verified,
    false,
  );
  assert.equal((await p.stop(callSid)).stopped, true);
  await assert.rejects(() => p.stop("sim_fake"));
});
test("webhook HMAC checks raw bytes, timestamp tolerance, and rotated signatures", () => {
  const raw = Buffer.from('{"type":"test"}'),
    timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", "test-signing-key")
    .update(`${timestamp}.`)
    .update(raw)
    .digest("hex");
  assert.ok(
    verifyElevenWebhook(
      raw,
      `t=${timestamp},v0=${"0".repeat(64)},v0=${signature}`,
      "test-signing-key",
    ),
  );
  assert.ok(
    !verifyElevenWebhook(
      Buffer.from("{}"),
      `t=${timestamp},v0=${signature}`,
      "test-signing-key",
    ),
  );
  assert.ok(
    !verifyElevenWebhook(
      raw,
      `t=${timestamp},v0=${signature}`,
      "test-signing-key",
      Date.now() + 301_000,
    ),
  );
  assert.ok(
    !verifyElevenWebhook(raw, `t=${timestamp},v0=bad`, "test-signing-key"),
  );
});
test("provider events deduplicate, ignore stale events and cannot mutate a simulated call", () => {
  const dir = mkdtempSync(join(tmpdir(), "voice-events-")),
    store = new Store(dir);
  try {
    const o = createOperator(
      store,
      "events@example.test",
      "Test-only password 123",
    );
    const c = store.add(o, "call", {
      mode: "simulation",
      conversationId: "conv_1",
      state: "queued",
      timeline: [],
    });
    const e = {
      id: "event_1",
      conversationId: "conv_1",
      state: "completed" as const,
      at: Date.now(),
    };
    assert.deepEqual(acceptProviderEvent(store, e), { ignored: true });
    assert.deepEqual(acceptProviderEvent(store, e), { duplicate: true });
    assert.equal(store.get(o, "call", c.id).state, "queued");
    const live = store.add(o, "call", {
      mode: "live",
      conversationId: "conv_2",
      state: "connected",
      lastProviderAt: 100,
      timeline: [],
    });
    assert.deepEqual(
      acceptProviderEvent(store, {
        ...e,
        id: "event_2",
        conversationId: "conv_2",
        at: 90,
      }),
      { stale: true },
    );
    assert.deepEqual(
      acceptProviderEvent(store, {
        ...e,
        id: "event_3",
        conversationId: "conv_2",
        at: 110,
      }),
      { applied: true },
    );
    assert.deepEqual(
      acceptProviderEvent(store, {
        ...e,
        id: "event_4",
        conversationId: "conv_2",
        state: "failed",
        at: 120,
      }),
      { stale: true },
    );
    assert.equal(store.get(o, "call", live.id).state, "completed");
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});
test("latency report is unmeasured until real samples are supplied", () => {
  assert.equal(latencyReport([]).medianMs, null);
  assert.match(latencyReport([]).evidence, /Unmeasured/);
  const report = latencyReport([
    { responseMs: 800 },
    { responseMs: 1200 },
    { responseMs: 3500, interruptionStopMs: 100 },
  ]);
  assert.equal(report.medianMs, 1200);
  assert.equal(report.p95Ms, 3500);
});
