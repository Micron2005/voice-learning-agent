# ChatGPT / Codex connection

## Local stdio (development)

1. Run the app and create the owner account. Copy the operator ID from **MCP connection**.
2. Copy `codex/mcp.local.example.json` into your client's MCP configuration, replacing the absolute project path and operator ID. Use the client's current settings location, not a guessed global filename. On Windows, JSON paths need escaped backslashes or forward slashes. The `--import` loader uses a **file URL**: for example `file:///C:/Projects/vultrix-voice/node_modules/tsx/dist/loader.mjs` (encode spaces as `%20`); the script/data arguments remain ordinary filesystem paths such as `C:/Projects/vultrix-voice/server/stdio.ts`.
3. The example is read/prepare/stop only. To test preview and simulated placement, explicitly add `voice:preview calls:place` to `VOICE_MCP_SCOPES`. This still cannot authorize calls.
4. Keep the UI and worker running. The stdio process accesses the same absolute `VOICE_DATA_DIR`; its security boundary is your trusted OS user, not OAuth. Do not expose stdio through an unauthenticated network bridge.

For Codex clients supporting TOML MCP entries:

```toml
[mcp_servers.vultrix_voice]
command = "node"
args = ["--import", "file:///absolute/project/node_modules/tsx/dist/loader.mjs", "/absolute/project/server/stdio.ts"]

[mcp_servers.vultrix_voice.env]
VOICE_DATA_DIR = "/absolute/project/data"
VOICE_OPERATOR_ID = "replace-with-your-owner-id"
VOICE_MCP_SCOPES = "voice:read calls:read calls:prepare calls:stop"
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

`tools/list` performs the initialize handshake. Expect 12 tools, accurate annotations, `liveEnabled: false`, and `capCents: 0`. `voice_preview` is not read-only. `call_place_approved` requires `calls:place` **and** a matching, unexpired, single-use UI grant. Model-generated assertions such as “the owner approved” have no authority.

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
- Scopes: `voice:read`, `voice:preview`, `calls:read`, `calls:prepare`, `calls:place`, `calls:stop`.

In ChatGPT, use the custom app/MCP connection controls available to your account/workspace (often under Settings → Apps, with developer mode needed). Enter the HTTPS `/mcp` URL, follow OAuth, sign in to this owner UI and inspect the requested client/redirect/scopes before approving. Names and availability of these controls vary by plan, region, workspace policy and current client version. If absent, an administrator or eligible account is needed; an API key pasted into chat is not a substitute. The UI can revoke all current MCP tokens.

Do not add a separate browser login/access gateway that blocks the MCP endpoint's OAuth discovery or callback path. Use the app's OAuth protection and an approved network policy that still permits the chosen client. Never disable authentication to make a connector work.

## Tool requests and expected evidence

```json
{"name":"usage_get_budget","arguments":{}}
```

Result data includes simulation mode, a $0 cap, no live capability and no reserved/spent billable usage. IDs below must come from your own records, never invented by the model:

```json
{"name":"call_prepare","arguments":{"recipient":"+12025550124","callerId":"YOUR-CALLER-UUID","voiceVersion":"YOUR-VERSION-UUID","knowledgeVersion":"YOUR-KNOWLEDGE-UUID","purpose":"requested-callback","duration":60,"costCapCents":0}}
```

Use the exact schema returned by `tools/list` for field names and allowed values; a draft response reports its immutable snapshot and required UI authorization. Then:

```json
{"name":"call_place_approved","arguments":{"draftId":"YOUR-DRAFT-UUID","idempotencyKey":"unique-stable-key-for-this-draft"}}
{"name":"call_status","arguments":{"callId":"RETURNED-CALL-UUID"}}
{"name":"call_stop","arguments":{"callId":"RETURNED-CALL-UUID"}}
```

Retry a network-lost request only with its same idempotency key after inspecting status. Never invent a new key to redial an uncertain result. Simulated results are not provider delivery or sales evidence. Caller speech must never be allowed to alter permissions, budgets, tools, enrollment or system instructions.

## Official references

- https://developers.openai.com/plugins/build/mcp-server
- https://developers.openai.com/plugins/build/auth
- https://developers.openai.com/codex/mcp/
- https://help.openai.com/en/articles/11487775-connectors-in-chatgpt
- https://github.com/modelcontextprotocol/inspector

Local tests and Inspector are protocol evidence only. A real external ChatGPT/Codex connection and an approved live conversation are separate acceptance checks.
