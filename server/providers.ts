import { z } from "zod";
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

export class TwilioAdapter {
  constructor(
    private accountSid: string,
    private authToken: string,
    private send: Fetch = fetch,
  ) {}
  private async request(path: string, init: RequestInit = {}, query = "") {
    requireThat(
      /^AC[a-fA-F0-9]{32}$/.test(this.accountSid) && this.authToken,
      "twilio_key",
      "Server-side Twilio credentials required.",
    );
    let res: globalThis.Response;
    try {
      res = await this.send(
        `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}${path ? `/${path}` : ""}.json${query}`,
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
    } catch {
      throw new Fault(
        init.method === "POST" ? "provider_unknown" : "twilio_unavailable",
        init.method === "POST"
          ? "Twilio response uncertain. Inspect the provider call state before retrying."
          : "Twilio could not be reached. Check the connection and retry this read-only inspection.",
        503,
      );
    }
    requireThat(
      res.ok,
      "twilio_error",
      `Twilio returned HTTP ${res.status}. Check server credentials and account permissions. No raw provider response is exposed.`,
      502,
    );
    try {
      return await res.json();
    } catch {
      throw new Fault(
        "twilio_response",
        "Twilio returned an unreadable response.",
        502,
      );
    }
  }
  async inspectSetup() {
    const account = z
      .object({
        sid: z.literal(this.accountSid),
        type: z.enum(["Trial", "Full"]),
        status: z.enum(["active", "suspended", "closed"]),
      })
      .safeParse(await this.request(""));
    requireThat(
      account.success,
      "twilio_response",
      "Twilio account metadata could not be verified.",
      502,
    );
    const { type, status } = account.data;
    const trialAccountActive = type === "Trial" && status === "active";
    const number = z.string().regex(/^\+[1-9]\d{7,14}$/);
    const phoneSchema = z.object({
      incoming_phone_numbers: z
        .array(
          z.object({
            phone_number: number,
            capabilities: z.object({ voice: z.boolean() }),
          }),
        )
        .max(50),
      next_page_uri: z.string().nullable().optional(),
    });
    const callerSchema = z.object({
      outgoing_caller_ids: z.array(z.object({ phone_number: number })).max(50),
      next_page_uri: z.string().nullable().optional(),
    });
    let phoneNumbers: { numberMasked: string; voiceCapable: boolean }[] = [];
    let verifiedCallerIds: { numberMasked: string }[] = [];
    let listsTruncated = false;
    if (trialAccountActive) {
      const [phoneData, callerData] = await Promise.all([
        this.request("IncomingPhoneNumbers", {}, "?PageSize=50"),
        this.request("OutgoingCallerIds", {}, "?PageSize=50"),
      ]);
      const phones = phoneSchema.safeParse(phoneData),
        callers = callerSchema.safeParse(callerData);
      requireThat(
        phones.success && callers.success,
        "twilio_response",
        "Twilio number metadata could not be verified.",
        502,
      );
      phoneNumbers = phones.data.incoming_phone_numbers.map((n) => ({
        numberMasked: `Ending ${n.phone_number.slice(-4)}`,
        voiceCapable: n.capabilities.voice,
      }));
      verifiedCallerIds = callers.data.outgoing_caller_ids.map((n) => ({
        numberMasked: `Ending ${n.phone_number.slice(-4)}`,
      }));
      listsTruncated = Boolean(
        phones.data.next_page_uri || callers.data.next_page_uri,
      );
    }
    return {
      checkedAt: new Date().toISOString(),
      account: { type, status },
      trialAccountActive,
      resourcesChecked: trialAccountActive,
      phoneNumbers,
      verifiedCallerIds,
      listsTruncated,
      quotaConfirmed: false,
      minutesRemaining: null,
      liveEnabled: false,
      canPlaceCalls: false,
      approvedSpendCents: 0,
      limitations: [
        "An active trial is not proof of remaining free minutes or eligibility for a specific call. Check Twilio's Voice free-units tracker; nothing is purchased here.",
        "The standard number APIs may not list resources managed by the newer Try out Voice flow. An empty list is not proof that your signup phone is unverified.",
        "A verified caller ID is not proof of recipient consent, ownership by this app's operator, or permission for sales outreach.",
        "Live dialing, conversational AI, voice cloning, provider stop/reconciliation and exact live-call authorization remain unfinished. This app cannot place a real call.",
      ],
    };
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

export type TwilioSetupReport = Awaited<
  ReturnType<TwilioAdapter["inspectSetup"]>
>;

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
