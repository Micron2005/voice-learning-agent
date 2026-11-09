import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Store } from "../server/store.js";
import { createOperator, login } from "../server/auth.js";
import { createApp } from "../server/http.js";
import { VoiceService } from "../server/service.js";
import { ConversationBridge, FALLBACK } from "../server/conversation.js";
import { createMcp } from "../server/mcp.js";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "codex-turn-"));
  const store = new Store(dir),
    service = new VoiceService(store);
  const owner = createOperator(
    store,
    "owner@example.test",
    "Fixture password 123!",
  );
  const other = createOperator(
    store,
    "other@example.test",
    "Fixture password 123!",
  );
  service.initialize(owner);
  const voice = service.createVoice(owner, "Fixture only");
  service.consent(owner, voice.id, true, false);
  service.enrollSimulation(owner, voice.id);
  service.tick();
  const version = store.list(owner, "version")[0];
  service.approveVersion(owner, version.id);
  const caller = service.caller(owner, "+12025550123");
  service.permission(owner, {
    number: "+12025550124",
    purpose: "owner-test",
    wording: "I authorize this fictional fixture.",
    source: "fixture owner UI",
  });
  const draft = service.prepare(owner, {
    recipient: "+12025550124",
    callerId: caller.id,
    voiceVersion: version.id,
    knowledgeVersion: store.list(owner, "knowledge")[0].id,
    purpose: "owner-test",
    duration: 180,
    costCapCents: 0,
    conversation: "codex",
  });
  service.authorizeFromUI(owner, draft.id);
  const call = service.place(owner, draft.id, "fixture-call-unique");
  service.transition(call, "connected");
  let now = Date.now();
  const bridge = new ConversationBridge(service, () => now);
  return {
    dir,
    store,
    service,
    owner,
    other,
    voice,
    version,
    call,
    draft,
    bridge,
    advance: (ms: number) => {
      now += ms;
    },
    close: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
const scenario = (
  name: string,
  fn: (f: ReturnType<typeof fixture>) => unknown,
) =>
  test(name, async () => {
    const f = fixture();
    try {
      await fn(f);
    } finally {
      f.close();
    }
  });

scenario(
  "two MCP turns capture exact client UTF-8 replies, with encrypted fixture text and no synthesis",
  async (f) => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    const server = createMcp(
      f.service,
      f.owner,
      ["calls:listen", "calls:speak"],
      "http://localhost",
    );
    const client = new Client({
      name: "automated-fixture-not-Codex",
      version: "1",
    });
    await server.connect(a);
    await client.connect(b);
    try {
      for (const [index, transcript, reply] of [
        [
          1,
          "What does Vultrix cost?",
          "  Vultrix: $15 / $25 / $35.\nNo rewriting — café.  ",
        ],
        [2, "Does it track repairs?", "I won't invent repair features."],
      ] as const) {
        f.bridge.injectFixture(f.owner, f.call.id, transcript);
        const next: any = await client.callTool({
          name: "call_next_turn",
          arguments: { callId: f.call.id, waitMs: 0 },
        });
        assert.equal(next.structuredContent.data.transcript, transcript);
        assert.equal(next.structuredContent.data.untrusted, true);
        const result: any = await client.callTool({
          name: "call_speak",
          arguments: {
            callId: f.call.id,
            turnId: next.structuredContent.data.turnId,
            text: reply,
            idempotencyKey: `reply-key-${index}`,
          },
        });
        assert.equal(result.structuredContent.data.status, "captured");
        assert.equal(result.structuredContent.data.submittedText, reply);
        assert.equal(
          result.structuredContent.data.endOfTurnToFirstAudioMs,
          null,
        );
        assert.equal(
          f.bridge.inspectFixture(f.owner, f.call.id).turns[index - 1]
            .submittedText,
          reply,
        );
        assert.equal(
          result.structuredContent.data.replyHash,
          createHash("sha256").update(reply).digest("hex"),
        );
      }
      assert.equal(f.service.budget(f.owner).remainingCents, 0);
      assert.equal(f.call.recording, false);
      const raw = JSON.stringify(f.store.list(f.owner, "turn"));
      assert.ok(!raw.includes("Vultrix"));
      const turn = f.store.list(f.owner, "turn")[0];
      assert.ok(
        !readFileSync(join(f.dir, `${turn.replyId}.audio`)).includes("Vultrix"),
      );
    } finally {
      await client.close();
      await server.close();
    }
  },
);
scenario(
  "fixture HTTP routes enforce owner, same-origin and CSRF without provider traffic",
  async (f) => {
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    let externalRequests = 0;
    const { app } = createApp(f.store, origin, true, async () => {
      externalRequests++;
      throw new Error("No external traffic authorized");
    });
    server.on("request", app);
    const owner = login(f.store, "owner@example.test", "Fixture password 123!");
    const stranger = login(
      f.store,
      "other@example.test",
      "Fixture password 123!",
    );
    const headers = {
      origin,
      cookie: `voice_session=${owner.token}`,
      "x-csrf-token": owner.csrf,
      "content-type": "application/json",
    };
    const post = (body: unknown, h = headers) =>
      fetch(`${origin}/api/fixture/utterance`, {
        method: "POST",
        headers: h,
        body: JSON.stringify(body),
      });
    try {
      const body = {
        callId: f.call.id,
        text: "Fictional caller, not a real transcript",
      };
      assert.equal(
        (await fetch(`${origin}/api/fixture/${f.call.id}`)).status,
        401,
      );
      assert.equal((await post(body, { ...headers, cookie: "" })).status, 401);
      assert.equal(
        (await post(body, { ...headers, origin: "https://foreign.example" }))
          .status,
        403,
      );
      assert.equal(
        (await post(body, { ...headers, "x-csrf-token": "wrong" })).status,
        403,
      );
      assert.equal(
        (
          await post(body, {
            ...headers,
            cookie: `voice_session=${stranger.token}`,
            "x-csrf-token": stranger.csrf,
          })
        ).status,
        404,
      );
      assert.equal(
        (await post({ ...body, idempotencyKey: "not-a-speech-route" })).status,
        400,
      );
      assert.equal((await post(body)).status, 200);
      const capture = await fetch(`${origin}/api/fixture/${f.call.id}`, {
        headers: { cookie: headers.cookie },
      });
      assert.equal(capture.headers.get("cache-control"), "private, no-store");
      assert.equal((await capture.json()).turns[0].transcript, body.text);
      assert.equal(
        (
          await fetch(`${origin}/api/fixture/${f.call.id}`, {
            headers: { cookie: `voice_session=${stranger.token}` },
          })
        ).status,
        404,
      );
      for (const path of [
        "provider/inspect",
        "call/live",
        "voice/enroll-real",
        "twilio/call",
      ])
        assert.equal(
          (
            await fetch(`${origin}/api/${path}`, {
              method: "POST",
              headers,
              body: "{}",
            })
          ).status,
          404,
        );
      assert.equal(externalRequests, 0);
    } finally {
      server.close();
      await once(server, "close");
    }
  },
);
scenario(
  "bounded wait, independent SQLite connections and cancellation",
  async (f) => {
    const start = performance.now();
    assert.equal(
      (await f.bridge.nextTurn(f.owner, f.call.id, 20)).status,
      "timeout",
    );
    assert.ok(performance.now() - start < 500);
    await assert.rejects(f.bridge.nextTurn(f.owner, f.call.id, 25_001));
    const store2 = new Store(f.dir),
      service2 = new VoiceService(store2);
    const timer = setTimeout(
      () =>
        service2.conversation.injectFixture(
          f.owner,
          f.call.id,
          "Caller from another process",
        ),
      20,
    );
    try {
      assert.equal(
        (await f.bridge.nextTurn(f.owner, f.call.id, 1000)).status,
        "turn",
      );
    } finally {
      clearTimeout(timer);
      store2.close();
    }
    const controller = new AbortController();
    controller.abort();
    assert.equal(
      (await f.bridge.nextTurn(f.owner, f.call.id, 1000, controller.signal))
        .status,
      "cancelled",
    );
  },
);
scenario(
  "blank, oversized and ill-formed reply text is rejected without changing the turn",
  async (f) => {
    f.bridge.injectFixture(f.owner, f.call.id, "Hello");
    const next: any = await f.bridge.nextTurn(f.owner, f.call.id, 0);
    for (const text of [" ", "x".repeat(2001), "\ud800"])
      assert.throws(() =>
        f.bridge.speak(f.owner, f.call.id, next.turnId, text, "invalid-reply"),
      );
    assert.equal(
      f.bridge.inspectFixture(f.owner, f.call.id).turns[0].state,
      "pending",
    );
  },
);
scenario("ownership consent cannot authorize an external voice upload", (f) => {
  assert.throws(
    () => f.service.consent(f.owner, f.voice.id, true, true),
    /External voice uploads are disabled/,
  );
  assert.equal(f.store.list(f.owner, "consent")[0].providerUpload, false);
});
test("runtime code and recording studio have no retired hosted voice path", () => {
  for (const path of [
    "app/page.tsx",
    "app/conversation.tsx",
    "server/providers.ts",
    "server/http.ts",
    "server/service.ts",
    "server/content.ts",
    ".env.example",
  ])
    assert.doesNotMatch(
      readFileSync(path, "utf8"),
      /elevenlabs|elevenagents|eleven[_-]|convai/i,
    );
});
scenario(
  "call duration, kill switch and voice revocation unblock pending reads with stopped",
  async (f) => {
    f.advance(181_000);
    assert.equal(
      (await f.bridge.nextTurn(f.owner, f.call.id, 0)).status,
      "stopped",
    );
  },
);
scenario(
  "kill switch and voice revocation prevent further caller injection and replies",
  async (f) => {
    f.bridge.injectFixture(f.owner, f.call.id, "Hello");
    const next: any = await f.bridge.nextTurn(f.owner, f.call.id, 0);
    f.service.kill(f.owner, true);
    assert.equal(
      (await f.bridge.nextTurn(f.owner, f.call.id, 0)).status,
      "stopped",
    );
    assert.equal(
      f.bridge.speak(f.owner, f.call.id, next.turnId, "No", "kill-reply")
        .status,
      "stopped",
    );
    assert.equal(
      f.bridge.injectFixture(f.owner, f.call.id, "Again").status,
      "stopped",
    );
    f.service.revokeVoice(f.owner, f.voice.id);
    assert.equal(
      f.bridge.speak(f.owner, f.call.id, next.turnId, "No", "revoke-key")
        .status,
      "stopped",
    );
  },
);
scenario(
  "interruption makes old turns stale and duplicate submission never enqueues twice",
  async (f) => {
    f.bridge.injectFixture(f.owner, f.call.id, "first");
    const first: any = await f.bridge.nextTurn(f.owner, f.call.id, 0);
    f.bridge.injectFixture(f.owner, f.call.id, "interrupt");
    assert.equal(
      f.bridge.speak(
        f.owner,
        f.call.id,
        first.turnId,
        "Old answer",
        "first-key",
      ).status,
      "stale_turn",
    );
    const next: any = await f.bridge.nextTurn(f.owner, f.call.id, 0);
    assert.equal(
      ((await f.bridge.nextTurn(f.owner, f.call.id, 0)) as any).turnId,
      next.turnId,
    );
    assert.equal(
      f.bridge.speak(
        f.owner,
        f.call.id,
        next.turnId,
        "Exact answer",
        "second-key",
      ).status,
      "captured",
    );
    assert.equal(
      f.bridge.speak(
        f.owner,
        f.call.id,
        next.turnId,
        "Exact answer",
        "second-key",
      ).status,
      "duplicate",
    );
    assert.equal(
      f.bridge.speak(f.owner, f.call.id, next.turnId, "Changed", "second-key")
        .status,
      "idempotency_conflict",
    );
    assert.equal(
      f.bridge.speak(f.owner, f.call.id, next.turnId, "Again", "another-key")
        .status,
      "stale_turn",
    );
  },
);
scenario(
  "late client triggers fixed fallback and end, never reviving an expired call",
  async (f) => {
    f.bridge.injectFixture(f.owner, f.call.id, "Hello");
    const next: any = await f.bridge.nextTurn(f.owner, f.call.id, 0);
    f.advance(15_001);
    assert.equal(
      f.bridge.speak(f.owner, f.call.id, next.turnId, "Too late", "late-reply")
        .status,
      "stopped",
    );
    const evidence = f.bridge.inspectFixture(f.owner, f.call.id);
    assert.equal(evidence.endReason, "client_timeout");
    assert.equal(evidence.turns[0].fallbackText, FALLBACK);
    assert.equal(evidence.turns[0].submittedText, null);
    assert.equal(
      (await f.bridge.nextTurn(f.owner, f.call.id, 0)).status,
      "stopped",
    );
  },
);
scenario(
  "owner, grant, consent, suppression, voice approval and stop rechecked per turn",
  async (f) => {
    await assert.rejects(
      f.bridge.nextTurn(f.other, f.call.id, 0),
      /Private record/,
    );
    assert.throws(
      () => f.bridge.injectFixture(f.other, f.call.id, "Hello"),
      /Private record/,
    );
    f.bridge.injectFixture(f.owner, f.call.id, "Hi");
    const t: any = await f.bridge.nextTurn(f.owner, f.call.id, 0);
    assert.throws(
      () => f.bridge.speak(f.other, f.call.id, t.turnId, "leak", "other-key"),
      /Private record/,
    );
    const grant = f.store.list(f.owner, "grant")[0];
    grant.revoked = true;
    f.store.save(grant);
    await assert.rejects(
      f.bridge.nextTurn(f.owner, f.call.id, 0),
      /authorization/,
    );
    grant.revoked = false;
    f.store.save(grant);
    f.version.approved = false;
    f.store.save(f.version);
    assert.throws(
      () => f.bridge.speak(f.owner, f.call.id, t.turnId, "Hi", "approve-key"),
      /Approve/,
    );
    f.version.approved = true;
    f.store.save(f.version);
    const consent = f.store.list(f.owner, "consent")[0];
    consent.revoked = true;
    f.store.save(consent);
    await assert.rejects(f.bridge.nextTurn(f.owner, f.call.id, 0), /revoked/);
    consent.revoked = false;
    f.store.save(consent);
    f.store.add(f.owner, "suppression", { number: f.call.number });
    assert.throws(
      () => f.bridge.speak(f.owner, f.call.id, t.turnId, "No", "suppress-key"),
      /suppressed/,
    );
    f.service.stop(f.owner, f.call.id);
    assert.equal(
      (await f.bridge.nextTurn(f.owner, f.call.id, 0)).status,
      "stopped",
    );
    assert.equal(
      f.bridge.speak(f.owner, f.call.id, t.turnId, "Late", "stopped-key")
        .status,
      "stopped",
    );
  },
);
scenario(
  "listen and speak need explicit independent MCP scopes; no grant tool exists",
  async (f) => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    const server = createMcp(
      f.service,
      f.owner,
      ["calls:read"],
      "http://localhost",
    );
    const client = new Client({ name: "scope-test", version: "1" });
    await server.connect(a);
    await client.connect(b);
    try {
      const result: any = await client.callTool({
        name: "call_next_turn",
        arguments: { callId: f.call.id, waitMs: 0 },
      });
      assert.equal(result.structuredContent.error.code, "insufficient_scope");
      const reply: any = await client.callTool({
        name: "call_speak",
        arguments: {
          callId: f.call.id,
          turnId: f.voice.id,
          text: "No",
          idempotencyKey: "scope-key",
        },
      });
      assert.equal(reply.structuredContent.error.code, "insufficient_scope");
      assert.ok(
        !(await client.listTools()).tools.some((t) =>
          /authorize|grant/.test(t.name),
        ),
      );
    } finally {
      await client.close();
      await server.close();
    }
  },
);
