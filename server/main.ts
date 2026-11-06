import "dotenv/config";
import next from "next";
import { Store, requireThat } from "./store.js";
import { createApp } from "./http.js";
import { createOperator } from "./auth.js";

const port = Number(process.env.PORT ?? 3410),
  host = process.env.HOST ?? "127.0.0.1";
const origin = process.env.APP_URL ?? `http://localhost:${port}`;
const store = new Store(process.env.VOICE_DATA_DIR ?? "./data");
if (
  !store.db.prepare("SELECT id FROM operators LIMIT 1").get() &&
  process.env.OWNER_EMAIL &&
  process.env.OWNER_PASSWORD
)
  createOperator(store, process.env.OWNER_EMAIL, process.env.OWNER_PASSWORD);
const local =
  ["127.0.0.1", "::1"].includes(host) && new URL(origin).protocol === "http:";
requireThat(
  local || !!store.db.prepare("SELECT id FROM operators LIMIT 1").get(),
  "owner_required",
  "Pre-provision the owner before exposing a remote server.",
);
const { app } = createApp(store, origin, local);
const nextApp = next({
  dev: process.argv.includes("--dev"),
  hostname: host,
  port,
});
await nextApp.prepare();
app.use((req, res) => nextApp.getRequestHandler()(req, res));
const server = app.listen(port, host, () =>
  console.log(`Vultrix Voice ready on port ${port}; SIMULATION ONLY, $0 cap.`),
);
process.on("SIGTERM", () =>
  server.close(() => {
    store.close();
    process.exit(0);
  }),
);
