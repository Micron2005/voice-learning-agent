import { createHash } from "node:crypto";
import { z } from "zod";
import { Store, Entity, requireThat } from "./store.js";
import {
  DISCLOSURE,
  HELD_OUT,
  KNOWLEDGE,
  PRESETS,
  PROMPTS,
} from "./content.js";
import { PrivateAudio, demoWav } from "./private-audio.js";

const phone = z.string().regex(/^\+[1-9]\d{7,14}$/);
export const DraftInput = z
  .object({
    recipient: phone,
    callerId: z.string().uuid(),
    voiceVersion: z.string().uuid(),
    knowledgeVersion: z.string().uuid(),
    purpose: z.enum(["owner-test", "requested-callback"]),
    duration: z.number().int().min(10).max(180),
    costCapCents: z.number().int().min(0).max(0),
  })
  .strict();
export type DraftParams = z.infer<typeof DraftInput>;
export const activeStates = ["queued", "dialing", "connected", "unknown"];
export const fingerprint = (data: unknown) =>
  createHash("sha256").update(JSON.stringify(data)).digest("hex");

export class VoiceService {
  audio: PrivateAudio;
  constructor(public store: Store) {
    this.audio = new PrivateAudio(store);
  }
  initialize(owner: string) {
    if (!this.store.list(owner, "budget").length)
      this.store.add(owner, "budget", {
        mode: "simulation",
        externalCalling: false,
        capCents: 0,
        spentCents: 0,
        killSwitch: false,
      });
    if (!this.store.list(owner, "knowledge").length)
      this.store.add(owner, "knowledge", {
        text: KNOWLEDGE,
        disclosure: DISCLOSURE,
        confirmedForLive: false,
        version: 1,
      });
    if (!this.store.list(owner, "retention").length)
      this.store.add(owner, "retention", { audioDays: 30 });
  }
  snapshot(owner: string) {
    this.initialize(owner);
    const kinds = [
      "voice",
      "version",
      "asset",
      "preview",
      "knowledge",
      "caller",
      "permission",
      "suppression",
      "draft",
      "call",
      "rating",
      "audit",
      "budget",
      "retention",
    ];
    return {
      mode: "simulation",
      ...Object.fromEntries(kinds.map((k) => [k, this.store.list(owner, k)])),
      heldOut: HELD_OUT,
      prompts: PROMPTS,
      presets: PRESETS,
      worker: this.store.list(owner, "heartbeat").at(-1) ?? null,
      liveBlockers: this.liveBlockers(),
    };
  }
  liveBlockers() {
    return [
      "Live operations are locked in this milestone; no subscriptions, calls, uploads or provider changes are made.",
      "Owner must approve paid plan and explicit usage budget (current cap $0).",
      "Professional clone, personal provider verification and exact model compatibility remain unverified.",
      "Provider-backed caller-ID proof, approved test destination and product-fact confirmation required.",
      "Review ElevenLabs and Twilio recording/transcript retention, signed events, stop/opt-out integration and current calling law.",
      "Real Codex OAuth connection and authorized telephone latency/interruption test remain unverified.",
    ];
  }
  budget(owner: string) {
    this.initialize(owner);
    const b = this.store.list(owner, "budget")[0];
    const reserved = this.store
      .list(owner, "reservation")
      .filter((r) => !r.released)
      .reduce((n, r) => n + r.cents, 0);
    return {
      ...b,
      killSwitch: Boolean(b.killSwitch),
      reservedCents: reserved,
      remainingCents: Math.max(0, b.capCents - b.spentCents - reserved),
      liveEnabled: false,
      previewCostCents: 0,
      evidence:
        "Simulation only; no paid-provider entitlement or trial credits assumed.",
    };
  }
  createVoice(owner: string, name: string) {
    requireThat(
      name.trim().length > 0 && name.length < 100,
      "name",
      "Enter a voice profile name.",
    );
    const v = this.store.add(owner, "voice", {
      name,
      state: "awaiting_consent",
      consentId: null,
      provider: "simulation",
      realCloneReady: false,
    });
    this.store.audit(owner, "voice.created", v.id);
    return v;
  }
  consent(
    owner: string,
    voiceId: string,
    own: boolean,
    providerUpload: boolean,
  ) {
    requireThat(
      own === true,
      "ownership",
      "Only your own voice may be enrolled.",
    );
    const v = this.store.get(owner, "voice", voiceId);
    requireThat(
      v.state !== "revoked",
      "revoked",
      "Create a new profile after revocation.",
    );
    const c = this.store.add(owner, "consent", {
      voiceId,
      wordingVersion: "ownership-v1",
      wording:
        "I am the speaker and own this voice. I authorize private local storage. Separate authorization is required before provider upload.",
      own,
      providerUpload: providerUpload === true,
      provider: "ElevenLabs",
      revoked: false,
    });
    v.consentId = c.id;
    v.state = "not_started";
    this.store.save(v);
    this.store.audit(owner, "voice.consent", v.id);
    return c;
  }
  validVoice(owner: string, voiceId: string) {
    const v = this.store.get(owner, "voice", voiceId);
    requireThat(
      v.state !== "revoked" && v.consentId,
      "voice_consent",
      "Voice ownership consent is missing or revoked.",
    );
    const c = this.store.get(owner, "consent", v.consentId);
    requireThat(
      c.own && !c.revoked,
      "voice_consent",
      "Voice consent is revoked.",
    );
    return v;
  }
  enrollSimulation(owner: string, voiceId: string) {
    return this.store.atomic(() => {
      const v = this.validVoice(owner, voiceId);
      requireThat(
        !["processing", "ready"].includes(v.state),
        "enrollment_state",
        "Simulation is already processing or ready.",
      );
      v.state = "processing";
      this.store.save(v);
      this.store.job(owner, "enroll", v.id);
      return v;
    });
  }
  version(owner: string, id: string) {
    const ver = this.store.get(owner, "version", id);
    const v = this.validVoice(owner, ver.voiceId);
    requireThat(
      v.state === "ready" && ver.ready,
      "voice_unready",
      "Voice model is not ready.",
    );
    return ver;
  }
  preview(
    owner: string,
    versionId: string,
    sentence: number,
    preset: "studio" | "conversation",
  ) {
    requireThat(
      Number.isInteger(sentence) && sentence >= 0 && sentence < HELD_OUT.length,
      "sentence",
      "Choose a held-out sentence.",
    );
    requireThat(preset in PRESETS, "preset", "Choose studio or conversation.");
    return this.store.atomic(() => {
      const v = this.version(owner, versionId);
      requireThat(
        !this.budget(owner).killSwitch,
        "kill_switch",
        "Global kill switch is enabled.",
      );
      requireThat(
        v.provider === "simulation",
        "paid_disabled",
        "Paid speech preview is disabled at a $0 cap.",
      );
      const p = this.store.add(owner, "preview", {
        versionId,
        sentence,
        text: HELD_OUT[sentence],
        preset,
        settings: PRESETS[preset],
        dictionary: v.dictionary,
        mode: "simulation",
        state: "queued",
        audioId: null,
        label: "MOCK calibration tone — not speech, not your voice clone.",
      });
      this.store.job(owner, "preview", p.id);
      this.store.audit(owner, "preview.queued", p.id);
      return p;
    });
  }
  previewResult(owner: string, id: string) {
    const p = this.store.get(owner, "preview", id);
    this.version(owner, p.versionId);
    if (p.state !== "ready") return p;
    const expires = Date.now() + 120_000;
    return {
      ...p,
      privateAudioUrl: `/api/audio/${p.audioId}?owner=${owner}&expires=${expires}&signature=${this.audio.sign(owner, p.audioId, expires)}`,
      expires,
    };
  }
  rate(owner: string, input: any) {
    const data = z
      .object({
        previewId: z.string().uuid(),
        likeness: z.number().int().min(1).max(5),
        naturalness: z.number().int().min(1).max(5),
        pronunciation: z.number().int().min(1).max(5),
        consistency: z.number().int().min(1).max(5),
        materialError: z.boolean(),
        notes: z.string().max(1000),
        telephone: z.boolean(),
      })
      .strict()
      .parse(input);
    const p = this.store.get(owner, "preview", data.previewId);
    requireThat(
      p.state === "ready",
      "preview_unready",
      "Preview is not ready.",
    );
    this.version(owner, p.versionId);
    return this.store.add(owner, "rating", {
      ...data,
      versionId: p.versionId,
      sentence: p.sentence,
      simulated: p.mode === "simulation",
      evidence:
        p.mode === "simulation"
          ? "UI practice only; excluded from real voice acceptance."
          : "Owner subjective rating.",
    });
  }
  approveVersion(owner: string, id: string) {
    const v = this.version(owner, id);
    const ratings = this.store
      .list(owner, "rating")
      .filter((r) => r.versionId === id && !r.simulated);
    const latest = new Map(
      ratings.map((r) => [`${r.sentence}:${r.telephone}`, r]),
    );
    if (v.provider !== "simulation") {
      requireThat(
        HELD_OUT.every((_, i) =>
          [false, true].every((telephone) => {
            const r = latest.get(`${i}:${telephone}`);
            return (
              r && r.likeness >= 4 && r.naturalness >= 4 && !r.materialError
            );
          }),
        ),
        "quality_target",
        "Rate every held-out sentence in studio and telephone audio. Likeness and naturalness must be at least 4/5 with no material errors.",
      );
    }
    v.approved = true;
    v.approvedAt = Date.now();
    v.acceptance =
      v.provider === "simulation"
        ? "Simulation configuration only. No real voice acceptance."
        : "Owner accepted";
    this.store.save(v);
    this.store.audit(owner, "version.approved", id);
    return v;
  }
  newVersion(owner: string, id: string, dictionary: string) {
    const v = this.version(owner, id);
    requireThat(
      dictionary.length <= 4000,
      "dictionary",
      "Pronunciation dictionary is too long.",
    );
    return this.store.add(owner, "version", {
      voiceId: v.voiceId,
      provider: v.provider,
      ready: v.ready,
      dictionary,
      settings: PRESETS,
      approved: false,
      previousVersion: v.id,
      realCloneReady: false,
    });
  }
  rollback(owner: string, id: string) {
    const v = this.version(owner, id);
    requireThat(
      v.approved,
      "approval",
      "Only an explicitly approved version can be restored.",
    );
    const profile = this.store.get(owner, "voice", v.voiceId);
    profile.activeVersion = id;
    this.store.save(profile);
    this.store.audit(owner, "version.rollback", id);
    return profile;
  }
  permissionStatus(owner: string, number: string, purpose?: string) {
    phone.parse(number);
    const suppressed = this.store
      .list(owner, "suppression")
      .some((s) => s.number === number);
    const permissions = this.store
      .list(owner, "permission")
      .filter(
        (p) =>
          p.number === number &&
          !p.revoked &&
          (!purpose || p.purpose === purpose),
      );
    return {
      number,
      suppressed,
      allowed: !suppressed && permissions.length > 0,
      permissions,
      evidence:
        "Locally recorded permission; not independently verified legal consent.",
    };
  }
  permission(owner: string, input: any) {
    const data = z
      .object({
        number: phone,
        purpose: z.enum(["owner-test", "requested-callback"]),
        wording: z.string().min(10).max(2000),
        source: z.string().min(3).max(300),
      })
      .strict()
      .parse(input);
    requireThat(
      !this.permissionStatus(owner, data.number).suppressed,
      "suppressed",
      "Destination is suppressed; a new permission cannot remove suppression.",
    );
    return this.store.add(owner, "permission", {
      ...data,
      wordingVersion: "pilot-permission-v1",
      recordedAt: Date.now(),
      revoked: false,
      mode: "simulation",
      providerVerified: false,
    });
  }
  caller(owner: string, number: string) {
    phone.parse(number);
    return this.store.add(owner, "caller", {
      number,
      provider: "simulation",
      verified: false,
      simulationOnly: true,
      outbound: "simulation only",
      inbound: false,
      evidence:
        "Not provider-backed verification. Callbacks would remain with your original phone provider.",
    });
  }
  saveKnowledge(owner: string, text: string) {
    requireThat(
      text.trim().length >= 50 && text.length <= 12000,
      "knowledge",
      "Knowledge must contain 50–12,000 characters.",
    );
    const v = this.store.add(owner, "knowledge", {
      text,
      disclosure: DISCLOSURE,
      confirmedForLive: false,
      version: this.store.list(owner, "knowledge").length + 1,
    });
    this.store.audit(owner, "knowledge.versioned", v.id);
    return v;
  }
  readiness(owner: string, input: DraftParams) {
    const b = this.budget(owner);
    requireThat(!b.killSwitch, "kill_switch", "Global kill switch is enabled.");
    const v = this.version(owner, input.voiceVersion);
    requireThat(
      v.approved,
      "voice_approval",
      "Approve the voice configuration in Quality Lab first.",
    );
    const caller = this.store.get(owner, "caller", input.callerId);
    requireThat(
      caller.simulationOnly && v.provider === "simulation",
      "live_disabled",
      "Only clearly labeled simulated calls are supported at the current $0 cap.",
    );
    const permission = this.permissionStatus(
      owner,
      input.recipient,
      input.purpose,
    );
    requireThat(
      permission.allowed,
      permission.suppressed ? "suppressed" : "recipient_permission",
      "Destination is suppressed or has no active permission for this purpose.",
    );
    const knowledge = this.store.get(
      owner,
      "knowledge",
      input.knowledgeVersion,
    );
    return { v, caller, knowledge, permission: permission.permissions.at(-1)! };
  }
  prepare(owner: string, raw: unknown) {
    const input = DraftInput.parse(raw);
    const r = this.readiness(owner, input);
    const snapshot = {
      ...input,
      callerNumber: r.caller.number,
      voice: { id: r.v.id, settings: r.v.settings, dictionary: r.v.dictionary },
      knowledge: {
        id: r.knowledge.id,
        text: r.knowledge.text,
        disclosure: DISCLOSURE,
      },
      permissionId: r.permission.id,
      mode: "simulation",
      estimatedCents: 0,
      recording: false,
      persistentTranscript: false,
    };
    const draft = this.store.add(owner, "draft", {
      input,
      snapshot,
      fingerprint: fingerprint(snapshot),
      expires: Date.now() + 15 * 60_000,
    });
    this.store.audit(owner, "call.prepared", draft.id);
    return draft;
  }
  getDraft(owner: string, id: string) {
    const d = this.store.get(owner, "draft", id);
    return {
      ...d,
      authorization: this.store
        .list(owner, "grant")
        .filter(
          (g) =>
            g.draftId === id && !g.used && !g.revoked && g.expires > Date.now(),
        )
        .map((g) => ({ id: g.id, expires: g.expires })),
      requirements: [
        "Exact snapshot approval by operator UI",
        "Single-use grant expires after 2 minutes",
        "Suppression, consent and budget rechecked immediately before execution",
      ],
    };
  }
  authorizeFromUI(owner: string, id: string) {
    return this.store.atomic(() => {
      const d = this.store.get(owner, "draft", id);
      this.readiness(owner, d.input);
      requireThat(
        d.expires > Date.now(),
        "draft_expired",
        "Prepare a fresh draft.",
      );
      const existing = this.store
        .list(owner, "grant")
        .find(
          (g) =>
            g.draftId === id && !g.used && !g.revoked && g.expires > Date.now(),
        );
      if (existing) return existing;
      const g = this.store.add(owner, "grant", {
        draftId: id,
        fingerprint: d.fingerprint,
        expires: Date.now() + 120_000,
        used: false,
        revoked: false,
        source: "authenticated-operator-ui",
      });
      this.store.audit(owner, "call.authorized", id);
      return g;
    });
  }
  place(owner: string, draftId: string, idempotencyKey: string) {
    requireThat(
      idempotencyKey.length >= 8 && idempotencyKey.length <= 100,
      "idempotency",
      "Use an idempotency key of 8–100 characters.",
    );
    return this.store.atomic(() => {
      const previous = this.store
        .list(owner, "call")
        .find((c) => c.idempotencyKey === idempotencyKey);
      if (previous) {
        requireThat(
          previous.draftId === draftId,
          "idempotency_conflict",
          "Key was used for a different draft.",
        );
        return previous;
      }
      const d = this.store.get(owner, "draft", draftId);
      requireThat(d.expires > Date.now(), "draft_expired", "Draft expired.");
      requireThat(
        fingerprint(d.snapshot) === d.fingerprint,
        "draft_changed",
        "Draft no longer matches authorization.",
      );
      this.readiness(owner, d.input);
      requireThat(
        !this.store
          .list(owner, "call")
          .some((c) => activeStates.includes(c.state)),
        "one_call",
        "One active or uncertain call is allowed at a time. Stop or reconcile it first.",
      );
      const g = this.store
        .list(owner, "grant")
        .find(
          (g) =>
            g.draftId === draftId &&
            g.fingerprint === d.fingerprint &&
            !g.used &&
            !g.revoked &&
            g.expires > Date.now(),
        );
      requireThat(
        g,
        "operator_authorization",
        "Review and authorize this exact draft in the operator UI. MCP cannot authorize calls.",
      );
      requireThat(
        !this.store.list(owner, "call").some((c) => c.draftId === draftId),
        "single_use",
        "A call already exists for this draft. No redial.",
      );
      g.used = true;
      this.store.save(g);
      const c = this.store.add(owner, "call", {
        draftId,
        idempotencyKey,
        state: "queued",
        mode: "simulation",
        providerId: `sim_${d.id}`,
        number: d.input.recipient,
        duration: d.input.duration,
        timeline: [{ state: "queued", at: Date.now() }],
        summary: "Queued simulation. No real call was placed.",
        recording: false,
        transcript: null,
      });
      const reservation = this.store.add(owner, "reservation", {
        callId: c.id,
        cents: 0,
        released: false,
      });
      c.reservationId = reservation.id;
      this.store.save(c);
      this.store.job(owner, "call", c.id);
      this.store.audit(owner, "call.queued.simulation", c.id);
      return c;
    });
  }
  transition(call: Entity, state: string) {
    call.state = state;
    call.timeline.push({ state, at: Date.now() });
    if (["completed", "stopped", "failed"].includes(state)) {
      call.ended = Date.now();
      call.summary = `${state === "completed" ? "Simulation finished" : `Simulation ${state}`}. No person was contacted. No real sales outcome, voice likeness or telephone latency was measured.`;
      if (call.reservationId) {
        const r = this.store.get(call.owner, "reservation", call.reservationId);
        r.released = true;
        this.store.save(r);
      }
    }
    return this.store.save(call);
  }
  stop(owner: string, id: string, refusal = false) {
    return this.store.atomic(() => {
      const c = this.store.get(owner, "call", id);
      if (refusal && !this.permissionStatus(owner, c.number).suppressed)
        this.store.add(owner, "suppression", {
          number: c.number,
          reason: "Simulated spoken refusal/keypad opt-out",
          at: Date.now(),
          sourceCall: id,
        });
      if (activeStates.includes(c.state)) this.transition(c, "stopped");
      this.store.audit(owner, refusal ? "call.optout" : "call.stopped", id);
      return c;
    });
  }
  kill(owner: string, enabled: boolean) {
    const b = this.store.list(owner, "budget")[0];
    b.killSwitch = enabled;
    this.store.save(b);
    if (enabled)
      for (const c of this.store.list(owner, "call"))
        if (activeStates.includes(c.state)) this.stop(owner, c.id);
    this.store.audit(owner, enabled ? "kill.enabled" : "kill.disabled", b.id);
    return b;
  }
  revokeVoice(owner: string, id: string) {
    const v = this.store.get(owner, "voice", id);
    v.state = "revoked";
    this.store.save(v);
    for (const consent of this.store
      .list(owner, "consent")
      .filter((c) => c.voiceId === id)) {
      consent.revoked = true;
      this.store.save(consent);
    }
    for (const c of this.store
      .list(owner, "call")
      .filter((c) => activeStates.includes(c.state))) {
      const d = this.store.get(owner, "draft", c.draftId);
      if (this.store.get(owner, "version", d.input.voiceVersion).voiceId === id)
        this.stop(owner, c.id);
    }
    this.store.audit(owner, "voice.revoked", id);
    return v;
  }
  deleteAsset(owner: string, id: string) {
    const asset = this.store.get(owner, "asset", id);
    this.audio.remove(id);
    for (const p of this.store
      .list(owner, "preview")
      .filter((p) => p.audioId === id)) {
      p.state = "deleted";
      p.audioId = null;
      this.store.save(p);
    }
    this.store.remove(owner, "asset", id);
    this.store.audit(owner, `asset.deleted.${asset.role}`, id);
  }
  tick() {
    const owners = this.store.db.prepare("SELECT id FROM operators").all() as {
      id: string;
    }[];
    for (const { id: owner } of owners) {
      const h = this.store.list(owner, "heartbeat")[0];
      if (h) {
        h.at = Date.now();
        this.store.save(h);
      } else this.store.add(owner, "heartbeat", { at: Date.now() });
      const days = this.store.list(owner, "retention")[0]?.audioDays ?? 30;
      for (const a of this.store.list(owner, "asset"))
        if (a.created < Date.now() - days * 86400_000)
          this.deleteAsset(owner, a.id);
    }
    for (const table of ["sessions", "oauth_codes", "oauth_tokens"])
      this.store.db
        .prepare(`DELETE FROM ${table} WHERE expires < ?`)
        .run(Date.now());
    const jobs = this.store.db
      .prepare(
        "SELECT * FROM jobs WHERE state='pending' OR (state='running' AND lease < ?) ORDER BY created LIMIT 10",
      )
      .all(Date.now());
    for (const j of jobs) {
      this.store.atomic(() => {
        const claimed = this.store.db
          .prepare(
            "UPDATE jobs SET state='running',lease=? WHERE id=? AND (state='pending' OR (state='running' AND lease < ?))",
          )
          .run(Date.now() + 30_000, j.id as string, Date.now());
        if (!claimed.changes) return;
        const owner = j.owner as string;
        try {
          if (j.kind === "enroll") {
            const v = this.validVoice(owner, j.target as string);
            if (v.state !== "ready") {
              const ver = this.store.add(owner, "version", {
                voiceId: v.id,
                provider: "simulation",
                ready: true,
                realCloneReady: false,
                approved: false,
                settings: PRESETS,
                dictionary:
                  "Vultrix: VULL-tricks; Mukarram: owner to confirm pronunciation",
              });
              v.state = "ready";
              v.activeVersion = ver.id;
              v.readinessEvidence =
                "Simulation fixture only. No recordings sent, no training or provider verification performed.";
              this.store.save(v);
            }
          } else if (j.kind === "preview") {
            const p = this.store.get(owner, "preview", j.target as string);
            this.version(owner, p.versionId);
            requireThat(
              !this.budget(owner).killSwitch,
              "kill_switch",
              "Preview canceled by kill switch.",
            );
            if (p.state !== "ready") {
              const asset = this.store.add(owner, "asset", {
                role: "preview",
                versionId: p.versionId,
                mime: "audio/wav",
                simulated: true,
              });
              this.audio.put(asset.id, demoWav());
              p.audioId = asset.id;
              p.state = "ready";
              this.store.save(p);
            }
          } else if (j.kind === "call") {
            const c = this.store.get(owner, "call", j.target as string);
            if (!activeStates.includes(c.state)) {
              this.store.db
                .prepare("UPDATE jobs SET state='done' WHERE id=?")
                .run(j.id as string);
              return;
            }
            const d = this.store.get(owner, "draft", c.draftId);
            this.readiness(owner, d.input);
            const elapsed = Date.now() - c.created;
            const next =
              elapsed >= c.duration * 1000
                ? "completed"
                : elapsed > 3000
                  ? "connected"
                  : elapsed > 1000
                    ? "dialing"
                    : "queued";
            if (next !== c.state) this.transition(c, next);
            if (next !== "completed") {
              this.store.db
                .prepare("UPDATE jobs SET state='running',lease=? WHERE id=?")
                .run(Date.now() + 500, j.id as string);
              return;
            }
          }
          this.store.db
            .prepare("UPDATE jobs SET state='done' WHERE id=?")
            .run(j.id as string);
        } catch (e: any) {
          if (j.kind === "call") {
            const c = this.store.get(owner, "call", j.target as string);
            if (activeStates.includes(c.state)) this.transition(c, "failed");
          }
          if (j.kind === "preview") {
            const p = this.store.get(owner, "preview", j.target as string);
            p.state = "failed";
            p.error = e.message;
            this.store.save(p);
          }
          this.store.db
            .prepare("UPDATE jobs SET state='failed',error=? WHERE id=?")
            .run(
              "Operation blocked. Check consent, suppression, readiness and kill switch.",
              j.id as string,
            );
        }
      });
    }
  }
}
