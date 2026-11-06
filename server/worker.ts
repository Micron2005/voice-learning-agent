import "dotenv/config";
import { Store } from "./store.js";
import { VoiceService } from "./service.js";
const store = new Store(process.env.VOICE_DATA_DIR ?? "./data"),
  service = new VoiceService(store);
const timer = setInterval(() => {
  try {
    service.tick();
  } catch {
    console.error("Worker operation failed. No provider request retried.");
  }
}, 500);
console.log("Vultrix Voice worker running in simulation mode.");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    clearInterval(timer);
    store.close();
    process.exit(0);
  });
