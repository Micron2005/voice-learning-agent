import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Store, requireThat } from "./store.js";
import { VoiceService } from "./service.js";
import { createMcp } from "./mcp.js";
// Local stdio inherits OS-level access. Never expose it as a remote unauthenticated bridge.
const store = new Store(process.env.VOICE_DATA_DIR ?? "./data");
const owner = process.env.VOICE_OPERATOR_ID;
requireThat(
  owner && store.db.prepare("SELECT id FROM operators WHERE id=?").get(owner),
  "operator_required",
  "Set VOICE_OPERATOR_ID to your local owner ID from the MCP page.",
);
const scopes = (
  process.env.VOICE_MCP_SCOPES ??
  "voice:read calls:read calls:prepare calls:stop"
).split(" ");
await createMcp(
  new VoiceService(store),
  owner,
  scopes,
  process.env.APP_URL ?? "http://localhost:3410",
).connect(new StdioServerTransport());
