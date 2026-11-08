# Owner quick guide

## What the indicators mean

- **SIMULATION / DRY RUN / $0:** no provider call is made. Local caller identity and voice approval prove only dry-run configuration.
- **Worker online:** recent local heartbeat, not provider health. Offline: start `npm run worker` with the same data path and environment, or restart the combined dev command.
- **Mock ready:** the local job completed. It is not trained speech, identity verification or provider model readiness.
- **Queued/dialing/connected/completed:** explicitly simulated timeline. A real create response would still need provider evidence and must never be called a sales success.
- **Unknown:** do not redial. Keep one-active-call protection until provider status can be reconciled in the future live runtime.
- **Twilio connection verified:** read-only account metadata was received, not permission or readiness to dial; paid/inactive accounts are blocked from trial resource inspection and all calls remain simulated.

## Authorization and stopping

Prepare → inspect exact draft → explicit owner authorization → place. Grants expire, are single-use and bind the exact recipient, caller, voice/configuration, knowledge snapshot, purpose, duration and $0 cap. Changed requests require a fresh draft/grant. MCP can prepare or execute an already-authorized draft but cannot approve one.

Use Stop for an individual simulation; Stop all sets the global kill switch and blocks further previews/calls until explicitly cleared. Refusal/keypad-opt-out simulation stops and suppresses the destination. Do not remove suppression merely to retry outreach. No automatic redial is implemented. Recording and persistent transcripts remain off; a summary is not a transcript or proof of a conversation.

## Audio, consent and retention

Only Mukarram's own authorized voice is in scope. Keep raw recordings unprocessed for enrollment and listen for other speakers, music, echo and clipping; heuristic warnings do not verify a single speaker or language. The studio uses browser microphone permission, supports device selection/retake/upload, and preserves original uploaded bytes. Audio playback and normalized/telephone audition do not rewrite originals. Keep headphone volume reasonable.

Deleting an original/preview is irreversible in the local active store and invalidates its private playback. Revoking voice consent immediately blocks that voice and its pending uses. Neither operation deletes provider assets, backups or retained audit/suppression. Set local audio retention (default 30 days) under MCP connection; expired files are removed by the worker. Do not treat mock ratings as real acceptance; re-test every actual model/settings version.

## Common problems

| Problem | Next step |
|---|---|
| Wrong Node/SQLite error | Use Node 24 LTS; reinstall with `npm ci`. |
| Audio decoder unavailable | Install patched ffmpeg and confirm `ffmpeg -version` works in the server environment. |
| Audio rejected/timed out | Use a supported audio file under 50 MB and 30 minutes; divide longer recordings into clips. |
| Same-origin/CSRF error | Open exact `APP_URL`; sign in again; change both PORT and APP_URL together. |
| Private preview link expired | Inspect preview again to obtain a fresh, two-minute bearer audio link. Do not share it publicly. |
| Read-only provider inspection unavailable | No keys are required for dry run. Optional inspection needs the three server-side ElevenLabs values; it cannot enable calling or prove subscription eligibility. |
| Twilio server credentials missing | Set `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` in the private server environment, restart, then reload Phone setup; never enter keys into chat or the dashboard. |
| Twilio lists are empty | New trial resources may be managed separately by Try out Voice; check that screen and its free-units tracker without upgrading or purchasing anything. Do not assume verification failed or that credits exist. |
| Twilio paid/inactive account | Only an active Trial account is eligible for this zero-spend setup path; connection success does not authorize use of a paid account. |
| Twilio check failed | Prior results are cleared; check network, server credentials and provider permissions, then retry manually. Nothing is automatically retried or dialed. |
| OAuth request/code expired | Restart connection and inspect scopes again. Access tokens expire after one hour; reconnect. Revoke all current tokens from the MCP page if a client is no longer trusted. |
| Call blocked | Check kill switch, permission purpose/revocation, suppression, approved simulation version, exact grant expiry, and another active/unknown simulation. |
| Forgotten owner password | No self-service reset is implemented. Do not delete an existing data directory to bypass controls. A maintainer must perform a reviewed, backed-up account recovery and revoke sessions/tokens. |

## Evidence boundaries

No real voice clone, identity verification, paid enrollment, real telephone audio, provider latency/interruption measurement, account-specific calling approval or real ChatGPT connection has been demonstrated. The application intentionally displays these blockers. See ACTIVATION.md for the consolidated future setup and remaining implementation, not a promise that entering keys will finish it.
