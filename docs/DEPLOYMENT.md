# Private deployment plan — not deployed

This is a Node/ffmpeg service with durable SQLite and a worker, **not** a Vercel/serverless/static-only app. No production infrastructure, hosting, DNS, existing number or Vultrix service has been changed.

## Supported pilot topology

- One trusted Linux VM, Node 24, patched ffmpeg, encrypted persistent local disk.
- One Express/Next process and one worker on the **same local filesystem** and data directory. Do not share SQLite over NFS, horizontally scale across hosts, or use ephemeral app disks.
- HTTPS reverse proxy forwarding to a loopback-only service, preserving the configured Host. Do not log `/api/audio` query strings, OAuth request/code/token data, credentials or audio.
- Only the owner gets browser access. MCP uses the app's scoped OAuth; chosen cloud clients must be able to reach the protected endpoint and metadata. Confirm account/network compatibility before deployment approval.

## Provision, only after explicit deployment approval

1. Provision a dedicated, least-privilege OS user; install Node 24 and ffmpeg, use `npm ci`, then `npm run build` with `NEXT_TELEMETRY_DISABLED=1`.
2. Set `VOICE_DATA_DIR` to an absolute persistent path owned by that user (0700). Put `APP_URL=https://YOUR-VOICE-HOST`, `HOST=127.0.0.1`, `PORT=3410` and the initial `OWNER_EMAIL`/`OWNER_PASSWORD` (16+ characters) in a server secret manager or restrictive environment file. Never use `NEXT_PUBLIC_` for secrets.
3. Start `tsx server/main.ts` with a process supervisor and `tsx server/worker.ts` as a separate supervised service, both using the same environment/data directory. Use executables under `node_modules/.bin/`. `npm start` is a convenience for local running, not a durable process supervisor.
4. Confirm startup pre-provisions the owner. HTTPS mode disables browser first-run creation. Remove initial owner credentials from ongoing runtime configuration after first boot; they are not needed for sign-in and do not reset an existing account.
5. Configure the HTTPS proxy, certificate renewal, body size at most 50 MB plus multipart overhead, request timeout sufficient for bounded 30-second audio inspection, no response caching for protected paths, and security headers. Never open the app port directly or weaken Host/origin/CSRF/OAuth validation.
6. Check `/health`, sign-in, Overview worker heartbeat, audio isolation, OAuth discovery and owner consent, MCP initialization/tools, persistence after restart and restore from backup. Worker offline is an actionable degraded state, not successful enrollment.
7. Run the full security/test/Inspector checks and private browser smoke. Keep live calling locked and cap $0. Deploying this code does not enable live capabilities.

## Persistence, encryption and backups

SQLite migration `migrations/001_initial.sql` is idempotent and applied by each Store startup. No external migration CLI or existing Vultrix DB is involved. Stop both processes before a filesystem backup, or implement a SQLite online-backup process and consistent audio manifest. Preserve the database, WAL consistency, all `.audio` files and **`.audio-key`** together in an encrypted backup with separate access controls. Losing the key loses the audio. Test restore privately before reliance.

Audio is application-encrypted but the co-located key is not a KMS. SQLite metadata is not application-encrypted. Disk/backup encryption is required on a deployed host. Provider credentials remain server-side; no credential vault/KMS or remote private object storage is implemented. Introduce a private object-store adapter with expiring access, KMS and tenant checks before multi-host deployment; don't pretend local storage is cloud object storage.

## Rollback and limits

Back up before updates; stop the worker and server, deploy a verified revision, then restart both. The initial schema is additive/idempotent; future schema revisions require explicit upgrade/rollback planning. Never replace the data directory with a clean build directory.

This pilot has a single-owner UI, local rate limits, one active/uncertain simulated call, local sessions and one-hour OAuth tokens without refresh. It is not HA, audited multi-tenant hosting, or a production telephone runtime. A security and legal review plus the unfinished work in ACTIVATION.md are required before broader exposure or live outreach.
