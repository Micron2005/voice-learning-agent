# Live activation: not implemented or approved in this milestone

**Nothing in this app currently places real calls or creates a real clone.** Environment keys, stored provider IDs, local consent or a simulation approval cannot activate paid execution. The dormant adapters are mock-tested API contracts, not a complete production runtime. Keep the current budget at $0 and do not purchase plans/credits/numbers on the owner's behalf.

## One consolidated owner setup list — for a later live milestone

1. **Private HTTPS hosting** reachable by the chosen ChatGPT/Codex client, with owner approval, encrypted persistent storage, backups, process monitoring and patched ffmpeg. No deployment or DNS changes have been performed.
2. **ElevenLabs account and current eligibility** for Professional Voice Cloning and the actual conversation model. Do not assume a free clone or usable trial credits. Obtain the least-privilege server API key through a secret manager; optional read-only inspection uses `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_AGENT_ID`. Never paste keys into ChatGPT or the browser UI.
3. **Personal voice verification** performed by Mukarram in ElevenLabs. Ownership attestation here does not replace it. Record clean, unprocessed, single-speaker speech: provider guidance recommends at least 30 minutes and ideally 1–3 hours. Do not upload recordings until provider-upload consent is explicit. No alternative voice may be substituted silently.
4. **Owner voice acceptance**: real held-out speech for both studio and the actual low-latency agent model; playback level matching; at least 4/5 owner likeness and naturalness across the held-out set, with no material errors in names/prices/numbers. Collect actual ratings, not these mock practice scores. Test real telephone bandwidth and interruption behavior; target median response below 1.5 s and p95 below 3 s, reporting actual measurements and constraints.
5. **Twilio ownership and connection**: account access and least-privilege server credentials, plus the ElevenAgents phone integration/phone ID and webhook secret. Verify the existing number using the provider's own proof-of-control flow. An external verified caller ID is outbound-only; callbacks still reach its original carrier. Do not purchase, port, forward or change routing without a separate owner decision. `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` now support only the primary owner's read-only **Phone setup** inspection. These checks do not verify remaining free units, authorize a call or connect a conversational agent. Empty standard number/caller-ID lists may omit newer Try out Voice resources.
6. **Approved product facts and agent policy**: explicitly reconfirm Personal $15/month, Business $25/month, Auto Repair Shop $35/month, 60-day trial, cancellation any time and the owner's no-refund policy. Configure the separate ElevenAgents runtime with the exact approved knowledge snapshot, AI disclosure, uncertainty/human follow-up, refusal/keypad opt-out, no payments or unrelated account access, silence/voicemail behavior, maximum duration and prompt-injection boundaries. Caller speech is untrusted. Agent configuration and behavior have not been deployed or validated.
7. **Recipient and compliance review**: initially only a verified owner test destination or permissioned requested callbacks with purpose, source, consent wording/version, timestamps and revocation. Public listings are not permission. Artificial-voice mobile/residential sales calls generally require applicable prior express written consent; genuine business landlines differ. The pilot's blanket allowlist is a product safety default, not a claim that all B2B calls have identical legal treatment. Review current law and provider policy before any wider outreach; no unattended cold-call blast.
8. **Separate approved spend and retention decision**: current preference is free only. Confirm actual current plan/credits/prices, a positive maximum cap and per-call estimate/reservation before any billable test. Recording is off, but inspect both vendors' recording and transcript retention settings rather than relying only on payload flags. Establish disclosure, consent, storage, deletion and backup rules before enabling persistent recording/transcripts.
9. **ChatGPT/Codex account access**: eligible custom-MCP connection controls and owner OAuth approval. The actual client must show tools, respect permissions and successfully prepare/status/stop the separately running session. Local Inspector success is not proof of this external connection.

## Independent implementation still required before live activation

- Wire real enrollment/upload/training status, model/identity readiness and provider deletion into authenticated UI/jobs. Currently only simulation enrollment and read-only metadata inspection are routed.
- Build server-verified activation/readiness, positive budget approval, conservative cost reservations, settlement and exhausted-cap enforcement for real use. Never trust model-supplied `LivePermit` flags as authorization.
- Deploy/configure a knowledge-bound conversation runtime with monitored turn taking, explicit AI disclosure, refusal/keypad opt-out, silence and voicemail handling, maximum duration and prompt-injection defenses.
- Persist actual Conversation ID/CallSid, register signed webhooks against raw request bytes, route deduplicated/out-of-order events, reconcile unknown creates, and connect Stop/kill switch to actual provider termination. The webhook helpers are not currently exposed as live routes. No automatic redial.
- Implement provider-side voice/sample/preview deletion and confirm vendor limits; local deletion does not touch them.
- Verify chosen account's exact voice/agent response shapes, phone integration, signatures, current API requests/pricing and customer-specific permissions against live provider documentation.
- Complete a separately authorized call only to the owner's approved test destination; observe/stop it, validate budget/permissions and actual retention, collect real speech and latency/interruption evidence, then verify the actual ChatGPT/Codex connection.

## Provider references

- https://elevenlabs.io/docs/eleven-creative/voices/voice-cloning/professional-voice-cloning
- https://elevenlabs.io/docs/eleven-api/concepts/voice-cloning
- https://elevenlabs.io/docs/eleven-agents/phone-numbers/twilio-integration/native-integration
- https://elevenlabs.io/docs/eleven-agents/api-reference/integrations/twilio/outbound-call
- https://elevenlabs.io/pricing
- https://www.twilio.com/docs/voice/api/outgoing-caller-ids
- https://www.ecfr.gov/current/title-47/chapter-I/subchapter-B/part-64/subpart-L/section-64.1200

Provider verification, current account access, legal eligibility and voice quality remain unverified. Do not describe this milestone as production-ready.
