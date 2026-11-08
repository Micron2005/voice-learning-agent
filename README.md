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

## MCP connection

See [the complete ChatGPT/Codex guide](docs/MCP.md) and [local example configuration](codex/mcp.local.example.json). This server uses the official MCP SDK, Streamable HTTP plus OAuth 2.1/S256 PKCE, and a trusted-local stdio entry point. There is no tool that can create operator authorization grants.

**ChatGPT does not turn this chat into a phone call.** Its tools control a separate agent/session. A cloud ChatGPT connection needs a reachable HTTPS deployment, compatible account/workspace permissions, and successful owner OAuth approval. Localhost on this computer is not reachable by ChatGPT's cloud. No real ChatGPT/Codex account connection has been verified here.

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
