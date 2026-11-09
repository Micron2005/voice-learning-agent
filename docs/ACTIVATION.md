# Live activation: not implemented or approved

The default remains a $0, no-network-call simulation. The connected Codex chat is the only reply decision-maker. Do not use ElevenLabs, ElevenAgents, Ollama, a local conversational LLM or another agent to decide replies. STT and TTS must be separate speech-only components. No voice samples may be uploaded, numbers bought, payments enabled or real calls made during development.

## 1. Codex conversation proof — first gate

The Codex fixture implements caller transcripts, bounded MCP reads, exact idempotent replies, encrypted fictional-text capture, timeout/fixed fallback/end and existing owner/per-call controls. See [MCP protocol and actual-client acceptance](MCP.md#codex-driven-fixture-protocol). The original timeline simulation stays the default.

Automated SDK/Inspector tests are not proof that an actual Codex client can run this loop. Actual acceptance requires two different fixture utterances read by a ChatGPT-authenticated Codex session, two different client-chosen replies, exact submission/capture agreement and observed timing. The manual `npm run proof:codex` harness refuses API-key billing and writes evidence only on success. A missing login or a slow/failed client must be reported, not converted into a pass. Do not change architecture to conceal excessive Codex delay.

## 2. Local voice enrollment — pending owner architecture decision

The owner rejected a hosted ElevenLabs dependency and wants an implementation they control, with personal listening approval. Clarify whether “from scratch” permits licensed pretrained open-source speech weights running locally or means training from random initialization. Do not silently substitute one for the other. Training a commercial-quality general speech model from zero is not established as feasible at a $0 budget. Self-hosting existing speech weights is not writing or training the foundation model from scratch.

No local speech model has been selected, downloaded, trained or benchmarked. Model code and weight licenses, commercial usage, provenance, security/maintenance, required hardware and expected resource use must be reviewed before approval. This session VM reports two CPU cores and about 8 GiB RAM, with no usable NVIDIA GPU detected; this says nothing about the owner's computer or real synthesis speed. Do not promise parity with a commercial provider or real-time CPU operation.

The pending implementation must:

- Reuse encrypted private studio originals without changing original bytes. Local duration/clipping/noise checks are not a trained clone, identity verification or synthesis evidence.
- Enroll only the owner's authorized speech. Bind model/version and enrollment manifest to exact original-asset hashes and consent. Separate reference conditioning, speaker adaptation/fine-tuning and training from random weights in UI state and evidence; do not label conditioning as fine-tuning.
- Keep enrollment material separate from held-out evaluation phrases. Include Vultrix, approved prices, repair vocabulary, numbers, names and the AI disclosure in evaluation. No samples leave the machine without separate explicit permission; none is authorized now.
- Generate real held-out speech only after local engine approval. Show exact text, model/version/settings, elapsed time and audio provenance. Never label a calibration tone as speech or a clone.
- Reuse non-destructive matched-level A/B listening and 8 kHz, 300–3400 Hz telephone-bandwidth audition. Let the owner rate likeness, naturalness, pronunciation and errors. Codex can assist comparison only when its client actually supports hearing the audio; automatic judgments never replace owner acceptance.
- Require owner acceptance, at least 4/5 likeness/naturalness across studio and telephone auditions without material name/price/number errors, before approving a real voice. Keep rollback, revocation and deletion effective. Measure rather than promise quality.

## 3. Separate speech/phone bridge — pending actual Codex proof

Intended path, not an implemented/live capability:

`Twilio inbound audio → local streaming STT → caller-turn queue → connected Codex → call_speak exact text → local streaming TTS using approved voice → Twilio outbound audio`

No component other than Codex decides conversational replies. Submit exactly the accepted text to synthesis, without hidden rewriting, expansions or another model. Verify spoken output for omission, repetition or hallucination; transmitting exact text alone does not prove exact audible speech.

The bridge must bind authenticated bidirectional phone streams to a server-authorized CallSid, owner, destination and voice version; use signed Twilio handshakes/events and bounded queues; and reject foreign, replayed or malformed sessions. Keep recording off. Real caller transcript buffers must be ephemeral unless separately approved; fictional fixture capture is not approval to retain real calls.

Implement barge-in cancellation of current synthesis, clearing queued phone audio and stale-turn rejection; stop/kill/disconnect must abort synthesis/transcription, close sockets and terminate the actual CallSid. Reject late chunks after interruption or stop. On unresponsive/disconnected Codex, play only the exact pre-approved short fallback and end; cap the fallback itself. No automatic retries/redial.

Report timestamps for acoustic end of caller turn, final STT, queue/read, Codex submission, first synthesis chunk and first audio sent to phone transport. Separate STT delay, Codex wait, synthesis/startup, server-send latency and device-heard latency; a transport enqueue is not proof that a person heard audio. Report median/p95/sample count only from real samples. Current text fixtures measure caller-turn-to-capture only: first-audio and telephone latency are null/unmeasured.

## 4. Owner-only live test — separate explicit approval

No live call route exists and no environment toggle or MCP instruction can activate one. Before adding/enabling this milestone:

1. Actual Codex simulation proof must pass, and the owner must approve the real local voice after held-out listening.
2. Verify one destination the owner controls, provider-backed caller ID, available trial eligibility/quota, and legal/provider-policy requirements. Twilio's active Trial status or empty standard number lists prove neither quota nor destination verification. Public listings are not consent.
3. Approve exact recipient, caller ID, voice version, knowledge/disclosure snapshot, maximum duration, recording-off setting, fixed timeout fallback, call estimate and explicit server-enforced budget cap. No assumption that trial credits cover usage. Keep current cap $0 unless separately changed by the owner.
4. Persist/reconcile actual CallSid and unknown creates. Enforce atomic reservations and exact-call single-use authorization, duplicate-call protection, suppression, one active/uncertain call, no automatic redial, and exhaustion stop. Model-supplied booleans are not authorization.
5. Exercise real stop/kill/disconnect/interruption, measure full latency including Codex, and confirm vendor and local retention. Clearly disclose the AI voice; do not impersonate the owner speaking live.
6. Verify the selected actual Codex/ChatGPT client's tool loop and audio-review capabilities. Local stdio uses trusted OS access; remote/cloud clients require approved HTTPS hosting, owner OAuth/PKCE and account compatibility. A cloud client cannot reach VM localhost directly.

No owner phone test, voice upload, purchase, production deployment or billable usage is authorized by this document.
