import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { Store } from "../server/store.js";
import { createApp } from "../server/http.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

test("HTTP authentication, CSRF, OAuth PKCE discovery and real MCP transport", async () => {
  const dir = mkdtempSync(join(tmpdir(), "voice-http-")),
    store = new Store(dir);
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number },
    origin = `http://127.0.0.1:${address.port}`;
  const { app, service } = createApp(store, origin);
  server.on("request", app);
  const req = async (
    path: string,
    input?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(`${origin}${path}`, {
      redirect: "manual",
      headers: {
        origin,
        ...(input !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      ...(input !== undefined
        ? { method: "POST", body: JSON.stringify(input) }
        : {}),
    });
  try {
    assert.equal((await req("/api/state")).status, 401);
    assert.equal(
      (
        await req(
          "/api/setup",
          { email: "owner@test.example", password: "Test only password 123" },
          { origin: "https://evil.test" },
        )
      ).status,
      403,
    );
    const setup = await req("/api/setup", {
      email: "owner@test.example",
      password: "Test only password 123",
    });
    assert.equal(setup.status, 200);
    const cookie = setup.headers.get("set-cookie")!.split(";")[0],
      s = (await setup.json()) as any;
    const headers = { cookie, "x-csrf-token": s.csrf };
    assert.match(setup.headers.get("set-cookie")!, /HttpOnly/);
    assert.match(setup.headers.get("set-cookie")!, /SameSite=Strict/);
    assert.equal(
      (await req("/api/voice", { name: "x" }, { cookie })).status,
      403,
    );
    assert.equal(
      (await req("/api/voice", { name: "Owner" }, headers)).status,
      200,
    );
    assert.equal(
      (
        await req("/api/setup", {
          email: "hijack@test.example",
          password: "Test only password 123",
        })
      ).status,
      400,
    );
    const invalidHost = await new Promise<number>((resolve) => {
      const r = httpRequest(
        `${origin}/api/state`,
        { headers: { host: "attacker.invalid" } },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      r.end();
    });
    assert.equal(invalidHost, 403);
    const discovery = (await (
      await req("/.well-known/oauth-authorization-server")
    ).json()) as any;
    assert.ok(discovery.code_challenge_methods_supported.includes("S256"));
    const metadata = (await (
      await req("/.well-known/oauth-protected-resource/mcp")
    ).json()) as any;
    assert.equal(metadata.resource, `${origin}/mcp`);
    assert.equal(
      (
        await req("/mcp", {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {},
        })
      ).status,
      401,
    );
    const registration = await req("/register", {
      redirect_uris: ["http://127.0.0.1:6276/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      client_name: "Integration test",
    });
    assert.equal(registration.status, 201);
    const client = (await registration.json()) as any;
    const verifier = "a".repeat(64),
      challenge = createHash("sha256").update(verifier).digest("base64url");
    const params = new URLSearchParams({
      client_id: client.client_id,
      response_type: "code",
      redirect_uri: client.redirect_uris[0],
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope: "voice:read calls:read calls:place",
      resource: `${origin}/mcp`,
      state: "test-state",
    });
    const authorize = await req(`/authorize?${params}`);
    assert.equal(authorize.status, 302);
    const requestId = new URL(
      authorize.headers.get("location")!,
      origin,
    ).searchParams.get("oauth")!;
    assert.equal(
      (await req("/api/oauth/approve", { request: requestId, approve: true }))
        .status,
      401,
    );
    const approved = (await (
      await req(
        "/api/oauth/approve",
        { request: requestId, approve: true },
        headers,
      )
    ).json()) as any;
    const redirect = new URL(approved.redirect);
    assert.equal(redirect.searchParams.get("state"), "test-state");
    assert.equal(redirect.searchParams.get("iss"), origin);
    const token = async (codeVerifier: string, resource = `${origin}/mcp`) =>
      fetch(`${origin}/token`, {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: client.client_id,
          code: redirect.searchParams.get("code")!,
          code_verifier: codeVerifier,
          redirect_uri: client.redirect_uris[0],
          resource,
        }),
      });
    assert.equal((await token("b".repeat(64))).status, 400);
    assert.equal((await token(verifier, "https://wrong.test/mcp")).status, 400);
    const tokenResponse = await token(verifier);
    assert.equal(tokenResponse.status, 200);
    const t = (await tokenResponse.json()) as any;
    assert.equal((await token(verifier)).status, 400);
    const mcp = new Client({ name: "voice-tests", version: "1.0.0" });
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${t.access_token}` } },
      }),
    );
    const tools = await mcp.listTools();
    assert.equal(tools.tools.length, 12);
    assert.equal(
      tools.tools.some((x) => /authorize|grant/.test(x.name)),
      false,
    );
    assert.equal(
      tools.tools.find((x) => x.name === "voice_preview")!.annotations!
        .readOnlyHint,
      false,
    );
    const account = await mcp.callTool({
      name: "account_get_profile",
      arguments: {},
    });
    assert.equal((account.structuredContent as any).data.operatorId, s.owner);
    const budget = await mcp.callTool({
      name: "usage_get_budget",
      arguments: {},
    });
    assert.equal((budget.structuredContent as any).data.liveEnabled, false);
    const preview = await mcp.callTool({
      name: "voice_preview",
      arguments: {
        versionId: crypto.randomUUID(),
        sentence: 0,
        preset: "studio",
      },
    });
    assert.equal(preview.isError, true);
    assert.match(JSON.stringify(preview), /insufficient_scope/);
    const output = JSON.stringify({ account, budget, tools });
    for (const forbidden of [
      "password",
      "ELEVENLABS_API_KEY",
      "TWILIO_AUTH_TOKEN",
    ])
      assert.ok(!output.includes(forbidden));
    await req("/api/oauth/revoke-all", {}, headers);
    assert.equal(
      (
        await fetch(`${origin}/mcp`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${t.access_token}`,
            "content-type": "application/json",
          },
          body: "{}",
        })
      ).status,
      401,
    );
    await mcp.close();
    const profile = service.store.list(s.owner, "voice")[0];
    service.consent(s.owner, profile.id, true, false);
    service.enrollSimulation(s.owner, profile.id);
    service.tick();
    const version = store.list(s.owner, "version")[0];
    const p = service.preview(s.owner, version.id, 0, "studio");
    service.tick();
    const previewData = service.previewResult(s.owner, p.id);
    assert.equal((await req(`/api/audio/${previewData.audioId}`)).status, 401);
    const signed = await req(previewData.privateAudioUrl);
    assert.equal(signed.status, 200);
    assert.equal(signed.headers.get("cache-control"), "private, no-store");
    const tampered = previewData.privateAudioUrl.replace(
      /signature=./,
      "signature=x",
    );
    assert.equal((await req(tampered)).status, 403);
    const logout = await req("/api/logout", {}, headers);
    assert.equal(logout.status, 200);
    assert.equal((await req("/api/state", undefined, { cookie })).status, 401);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    rmSync(dir, { recursive: true });
  }
});
