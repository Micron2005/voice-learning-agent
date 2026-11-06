import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { Store, Fault, requireThat } from "./store.js";
import { VoiceService } from "./service.js";
import { createOperator, login, session } from "./auth.js";
import { OAuthProvider, SCOPES } from "./oauth.js";
import { createMcp } from "./mcp.js";
import { inspectAudio } from "./private-audio.js";
import { ElevenLabsAdapter, latencyReport } from "./providers.js";

export function createApp(store: Store, origin: string, localSetup = true) {
  const app = express(),
    service = new VoiceService(store),
    oauth = new OAuthProvider(store, origin);
  const url = new URL(origin);
  requireThat(
    url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)),
    "https_required",
    "Use HTTPS outside loopback.",
  );
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const host = req.headers.host?.split(":")[0];
    requireThat(
      host === url.hostname ||
        (localSetup && ["localhost", "127.0.0.1"].includes(host ?? "")),
      "host",
      "Unrecognized host.",
      403,
    );
    res.set({
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "microphone=(self), camera=()",
    });
    next();
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: 240,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.use(express.json({ limit: "64kb" }));
  app.use("/api", (req, _res, next) => {
    if (!["GET", "HEAD"].includes(req.method))
      requireThat(
        req.get("origin") === origin,
        "origin",
        "Same-origin request required.",
        403,
      );
    next();
  });
  app.get("/health", (_req, res) =>
    res.json({
      service: "vultrix-voice",
      mode: "simulation",
      liveEnabled: false,
    }),
  );
  app.get("/api/session", (req, res) => {
    const hasOwner = !!store.db
      .prepare("SELECT id FROM operators LIMIT 1")
      .get();
    try {
      const s = session(store, req);
      res.json({ signedIn: true, csrf: s.csrf, owner: s.owner });
    } catch {
      res.json({ signedIn: false, canSetup: !hasOwner && localSetup });
    }
  });
  const authLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: 12,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  app.post(["/api/login", "/api/setup"], authLimit, (req, res) => {
    const { email, password } = z
      .object({
        email: z.string().max(254),
        password: z.string().min(1).max(256),
      })
      .strict()
      .parse(req.body);
    if (req.path === "/api/setup") {
      requireThat(
        localSetup,
        "setup_disabled",
        "Remote first-run setup is disabled.",
        403,
      );
      store.atomic(() => {
        requireThat(
          !store.db.prepare("SELECT id FROM operators LIMIT 1").get(),
          "setup_complete",
          "Owner already exists.",
        );
        createOperator(store, email, password);
      });
    }
    const s = login(store, email, password);
    service.initialize(s.owner);
    res.cookie("voice_session", s.token, {
      httpOnly: true,
      sameSite: "strict",
      secure: url.protocol === "https:",
      maxAge: 12 * 60 * 60_000,
      path: "/",
    });
    res.json({ signedIn: true, csrf: s.csrf, owner: s.owner });
  });
  app.use("/api", (req, res, next) => {
    // Signed private audio can be consumed by an MCP host without a browser cookie.
    if (
      req.method === "GET" &&
      req.path.startsWith("/audio/") &&
      req.query.signature
    )
      return next();
    const s = session(store, req);
    res.locals.owner = s.owner;
    if (!["GET", "HEAD"].includes(req.method))
      requireThat(
        req.get("x-csrf-token") === s.csrf,
        "csrf",
        "Refresh your session and retry.",
        403,
      );
    next();
  });
  const endpoint = (path: string, fn: (owner: string, input: any) => unknown) =>
    app.post(`/api/${path}`, async (req, res) =>
      res.json(await fn(res.locals.owner, req.body)),
    );
  app.get("/api/state", (_req, res) =>
    res.json(service.snapshot(res.locals.owner)),
  );
  app.post("/api/logout", (req, res) => {
    const s = session(store, req);
    store.db.prepare("DELETE FROM sessions WHERE hash=?").run(s.hash);
    res.clearCookie("voice_session", { path: "/" });
    res.json({ ok: true });
  });
  endpoint("voice", (o, i) => service.createVoice(o, z.string().parse(i.name)));
  endpoint("voice/consent", (o, i) =>
    service.consent(o, i.voiceId, i.own, i.providerUpload),
  );
  endpoint("voice/enroll-simulation", (o, i) =>
    service.enrollSimulation(o, i.voiceId),
  );
  endpoint("voice/revoke", (o, i) => {
    requireThat(
      i.confirm === "REVOKE",
      "confirmation",
      "Type REVOKE to revoke consent and block use.",
    );
    return service.revokeVoice(o, i.voiceId);
  });
  endpoint("voice/version", (o, i) =>
    service.newVersion(o, i.versionId, z.string().parse(i.dictionary)),
  );
  endpoint("voice/approve", (o, i) => service.approveVersion(o, i.versionId));
  endpoint("voice/rollback", (o, i) => service.rollback(o, i.versionId));
  endpoint("preview", (o, i) =>
    service.preview(o, i.versionId, i.sentence, i.preset),
  );
  app.get("/api/preview/:id", (req, res) =>
    res.json(service.previewResult(res.locals.owner, String(req.params.id))),
  );
  endpoint("rating", (o, i) => service.rate(o, i));
  endpoint("caller", (o, i) => service.caller(o, i.number));
  endpoint("permission", (o, i) => service.permission(o, i));
  endpoint("permission/revoke", (o, i) => {
    const p = store.get(o, "permission", i.id);
    p.revoked = true;
    store.save(p);
    for (const c of store.list(o, "call").filter((c) => c.number === p.number))
      service.stop(o, c.id);
    return p;
  });
  endpoint("suppression", (o, i) => {
    const number = z
      .string()
      .regex(/^\+[1-9]\d{7,14}$/)
      .parse(i.number);
    const s = store.add(o, "suppression", {
      number,
      reason: "Operator suppression",
      at: Date.now(),
    });
    for (const c of store.list(o, "call").filter((c) => c.number === number))
      service.stop(o, c.id);
    return s;
  });
  endpoint("knowledge", (o, i) =>
    service.saveKnowledge(o, z.string().parse(i.text)),
  );
  endpoint("call/prepare", (o, i) => service.prepare(o, i));
  endpoint("call/authorize", (o, i) => {
    requireThat(
      i.confirm === true,
      "review_required",
      "Review the exact draft and explicitly authorize it.",
    );
    return service.authorizeFromUI(o, i.draftId);
  });
  endpoint("call/place", (o, i) => {
    const p = z
      .object({
        draftId: z.string().uuid(),
        idempotencyKey: z.string().min(8).max(100),
      })
      .strict()
      .parse(i);
    return service.place(o, p.draftId, p.idempotencyKey);
  });
  endpoint("call/stop", (o, i) => service.stop(o, i.callId));
  endpoint("call/optout", (o, i) => service.stop(o, i.callId, true));
  endpoint("kill", (o, i) => service.kill(o, z.boolean().parse(i.enabled)));
  endpoint("asset/delete", (o, i) => {
    requireThat(
      i.confirm === "DELETE",
      "confirmation",
      "Type DELETE to remove this private original or preview. Provider assets are not affected.",
    );
    service.deleteAsset(o, i.id);
    return { deleted: true, providerDeleted: false };
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 3 },
  });
  app.post("/api/recording", upload.single("audio"), async (req, res) => {
    const owner = res.locals.owner,
      voiceId = z.string().uuid().parse(req.body.voiceId);
    service.validVoice(owner, voiceId);
    requireThat(req.file, "audio_required", "Choose a recording.");
    const { report } = await inspectAudio(req.file.buffer);
    service.validVoice(owner, voiceId);
    const mime =
      req.file.buffer.toString("ascii", 0, 4) === "RIFF"
        ? "audio/wav"
        : "application/octet-stream";
    const a = store.add(owner, "asset", {
      voiceId,
      role: "reference",
      mime,
      originalMime: req.file.mimetype,
      filename: req.file.originalname.slice(0, 150),
      bytes: req.file.size,
      report,
      providerUpload: false,
      synthetic: false,
    });
    try {
      service.audio.put(a.id, req.file.buffer);
    } catch (e) {
      store.remove(owner, "asset", a.id);
      throw e;
    }
    res.json(a);
  });
  app.get("/api/audio/:id", (req, res) => {
    let owner = res.locals.owner;
    if (req.query.signature) {
      owner = String(req.query.owner);
      requireThat(
        service.audio.verify(
          owner,
          String(req.params.id),
          Number(req.query.expires),
          String(req.query.signature),
        ),
        "audio_expired",
        "Audio link invalid or expired.",
        403,
      );
    }
    const a = store.get(owner, "asset", String(req.params.id));
    if (a.voiceId) service.validVoice(owner, a.voiceId);
    if (a.versionId) service.version(owner, a.versionId);
    const bytes = service.audio.read(a.id);
    res.set(
      "Content-Type",
      a.mime === "application/octet-stream"
        ? a.originalMime?.startsWith("audio/")
          ? a.originalMime
          : "application/octet-stream"
        : a.mime,
    );
    res.set("Content-Disposition", "inline");
    res.send(bytes);
  });
  app.get("/api/oauth/request", (req, res) => {
    const p = oauth.pending(String(req.query.request));
    res.json({
      clientName: p.clientName,
      redirectUri: p.redirectUri,
      scopes: p.scopes,
      expiresIn: "5 minutes",
      warning:
        "This connection cannot mint call authorizations. Only approve clients you trust.",
    });
  });
  endpoint("oauth/approve", (o, i) => ({
    redirect: oauth.approve(o, i.request, z.boolean().parse(i.approve)),
  }));
  endpoint("oauth/revoke-all", (o, _i) => {
    store.db.prepare("DELETE FROM oauth_tokens WHERE owner=?").run(o);
    return { revoked: true };
  });
  endpoint("retention", (o, i) => {
    const days = z.number().int().min(1).max(365).parse(i.audioDays);
    const r = store.list(o, "retention")[0];
    r.audioDays = days;
    store.save(r);
    store.audit(o, "retention.changed", r.id);
    return r;
  });
  app.get("/api/latency", (_req, res) => res.json(latencyReport([])));
  endpoint("provider/inspect", async (_o, _i) => {
    requireThat(
      process.env.ELEVENLABS_API_KEY &&
        process.env.ELEVENLABS_VOICE_ID &&
        process.env.ELEVENLABS_AGENT_ID,
      "provider_setup",
      "Read-only inspection requires server-side ElevenLabs key, voice ID and agent ID. No paid operation or upload is performed.",
    );
    const p = new ElevenLabsAdapter(process.env.ELEVENLABS_API_KEY);
    return {
      voice: await p.voiceStatus(
        process.env.ELEVENLABS_VOICE_ID,
        "eleven_flash_v2_5",
      ),
      agent: await p.agentStatus(process.env.ELEVENLABS_AGENT_ID),
      liveEnabled: false,
    };
  });
  app.use(
    mcpAuthRouter({
      provider: oauth,
      issuerUrl: new URL(origin),
      resourceServerUrl: new URL(oauth.resource),
      scopesSupported: SCOPES,
      tokenOptions: { rateLimit: { windowMs: 60_000, limit: 30 } },
    }),
  );
  app.all("/mcp", async (req, res) => {
    try {
      if (req.get("origin") && req.get("origin") !== origin)
        return res.status(403).json({ error: "origin" });
      const bearer = req.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
      if (!bearer) throw new Error("token");
      const auth = await oauth.verifyAccessToken(bearer);
      const mcp = createMcp(
        service,
        String(auth.extra.owner),
        auth.scopes,
        origin,
      );
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on("close", () => {
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent)
        res
          .status(401)
          .set(
            "WWW-Authenticate",
            `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
          )
          .json({ error: "invalid_token" });
    }
  });
  app.use("/api", (_req, res) =>
    res
      .status(404)
      .json({ error: { code: "not_found", message: "API route not found." } }),
  );
  app.use((e: any, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    const status =
      e instanceof Fault
        ? e.status
        : e instanceof z.ZodError || e instanceof multer.MulterError
          ? 400
          : 500;
    res.status(status).json({
      error: {
        code:
          e instanceof Fault
            ? e.code
            : status === 400
              ? "invalid_input"
              : "operation_failed",
        message:
          e instanceof Fault
            ? e.message
            : e instanceof z.ZodError
              ? "Check the required fields and allowed values."
              : e instanceof multer.MulterError
                ? "Upload must be one file under 50 MB."
                : "Operation failed. Check local dependencies, readiness and provider setup. No automatic retry was made.",
      },
    });
  });
  return { app, service, oauth };
}
