import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Store } from "../server/store.js";
import { createOperator } from "../server/auth.js";
import { VoiceService } from "../server/service.js";

test(
  "MCP Inspector initializes stdio, validates schemas and invokes scoped tools",
  { timeout: 60_000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "voice-inspector-"));
    const store = new Store(join(dir, "data"));
    try {
      const owner = createOperator(
        store,
        "inspector@example.test",
        "Inspector fixture password 123",
      );
      new VoiceService(store).initialize(owner);
      const config = join(dir, "mcp.json");
      writeFileSync(
        config,
        JSON.stringify({
          mcpServers: {
            voice: {
              command: process.execPath,
              args: [
                "--import",
                pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href,
                resolve("server/stdio.ts"),
              ],
              env: {
                VOICE_DATA_DIR: store.dir,
                VOICE_OPERATOR_ID: owner,
                VOICE_MCP_SCOPES: "voice:read calls:read",
                DOTENV_CONFIG_QUIET: "true",
              },
            },
          },
        }),
      );
      const run = async (args: string[]) => {
        const { stdout } = await promisify(execFile)(
          process.execPath,
          [
            resolve(
              "node_modules/@modelcontextprotocol/inspector/clients/launcher/build/index.js",
            ),
            "--cli",
            "--config",
            config,
            "--server",
            "voice",
            ...args,
          ],
          { cwd: process.cwd(), timeout: 20_000, maxBuffer: 1024 * 1024 },
        );
        return JSON.parse(stdout);
      };
      const listed = await run(["--method", "tools/list", "--strict"]);
      assert.equal(listed.tools.length, 12);
      assert.equal(
        listed.tools.find((t: any) => t.name === "voice_preview").annotations
          .readOnlyHint,
        false,
      );
      assert.equal(
        listed.tools.some((t: any) => /authorize|grant/.test(t.name)),
        false,
      );
      const budget = await run([
        "--method",
        "tools/call",
        "--tool-name",
        "usage_get_budget",
      ]);
      assert.equal(budget.structuredContent.data.liveEnabled, false);
      assert.equal(budget.structuredContent.data.capCents, 0);
      const profile = await run([
        "--method",
        "tools/call",
        "--tool-name",
        "account_get_profile",
      ]);
      assert.equal(profile.structuredContent.data.operatorId, owner);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
