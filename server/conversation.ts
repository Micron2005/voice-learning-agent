import { randomUUID, createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { requireThat } from "./store.js";
import type { VoiceService } from "./service.js";

export const ExactText = z
  .string()
  .min(1)
  .max(2000)
  .refine((s) => s.trim().length > 0)
  .refine(
    (s) => Buffer.from(s, "utf8").toString("utf8") === s,
    "Use well-formed Unicode text.",
  );
export const FALLBACK =
  "Sorry, my response connection is unavailable. Please contact Vultrix directly. Goodbye.";
export const RESPONSE_WINDOW_MS = 15_000;
const digest = (s: string) => createHash("sha256").update(s).digest("hex");

// SQLite serializes decisions across the HTTP, worker and Codex stdio processes.
// Text lives in encrypted, immutable blobs, never audit records or MCP logs.
export class ConversationBridge {
  constructor(
    private service: VoiceService,
    private now = Date.now,
  ) {}
  private get store() {
    return this.service.store;
  }
  private blob(text: string) {
    const id = randomUUID();
    this.service.audio.put(id, Buffer.from(text, "utf8"));
    return id;
  }
  private text(id: string) {
    return this.service.audio.read(id).toString("utf8");
  }
  private turns(owner: string, callId: string) {
    return this.store
      .list(owner, "turn")
      .filter((t) => t.callId === callId)
      .sort((a, b) => a.sequence - b.sequence);
  }
  private call(owner: string, callId: string) {
    const c = this.store.get(owner, "call", callId);
    requireThat(
      c.mode === "simulation" && c.conversation === "codex",
      "conversation_unavailable",
      "Select a Codex fixture in the exact authorized draft. Live calling remains disabled.",
    );
    return c;
  }
  private gate(owner: string, callId: string) {
    let c = this.call(owner, callId);
    if (!["queued", "dialing", "connected"].includes(c.state))
      return { status: "stopped" as const, callId, state: c.state };
    if (this.now() >= c.created + c.duration * 1000) {
      c = this.service.transition(c, "completed");
      return { status: "stopped" as const, callId, state: c.state };
    }
    const draft = this.store.get(owner, "draft", c.draftId);
    this.service.readiness(owner, draft.input);
    const grant = this.store
      .list(owner, "grant")
      .some(
        (g) =>
          g.draftId === c.draftId &&
          g.used &&
          !g.revoked &&
          g.fingerprint === draft.fingerprint,
      );
    requireThat(
      grant,
      "call_authorization",
      "This call has no valid owner authorization.",
      403,
    );
    if (c.state !== "connected")
      return { status: "not_connected" as const, callId, state: c.state };
    return null;
  }
  private expire(owner: string, callId: string) {
    const c = this.call(owner, callId);
    if (c.state !== "connected") return;
    const t = this.turns(owner, callId).find(
      (t) => t.state === "pending" && t.deadlineAt <= this.now(),
    );
    if (!t) return;
    t.state = "expired";
    const draft = this.store.get(owner, "draft", c.draftId);
    t.fallbackId = this.blob(ExactText.parse(draft.snapshot.fallbackText));
    t.expiredAt = this.now();
    this.store.save(t);
    c.endReason = "client_timeout";
    this.service.transition(c, "completed");
    this.store.audit(owner, "conversation.client_timeout.fixture", callId);
  }
  injectFixture(owner: string, callId: string, raw: string) {
    const text = ExactText.parse(raw);
    return this.store.atomic(() => {
      this.expire(owner, callId);
      const blocked = this.gate(owner, callId);
      if (blocked) return blocked;
      const turns = this.turns(owner, callId);
      requireThat(
        turns.length < 20,
        "turn_limit",
        "A fixture is limited to 20 turns.",
      );
      for (const previous of turns.filter((t) => t.state === "pending")) {
        previous.state = "interrupted";
        this.store.save(previous);
      }
      const at = this.now();
      const draft = this.store.get(
        owner,
        "draft",
        this.call(owner, callId).draftId,
      );
      const turn = this.store.add(owner, "turn", {
        callId,
        sequence: turns.length + 1,
        state: "pending",
        source: "fixture",
        transcriptId: this.blob(text),
        endOfTurnAt: at,
        deadlineAt:
          at +
          z
            .number()
            .int()
            .positive()
            .max(RESPONSE_WINDOW_MS)
            .parse(draft.snapshot.responseWindowMs),
      });
      this.store.audit(owner, "conversation.fixture.injected", turn.id);
      return {
        status: "queued",
        callId,
        turnId: turn.id,
        deadlineAt: turn.deadlineAt,
      };
    });
  }
  async nextTurn(
    owner: string,
    callId: string,
    waitMs = 1000,
    signal?: AbortSignal,
  ) {
    z.number().int().min(0).max(25_000).parse(waitMs);
    this.call(owner, callId);
    const start = performance.now();
    for (;;) {
      if (signal?.aborted) return { status: "cancelled", callId };
      const result = this.store.atomic(() => {
        this.expire(owner, callId);
        const blocked = this.gate(owner, callId);
        if (blocked) return blocked;
        const turn = this.turns(owner, callId).find(
          (t) => t.state === "pending",
        );
        if (!turn) return null;
        if (!turn.deliveredAt) {
          turn.deliveredAt = this.now();
          this.store.save(turn);
        }
        return {
          status: "turn",
          callId,
          turnId: turn.id,
          transcript: this.text(turn.transcriptId),
          untrusted: true,
          endOfTurnAt: turn.endOfTurnAt,
          deadlineAt: turn.deadlineAt,
          source: "fixture",
          recording: false,
        };
      });
      if (result) return result;
      const remaining = waitMs - (performance.now() - start);
      if (remaining <= 0)
        return {
          status: "timeout",
          callId,
          waitedMs: Math.round(performance.now() - start),
        };
      try {
        await delay(Math.min(75, remaining), undefined, { signal });
      } catch {
        return { status: "cancelled", callId };
      }
    }
  }
  speak(
    owner: string,
    callId: string,
    turnId: string,
    raw: string,
    idempotencyKey: string,
  ) {
    const text = ExactText.parse(raw);
    z.string().min(8).max(100).parse(idempotencyKey);
    z.string().uuid().parse(turnId);
    return this.store.atomic(() => {
      this.expire(owner, callId);
      const blocked = this.gate(owner, callId);
      if (blocked) return blocked;
      const turns = this.turns(owner, callId);
      const turn = this.store.get(owner, "turn", turnId);
      requireThat(
        turn.callId === callId,
        "turn_call_mismatch",
        "Turn does not belong to this call.",
      );
      const duplicate = turns.find((t) => t.keyHash === digest(idempotencyKey));
      if (duplicate) {
        if (duplicate.id !== turnId || duplicate.replyHash !== digest(text))
          return { status: "idempotency_conflict", callId, turnId };
        return {
          status: "duplicate",
          callId,
          turnId,
          delivery: "captured",
          replyHash: duplicate.replyHash,
          submittedText: this.text(duplicate.replyId),
        };
      }
      if (turn.state !== "pending")
        return { status: "stale_turn", callId, turnId, state: turn.state };
      turn.replyId = this.blob(text);
      turn.replyHash = digest(text);
      turn.keyHash = digest(idempotencyKey);
      turn.submittedAt = this.now();
      turn.codexWaitMs = turn.submittedAt - turn.endOfTurnAt;
      turn.state = "replied";
      this.store.save(turn);
      this.store.audit(owner, "conversation.reply.captured", turn.id);
      return {
        status: "captured",
        callId,
        turnId,
        submittedText: text,
        replyHash: turn.replyHash,
        codexWaitMs: turn.codexWaitMs,
        endOfTurnToFirstAudioMs: null,
        evidence:
          "Exact UTF-8 text captured. No audio synthesized or real telephone latency measured.",
      };
    });
  }
  inspectFixture(owner: string, callId: string) {
    const c = this.call(owner, callId);
    return {
      callId,
      state: c.state,
      endReason: c.endReason,
      source: "fixture",
      recording: false,
      turns: this.turns(owner, callId).map((t) => ({
        turnId: t.id,
        state: t.state,
        transcript: this.text(t.transcriptId),
        submittedText: t.replyId ? this.text(t.replyId) : null,
        fallbackText: t.fallbackId ? this.text(t.fallbackId) : null,
        replyHash: t.replyHash,
        endOfTurnAt: t.endOfTurnAt,
        deliveredAt: t.deliveredAt,
        submittedAt: t.submittedAt,
        codexWaitMs: t.codexWaitMs,
        endOfTurnToFirstAudioMs: null,
      })),
      evidence:
        "Encrypted fictional fixture text only. Captured replies are exact client submissions, not generated by this service. No audio or phone latency claim.",
    };
  }
  tick(owner: string) {
    for (const c of this.store
      .list(owner, "call")
      .filter((c) => c.conversation === "codex" && c.state === "connected"))
      this.store.atomic(() => this.expire(owner, c.id));
    const days = this.store.list(owner, "retention")[0]?.audioDays ?? 30;
    for (const t of this.store
      .list(owner, "turn")
      .filter((t) => t.created < this.now() - days * 86_400_000)) {
      for (const id of [t.transcriptId, t.replyId, t.fallbackId].filter(
        Boolean,
      ))
        this.service.audio.remove(id);
      this.store.remove(owner, "turn", t.id);
    }
  }
}
