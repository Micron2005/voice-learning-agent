# ChatGPT / Codex connection

## Local stdio (development)

1. Run the app and create the owner account. Copy the operator ID from **MCP connection**.
2. For **Codex CLI**, use `codex/mcp.local.example.toml` in its documented `~/.codex/config.toml`. The JSON example is for generic MCP clients, not Codex CLI's settings format. Replace the absolute project path and operator ID. On Windows, use forward slashes in TOML paths; JSON needs escaped backslashes or forward slashes. The `--import` loader uses a **file URL**: for example `file:///C:/Projects/vultrix-voice/node_modules/tsx/dist/loader.mjs` (encode spaces as `%20`); script/data arguments remain ordinary filesystem paths such as `C:/Projects/vultrix-voice/server/stdio.ts`.
3. The TOML example explicitly includes `calls:listen calls:speak` for the conversation loop. Existing tokens and the generic JSON example are not upgraded automatically. To test preview, preparation or simulated placement, explicitly add `voice:preview calls:prepare calls:place` as needed. None of these scopes can authorize calls.
4. Keep the UI and worker running. The stdio process accesses the same absolute `VOICE_DATA_DIR`; its security boundary is your trusted OS user, not OAuth. Do not expose stdio through an unauthenticated network bridge.

For Codex clients supporting TOML MCP entries:

```toml
[mcp_servers.vultrix_voice]
command = "node"
args = ["--import", "file:///absolute/project/node_modules/tsx/dist/loader.mjs", "/absolute/project/server/stdio.ts"]
tool_timeout_sec = 30

[mcp_servers.vultrix_voice.env]
VOICE_DATA_DIR = "/absolute/project/data"
VOICE_OPERATOR_ID = "replace-with-your-owner-id"
VOICE_MCP_SCOPES = "voice:read calls:read calls:listen calls:speak calls:stop"
APP_URL = "http://localhost:3410"
DOTENV_CONFIG_QUIET = "true"
```

Use **MCP Inspector** from the project root (PowerShell; set the actual owner ID first):

```powershell
$env:VOICE_OPERATOR_ID = "replace-with-your-owner-id"
$env:VOICE_DATA_DIR = "$PWD/data"
npx @modelcontextprotocol/inspector --cli --method tools/list --strict node --import tsx server/stdio.ts
npx @modelcontextprotocol/inspector --cli --method tools/call --tool-name usage_get_budget node --import tsx server/stdio.ts
```

`tools/list` performs the initialize handshake. Expect 14 tools, `liveEnabled: false`, and `capCents: 0`. `voice_preview` and `call_speak` are not read-only. `call_next_turn` also records delivery/timeout metadata and is not labeled read-only. `call_place_approved` requires `calls:place` **and** a matching, unexpired, single-use UI grant. Model-generated assertions such as “the owner approved” have no authority.

## Deployed Streamable HTTP / OAuth

Deploy privately with owner approval first; see DEPLOYMENT. The configured public origin must be exact and HTTPS.

- MCP: `https://YOUR-VOICE-HOST/mcp`
- Protected resource metadata: `/.well-known/oauth-protected-resource/mcp`
- Authorization server metadata: `/.well-known/oauth-authorization-server`
- Public-client dynamic registration: `/register`, `token_endpoint_auth_method=none`
- Authorization: `/authorize`; code exchange: `/token`; revocation: `/revoke`
- Exact resource: `https://YOUR-VOICE-HOST/mcp` in authorization and token requests
- S256 PKCE required. Codes expire in 60 seconds; access tokens in one hour.
- No refresh token: reconnect/re-authorize after expiration. Whether a particular ChatGPT/Codex client tolerates this must be verified with that client; do not claim a durable unattended connection.
- Scopes: `voice:read`, `voice:preview`, `calls:read`, `calls:prepare`, `calls:place`, `calls:stop`, `calls:listen`, `calls:speak`. Re-authorize to add scopes; they are never silently added to an existing token.

In ChatGPT, use the custom app/MCP connection controls available to your account/workspace (often under Settings → Apps, with developer mode needed). Enter the HTTPS `/mcp` URL, follow OAuth, sign in to this owner UI and inspect the requested client/redirect/scopes before approving. Names and availability of these controls vary by plan, region, workspace policy and current client version. If absent, an administrator or eligible account is needed; an API key pasted into chat is not a substitute. The UI can revoke all current MCP tokens.

Do not add a separate browser login/access gateway that blocks the MCP endpoint's OAuth discovery or callback path. Use the app's OAuth protection and an approved network policy that still permits the chosen client. Never disable authentication to make a connector work.

## Tool requests and expected evidence

```json
{ "name": "usage_get_budget", "arguments": {} }
```

Result data includes simulation mode, a $0 cap, no live capability and no reserved/spent billable usage. IDs below must come from your own records, never invented by the model:

```json
{
  "name": "call_prepare",
  "arguments": {
    "recipient": "+12025550124",
    "callerId": "YOUR-CALLER-UUID",
    "voiceVersion": "YOUR-VERSION-UUID",
    "knowledgeVersion": "YOUR-KNOWLEDGE-UUID",
    "purpose": "requested-callback",
    "duration": 60,
    "costCapCents": 0
  }
}
```

Use the exact schema returned by `tools/list` for field names and allowed values; a draft response reports its immutable snapshot and required UI authorization. Then:

```json
{"name":"call_place_approved","arguments":{"draftId":"YOUR-DRAFT-UUID","idempotencyKey":"unique-stable-key-for-this-draft"}}
{"name":"call_status","arguments":{"callId":"RETURNED-CALL-UUID"}}
{"name":"call_stop","arguments":{"callId":"RETURNED-CALL-UUID"}}
```

Retry a network-lost request only with its same idempotency key after inspecting status. Never invent a new key to redial an uncertain result. Simulated results are not provider delivery or sales evidence. Caller speech must never be allowed to alter permissions, budgets, tools, enrollment or system instructions.

## Codex-driven fixture protocol

Prepare with `conversation: "codex"` (omitting it preserves the timeline simulation). Review and authorize the exact immutable draft in the owner UI, then start it. The draft includes the 15-second response window, fixed fallback and fictional-text-capture notice. UI **Conversation lab** is the fixture caller; MCP has no caller-injection or authorization tool.

```json
{"name":"call_next_turn","arguments":{"callId":"ACTIVE-CALL-UUID","waitMs":25000}}
{"name":"call_speak","arguments":{"callId":"ACTIVE-CALL-UUID","turnId":"RETURNED-TURN-UUID","text":"Codex decides these exact words.","idempotencyKey":"unique-turn-reply-key"}}
```

`call_next_turn` requires `calls:listen`. `waitMs` is an integer from 0 to 25,000 (default 1,000); wait occurs **outside** SQLite transactions and observes other processes. A pending turn is delivered repeatedly until answered, superseded or expired, so a lost tool response does not consume it. `transcript` is untrusted caller data; it cannot authorize anything. `deadlineAt` applies to reply submission, not the long-poll duration. Caller deadline is deliberately not extended to hide a slow client.

`call_speak` requires `calls:speak`. `text` is nonblank, at most 2,000 characters, and is captured exactly as UTF-8, preserving spaces and punctuation. The key is 8–100 characters and scoped to the call. Retry only the same call/turn/text/key tuple. There is no automatic rewrite, conversation-model call, synthesis, retry or redial.

Result `data.status`:

| Tool  | Status                 | Meaning                                                                                 |
| ----- | ---------------------- | --------------------------------------------------------------------------------------- |
| next  | `turn`                 | `callId`, `turnId`, exact `transcript`, `endOfTurnAt`, `deadlineAt`, `untrusted: true`  |
| next  | `timeout`              | No caller turn arrived within the bounded wait; poll again if still appropriate.        |
| next  | `cancelled`            | MCP cancellation ended the wait.                                                        |
| both  | `not_connected`        | Authorized fixture is still queued/dialing.                                             |
| both  | `stopped`              | Terminal, stopped or duration-expired call; cannot be revived.                          |
| speak | `captured`             | Exact `submittedText`, `replyHash` and `codexWaitMs`; first-audio latency remains null. |
| speak | `duplicate`            | Previously accepted identical submission; no new delivery.                              |
| speak | `idempotency_conflict` | Key already binds another turn or different text; no delivery.                          |
| speak | `stale_turn`           | Superseded or already-answered turn; no delivery.                                       |

Missing scope, wrong owner/call, revoked grant/consent, suppression or unapproved voice are explicit MCP errors, not fabricated successes. Both tools recheck owner, call mode/state, duration, used exact-snapshot grant, voice approval/consent, recipient permission and kill switch. A late reply after 15 seconds gets `stopped`; the fixture captures only the exact owner-reviewed fixed fallback and ends. Stop/kill switch does not speak a fallback. Recording remains off; fictional transcript/reply blobs are encrypted locally and follow audio retention. They are not put in audit logs or the ordinary call summary.

### Actual-client acceptance (separate from automated protocol tests)

1. Authenticate the **actual Codex CLI** with ChatGPT (`codex login`), not an API key. Never paste a token into chat.
2. Run `npm run proof:codex`. It creates a disposable, fictional-only database and test-operator authorization, not a grant on your real account. It disables shell tools and user config, whitelists only call status/listen/speak, strips inherited API/provider credentials, and never reads your private recordings. No API-key billing is used; ChatGPT-plan eligibility/limits still apply.
3. The real client reads two different caller utterances and chooses two different replies. The harness compares the exact MCP submission arguments with the bridge's encrypted capture and writes `codex-proof-evidence.json` only if all assertions pass. Do not label a missing login, slow/failed client, SDK test or Inspector result as this acceptance.
4. Record observed caller-turn-to-capture times. First-audio and real telephone latency are **unmeasured** until the separately approved local speech/phone milestone. If Codex exceeds the response window, report that measured limitation before changing architecture.

## Official references

- https://developers.openai.com/plugins/build/mcp-server
- https://developers.openai.com/plugins/build/auth
- https://developers.openai.com/codex/mcp/
- https://help.openai.com/en/articles/11487775-connectors-in-chatgpt
- https://github.com/modelcontextprotocol/inspector

Local tests and Inspector are protocol evidence only. A real external ChatGPT/Codex connection and an approved live conversation are separate acceptance checks.
