import { createHmac, timingSafeEqual } from "node:crypto";
import { Fault, requireThat, Store } from "./store.js";

export interface LivePermit {
  operatorApproved: boolean;
  providerUploadApproved: boolean;
  identityVerified: boolean;
  modelCompatible: boolean;
  knowledgeConfirmed: boolean;
  callerVerified: boolean;
  recipientPermitted: boolean;
  suppressed: boolean;
  retentionReviewed: boolean;
  capCents: number;
  reservedCents: number;
  estimateCents: number;
}
export function paidPreflight(p: LivePermit) {
  requireThat(
    p.operatorApproved === true &&
      p.identityVerified === true &&
      p.modelCompatible === true &&
      p.retentionReviewed === true,
    "activation_required",
    "Owner approval, personal verification, exact voice/model compatibility and provider retention review are required.",
  );
  requireThat(
    [p.capCents, p.reservedCents, p.estimateCents].every(
      Number.isSafeInteger,
    ) &&
      p.reservedCents >= 0 &&
      p.capCents > 0 &&
      p.estimateCents > 0 &&
      p.reservedCents + p.estimateCents <= p.capCents,
    "budget",
    "A positive owner-approved budget with sufficient unreserved funds is required. No trial credits are assumed.",
  );
}
type Fetch = typeof fetch;
const encoded = (s: string) => {
  requireThat(
    /^[A-Za-z0-9_-]{1,100}$/.test(s),
    "provider_id",
    "Invalid provider identifier.",
  );
  return encodeURIComponent(s);
};

// These contracts are deliberately not reachable from the simulation service's write paths.
// Activation requires a separate reviewed integration, not an environment toggle.
export class ElevenLabsAdapter {
  constructor(
    private apiKey: string,
    private send: Fetch = fetch,
  ) {}
  private async request(
    path: string,
    init: RequestInit = {},
    binary = false,
  ): Promise<any> {
    requireThat(
      this.apiKey,
      "missing_key",
      "Configure the server-side ElevenLabs key for read-only readiness inspection.",
    );
    let response: globalThis.Response;
    try {
      response = await this.send(`https://api.elevenlabs.io/v1${path}`, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
        headers: {
          "xi-api-key": this.apiKey,
          ...(init.body instanceof FormData
            ? {}
            : { "content-type": "application/json" }),
          ...init.headers,
        },
      });
    } catch {
      throw new Fault(
        init.method && init.method !== "GET"
          ? "provider_unknown"
          : "provider_unavailable",
        "Provider response uncertain. Do not repeat a create request; reconcile provider history/IDs first.",
        503,
      );
    }
    if (!response.ok) {
      const code =
        response.status === 401
          ? "provider_credentials"
          : response.status === 402 || response.status === 403
            ? "provider_access"
            : response.status === 404
              ? "provider_not_found"
              : "provider_error";
      throw new Fault(
        code,
        `ElevenLabs returned HTTP ${response.status}. Check key scope, paid-plan eligibility, asset ownership and account limits. No voice substitution or automatic retry.`,
        502,
      );
    }
    return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
  }
  async voiceStatus(voiceId: string, model: string) {
    const v = await this.request(`/voices/${encoded(voiceId)}`);
    const modelState = v.fine_tuning?.state?.[model] ?? "unknown";
    return {
      provider: "elevenlabs",
      voiceId: v.voice_id,
      category: v.category ?? "unknown",
      isOwner: v.is_owner === true,
      model,
      modelState,
      compatible: modelState === "fine_tuned",
      readiness:
        modelState === "fine_tuned" &&
        v.is_owner === true &&
        v.category === "professional"
          ? "model_reported_ready_requires_owner_acceptance"
          : "not_ready",
      verification:
        "Complete provider verification personally. Voice metadata alone is not owner acceptance.",
      message: v.fine_tuning?.message?.[model] ?? null,
    };
  }
  async agentStatus(id: string) {
    const a = await this.request(`/convai/agents/${encoded(id)}`);
    return {
      agentId: a.agent_id,
      voiceId: a.conversation_config?.tts?.voice_id ?? null,
      model: a.conversation_config?.tts?.model_id ?? null,
      privacy: a.platform_settings?.privacy ?? null,
      evidence:
        "Read-only agent configuration; inspect privacy/retention separately in ElevenLabs and Twilio.",
    };
  }
  async createVoice(name: string, language: string, p: LivePermit) {
    paidPreflight(p);
    requireThat(
      p.providerUploadApproved,
      "upload_consent",
      "Explicit provider-upload authorization required.",
    );
    return this.request("/voices/pvc", {
      method: "POST",
      body: JSON.stringify({ name, language }),
    });
  }
  async uploadReference(
    id: string,
    files: { bytes: Buffer; filename: string }[],
    p: LivePermit,
  ) {
    paidPreflight(p);
    requireThat(
      p.providerUploadApproved,
      "upload_consent",
      "Explicit authorization to send recordings to ElevenLabs is required.",
    );
    const body = new FormData();
    for (const file of files)
      body.append(
        "files",
        new Blob([new Uint8Array(file.bytes)]),
        file.filename,
      );
    body.append("remove_background_noise", "false");
    return this.request(`/voices/pvc/${encoded(id)}/samples`, {
      method: "POST",
      body,
    });
  }
  async train(id: string, model: string, p: LivePermit) {
    paidPreflight(p);
    return this.request(`/voices/pvc/${encoded(id)}/train`, {
      method: "POST",
      body: JSON.stringify({ model_id: model }),
    });
  }
  async preview(id: string, text: string, model: string, p: LivePermit) {
    paidPreflight(p);
    requireThat(
      text.length > 0 && text.length <= 500,
      "bounded_preview",
      "Preview text must be 1–500 characters.",
    );
    return this.request(
      `/text-to-speech/${encoded(id)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        body: JSON.stringify({
          text,
          model_id: model,
          apply_text_normalization: "on",
        }),
      },
      true,
    );
  }
  async createCall(
    agentId: string,
    phoneId: string,
    recipient: string,
    p: LivePermit,
  ) {
    paidPreflight(p);
    requireThat(
      p.knowledgeConfirmed &&
        p.callerVerified &&
        p.recipientPermitted &&
        !p.suppressed,
      "call_permission",
      "Verified caller, approved knowledge and unsuppressed recipient permission are required.",
    );
    requireThat(
      /^\+[1-9]\d{7,14}$/.test(recipient),
      "recipient",
      "Use an E.164 number.",
    );
    const r = await this.request("/convai/twilio/outbound-call", {
      method: "POST",
      body: JSON.stringify({
        agent_id: encoded(agentId),
        agent_phone_number_id: encoded(phoneId),
        to_number: recipient,
        call_recording_enabled: false,
        telephony_call_config: {
          twilio_call_recording_enabled: false,
          ringing_timeout_secs: 20,
        },
      }),
    });
    return {
      state: r.success === true ? "queued" : "failed",
      conversationId: r.conversation_id ?? null,
      callSid: r.callSid ?? null,
      evidence:
        "Create response is not a connected or successful sales conversation. Agent voice, script, limits and retention must already match the approved snapshot.",
    };
  }
  async callStatus(conversationId: string) {
    const c = await this.request(
      `/convai/conversations/${encoded(conversationId)}`,
    );
    return {
      conversationId: c.conversation_id,
      providerState: c.status,
      state:
        c.status === "done"
          ? "completed"
          : c.status === "failed"
            ? "failed"
            : c.status === "in-progress"
              ? "connected"
              : c.status === "initiated"
                ? "dialing"
                : "unknown",
      evidence:
        "Provider conversation status only. Completion is not evidence of a successful sale or human answer.",
    };
  }
  async deleteVoice(id: string, confirm: string) {
    requireThat(
      confirm === "DELETE PROVIDER VOICE",
      "confirmation",
      "Explicit provider deletion confirmation required.",
    );
    return this.request(`/voices/${encoded(id)}`, { method: "DELETE" });
  }
}

export class TwilioAdapter {
  constructor(
    private accountSid: string,
    private authToken: string,
    private send: Fetch = fetch,
  ) {}
  private async request(path: string, init: RequestInit = {}) {
    requireThat(
      /^AC[a-fA-F0-9]{32}$/.test(this.accountSid) && this.authToken,
      "twilio_key",
      "Server-side Twilio credentials required.",
    );
    const res = await this.send(
      `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/${path}.json`,
      {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")}`,
          ...init.headers,
        },
      },
    );
    requireThat(
      res.ok,
      "twilio_error",
      `Twilio returned HTTP ${res.status}. Inspect account permissions and call state.`,
      502,
    );
    return res.json();
  }
  async verifyCaller(id: string, expectedNumber: string) {
    requireThat(
      /^PN[a-fA-F0-9]{32}$/.test(id),
      "caller_id",
      "Use the provider-backed OutgoingCallerId SID, not an arbitrary phone string.",
    );
    const c = await this.request(`OutgoingCallerIds/${id}`);
    return {
      verified: c.sid === id && c.phone_number === expectedNumber,
      number: c.phone_number,
      inboundCapable: false,
      evidence:
        "External verified outbound caller ID. No porting, forwarding or inbound AI routing is configured.",
    };
  }
  async stop(callSid: string) {
    requireThat(
      /^CA[a-fA-F0-9]{32}$/.test(callSid),
      "call_sid",
      "A real provider CallSid is required to terminate a real call.",
    );
    const c = await this.request(`Calls/${callSid}`, {
      method: "POST",
      body: new URLSearchParams({ Status: "completed" }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    return {
      callSid: c.sid,
      providerState: c.status,
      stopped: ["completed", "canceled"].includes(c.status),
    };
  }
}

export function verifyElevenWebhook(
  raw: Buffer,
  signature: string,
  secret: string,
  now = Date.now(),
) {
  const fields = signature.split(",").map((x) => x.trim().split("="));
  const timestamp = fields.find((x) => x[0] === "t")?.[1],
    signatures = fields.filter((x) => x[0] === "v0").map((x) => x[1]);
  if (
    !secret ||
    !timestamp ||
    !/^\d+$/.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300
  )
    return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(raw)
    .digest();
  return signatures.some((s) => {
    if (!/^[a-fA-F0-9]{64}$/.test(s)) return false;
    const b = Buffer.from(s, "hex");
    return b.length === expected.length && timingSafeEqual(b, expected);
  });
}

export function acceptProviderEvent(
  store: Store,
  event: {
    id: string;
    conversationId: string;
    state: "completed" | "failed";
    at: number;
  },
) {
  return store.atomic(() => {
    if (
      store.db
        .prepare("SELECT id FROM provider_events WHERE id=?")
        .get(event.id)
    )
      return { duplicate: true };
    store.db
      .prepare("INSERT INTO provider_events VALUES (?,?,?)")
      .run(event.id, Date.now(), event.state);
    const row = store.db
      .prepare(
        "SELECT data FROM records WHERE kind='call' AND json_extract(data,'$.mode')='live' AND json_extract(data,'$.conversationId')=?",
      )
      .get(event.conversationId);
    if (!row) return { ignored: true };
    const call = JSON.parse(row.data as string);
    if (
      event.at <= (call.lastProviderAt ?? 0) ||
      ["stopped", "completed", "failed"].includes(call.state)
    )
      return { stale: true };
    call.state = event.state;
    call.lastProviderAt = event.at;
    call.timeline.push({ state: event.state, at: event.at });
    store.save(call);
    return { applied: true };
  });
}

export function latencyReport(
  samples: { responseMs: number; interruptionStopMs?: number }[],
) {
  const values = samples.map((s) => s.responseMs).sort((a, b) => a - b);
  const percentile = (p: number) =>
    values.length
      ? values[Math.max(0, Math.ceil(p * values.length) - 1)]
      : null;
  return {
    samples: values.length,
    medianMs: percentile(0.5),
    p95Ms: percentile(0.95),
    targetMedianMs: 1500,
    targetP95Ms: 3000,
    interruptionSamples: samples.filter(
      (s) => s.interruptionStopMs !== undefined,
    ).length,
    evidence: values.length
      ? "Only supplied measurements; caller device, network and sample size constrain interpretation."
      : "Unmeasured. Requires an approved real telephone test; no simulated latency is reported as real.",
  };
}
