import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { Store } from "../server/store.js";
import { createApp } from "../server/http.js";
import { createOperator, login } from "../server/auth.js";

test("Twilio HTTP inspection requires primary-owner session, same origin and CSRF; no secret or write path", async () => {
  const previous = {
    sid: process.env.TWILIO_ACCOUNT_SID,
    token: process.env.TWILIO_AUTH_TOKEN,
  };
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  const dir = mkdtempSync(join(tmpdir(), "voice-twilio-http-")),
    store = new Store(dir);
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const sid = `AC${"4".repeat(32)}`;
  let reads = 0;
  const providerFetch: typeof fetch = async (url, init) => {
    reads++;
    assert.equal(init?.method ?? "GET", "GET");
    assert.equal(new URL(String(url)).hostname, "api.twilio.com");
    return Response.json(
      String(url).endsWith(`${sid}.json`)
        ? {
            sid,
            type: "Trial",
            status: "active",
            auth_token: "fixture-token-private",
          }
        : String(url).includes("IncomingPhoneNumbers")
          ? { incoming_phone_numbers: [] }
          : { outgoing_caller_ids: [] },
    );
  };
  const { app, service } = createApp(store, origin, true, providerFetch);
  server.on("request", app);
  const req = (
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(`${origin}/api/${path}`, {
      headers: {
        origin,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined
        ? { method: "POST", body: JSON.stringify(body) }
        : {}),
    });
  try {
    assert.equal((await req("twilio/setup")).status, 401);
    assert.equal((await req("twilio/inspect", {})).status, 401);
    const setup = await req("setup", {
      email: "owner@example.test",
      password: "Test-only password 123",
    });
    const auth = await setup.json();
    const cookie = setup.headers.get("set-cookie")!.split(";")[0];
    const headers = { cookie, "x-csrf-token": auth.csrf };
    const localStatus = await req("twilio/setup", undefined, { cookie });
    assert.equal(localStatus.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await localStatus.json(), {
      configured: false,
      liveEnabled: false,
      approvedSpendCents: 0,
    });
    assert.equal((await req("twilio/inspect", {}, headers)).status, 400);
    assert.equal(reads, 0);
    process.env.TWILIO_ACCOUNT_SID = sid;
    process.env.TWILIO_AUTH_TOKEN = "fixture-token-private";
    assert.equal(
      (await req("twilio/setup", undefined, { cookie })).status,
      200,
    );
    assert.equal(reads, 0);
    assert.equal((await req("twilio/inspect", {}, { cookie })).status, 403);
    assert.equal(
      (
        await req(
          "twilio/inspect",
          {},
          { ...headers, origin: "https://evil.example.test" },
        )
      ).status,
      403,
    );
    assert.equal(
      (await req("twilio/inspect", { authToken: "client-key" }, headers))
        .status,
      400,
    );
    assert.equal(
      (await req("twilio/inspect", undefined, { cookie })).status,
      404,
    );
    assert.equal(
      (
        await req("twilio/setup", undefined, {
          authorization: "Bearer not-a-browser-session",
        })
      ).status,
      401,
    );
    createOperator(store, "other@example.test", "Other test-only password 123");
    const second = login(
      store,
      "other@example.test",
      "Other test-only password 123",
    );
    const otherHeaders = {
      cookie: `voice_session=${second.token}`,
      "x-csrf-token": second.csrf,
    };
    assert.equal(
      (await req("twilio/setup", undefined, otherHeaders)).status,
      403,
    );
    assert.equal((await req("twilio/inspect", {}, otherHeaders)).status, 403);
    assert.equal(reads, 0);
    const inspection = await req("twilio/inspect", {}, headers);
    assert.equal(inspection.status, 200);
    const raw = await inspection.text();
    assert.ok(!raw.includes(sid));
    assert.ok(!raw.includes("fixture-token-private"));
    const report = JSON.parse(raw);
    assert.equal(report.trialAccountActive, true);
    assert.equal(report.canPlaceCalls, false);
    assert.equal(report.quotaConfirmed, false);
    assert.equal(reads, 3);
    assert.equal(service.budget(auth.owner).remainingCents, 0);
    assert.equal(service.budget(auth.owner).liveEnabled, false);
    assert.deepEqual(store.list(auth.owner, "call"), []);
    for (const path of [
      "twilio/call",
      "twilio/buy-number",
      "twilio/verify",
      "twilio/upgrade",
    ])
      assert.equal((await req(path, {}, headers)).status, 404);
    await req("logout", {}, headers);
    assert.equal((await req("twilio/inspect", {}, headers)).status, 401);
    assert.equal(reads, 3);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    rmSync(dir, { recursive: true, force: true });
    for (const [key, value] of [
      ["TWILIO_ACCOUNT_SID", previous.sid],
      ["TWILIO_AUTH_TOKEN", previous.token],
    ]) {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }
  }
});
