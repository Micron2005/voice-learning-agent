# Vultrix Voice

Private control room and MCP server for an owner-authorized Vultrix phone agent.
**Milestone 1: runnable local simulation, not a production calling service.**

- Separate project: no Vultrix database, billing, DNS or deployment changes.
- External calling is locked off; approved spend is exactly **$0**.
- Mock previews are calibration tones, **not speech or a voice clone**.
- Every simulated call is labeled; no recipient is contacted.
- Real cloning/calling adapters are dormant contracts, not a working live integration. Adding credentials cannot enable them.

## Local setup

Install **Node.js 24 LTS**, npm, and **ffmpeg** on PATH. Do not use Node 20/22: the app uses Node's built-in SQLite API. No provider account or paid credential is needed.

From this project's folder, run one command per line in PowerShell:

```powershell
node --version
ffmpeg -version
npm ci
Copy-Item .env.example .env
npm run dev
```

Linux/macOS: use `cp .env.example .env` instead of `Copy-Item`.
Open **http://localhost:3410** in the browser on that same machine. Create the owner account with a password of at least 16 characters. `npm run dev` starts both the Next/Express server and the worker. Keep them running; stop with Ctrl+C. Remote access and phone-on-LAN first-run setup are intentionally not enabled. Do not bind publicly just to try it on a phone.

For production-mode local playback:

```powershell
npm run build
npm start
```

Stop the dev process before starting production on the same port. The data persists in `data/`; migrations run automatically and idempotently at startup. Both processes must use the same `VOICE_DATA_DIR`. The worker can also run separately with `npm run worker`.

If the port changes, change **both** `PORT` and `APP_URL` in `.env`. Use the exact configured browser origin; CSRF checks deliberately reject mismatches. Never commit `.env` or `data/`.

## Try the complete dry run

1. Overview: confirm simulation, $0 approved spend, external calling locked, and worker online.
2. Voice studio: create a profile and attest that the voice is your own. Provider-upload consent is separate and unnecessary for simulation. Record or upload WAV/FLAC/MP3/M4A/Ogg/WebM (50 MB maximum per upload; clips under 30 minutes). Inspect level/clipping/silence/noise warnings and listen to the unmodified original.
3. Simulate enrollment. This tests queue/readiness controls only; it does not train or verify a voice. Approve the **simulation configuration** to allow a dry-run call.
4. Quality lab: request a held-out mock preview, inspect its result, audition original and tone at normalized playback levels, and optionally enable the 8 kHz telephone-bandwidth simulation. Ratings here are practice-only and never count as acceptance of a real voice.
5. Agent knowledge: review/edit the price, trial, workflow and disclosure snapshot. Saved edits create new versions.
6. Permissions: save a **simulation caller identity** and a purpose-specific fixture destination with permission wording/source. Use fictional numbers; no calls leave the app. A public listing is not consent.
7. Calls: prepare a $0 draft, inspect the exact parameters and knowledge snapshot, then authorize that unchanged draft in the owner UI. Start the simulation. Observe queued/dialing/connected/completed or use Stop. A new draft requires new authorization.
8. Test the simulated refusal/keypad opt-out and global Stop all. Refusal suppresses that destination; no automatic redial is implemented. Clear the kill switch deliberately before further work.
9. MCP connection: inspect endpoint, scopes, local owner ID and blockers. Connect a local MCP client as below.

## Twilio connection inside the app

Open **Phone setup** to check Twilio without leaving the workspace. Configure `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` only in the server's private environment (or the ignored local `.env`), then restart the app. Credentials saved in Devin do not automatically configure another computer or host. Never put them in browser code, `NEXT_PUBLIC_` values, chat, MCP configuration or Git.

**Check Twilio connection** performs read-only requests for account type/status and the first 50 entries from each standard phone-number/caller-ID API. It displays only masked numbers. Only the server's primary owner can inspect these global credentials; checks are manual, not background polling. Results are not persisted or included in MCP tools.

Active Trial means the account type/status was verified, **not** that free quota, caller ownership, recipient consent or a live call was authorized. Newer Twilio trials may expose resources only in **Try out Voice**, so empty standard API lists do not prove that the signup phone is unverified. Remaining free minutes and account-specific trial limitations still need confirmation in Twilio's Voice free-units tracker. The app cannot initiate phone verification, buy a number, upgrade an account or place a real call. No paid plan, hosting or credentials are required to keep using the dry run.

## MCP connection

See [the complete ChatGPT/Codex guide](docs/MCP.md), [Codex CLI TOML configuration](codex/mcp.local.example.toml) and [generic MCP JSON configuration](codex/mcp.local.example.json). This server uses the official MCP SDK, Streamable HTTP plus OAuth 2.1/S256 PKCE, and a trusted-local stdio entry point. There is no tool that can create operator authorization grants.

**Codex chooses what to say; the voice service must not run another conversation model.** A Codex-mode simulation now supports `call_next_turn` and `call_speak`: the client receives an untrusted caller transcript and submits its exact reply for capture. The service does not rewrite, expand or generate the reply. The original timeline simulation remains the default.

In **Calls**, select **Codex fixture**, prepare/review/authorize the exact $0 draft and start it. In **Conversation lab**, select the connected fixture and send either sample utterance or your own fictional text. A client with explicit `calls:listen` and `calls:speak` scopes can read and answer each turn. The lab shows the exact submitted text, SHA-256 and caller-turn-to-capture timing. It does **not** synthesize audio or measure telephone latency. A newer utterance interrupts an unanswered turn. After 15 seconds without a reply, the fixture captures the fixed fallback reviewed in the draft and ends. Stop, kill switch, suppression, consent and voice revocation continue to apply. Fixture text is encrypted locally and removed by the audio-retention worker; no real conversation is recorded.

`npm run proof:codex` is a separate, manual acceptance harness for an **actual Codex CLI** session (tested CLI interface: 0.167.0). It requires a ChatGPT-backed login, refuses API-key billing, grants only a disposable fictional fixture, injects two different utterances and checks both exact `call_speak` arguments against bridge capture. It writes ignored `codex-proof-evidence.json` **only on success**. No model reply is scripted. This is not included in `npm test`, and a fixture/MCP Inspector pass is not an actual Codex acceptance pass. Until that harness succeeds or equivalent actual-client evidence is collected, the conversation-loop acceptance remains open.

No ElevenLabs or ElevenAgents path remains. Local voice-model selection, real enrollment, speech previews, streaming STT/TTS and Twilio audio are separate pending milestones; see [activation requirements](docs/ACTIVATION.md). No promise of commercial-provider likeness or real-time speed is made. A cloud ChatGPT connection also needs an approved reachable HTTPS deployment, compatible account permissions and owner OAuth; localhost is not reachable from ChatGPT's cloud.

## Checks

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm audit
```

Tests use isolated temporary SQLite databases and mock provider responses, never real vendor traffic. The Inspector integration test performs MCP initialization, schema/annotation discovery and tool calls against local stdio. HTTP integration tests cover authenticated OAuth/PKCE and Streamable HTTP. A successful local test does not prove that an external ChatGPT account is connected.

## Storage and operations

Original recordings and generated tones are stored as AES-256-GCM encrypted files. Original bytes are preserved; analysis and level/telephone processing use copies. The audio key is a restrictive local file beside SQLite, **not a managed KMS**. SQLite metadata, consent and summaries rely on filesystem permissions and encrypted deployment disks. Anyone with full process/disk access can read the local key and database; do not use a shared untrusted host.

Default local audio retention is 30 days; change it from MCP connection (1–365 days, deliberate confirmation). The worker deletes expired local originals/previews. Individual deletion and voice revocation require confirmation. Local deletion **does not delete provider assets or backups**. Revocation immediately blocks use and stops simulations. Suppression and audit records remain; do not erase suppression to bypass a refusal.

Read [operator and recovery guidance](docs/OPERATIONS.md), [deployment instructions](docs/DEPLOYMENT.md), and [live prerequisites and unfinished work](docs/ACTIVATION.md). Do not expose this pilot publicly or enable paid calls without a separate review and owner decision.
