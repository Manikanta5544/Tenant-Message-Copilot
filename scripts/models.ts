// Lists the models your key can use and checks the configured ones. No tokens are billed.
import { modelAvailability } from "../core/providers/openai-compat";
import { providerMode } from "../core/config";
const mode = providerMode();
console.log(`Effective PROVIDER_MODE: ${mode}${mode !== "live" && process.env.LLM_API_KEY ? "  (a key is set but the app will NOT call it: set PROVIDER_MODE=live and restart)" : ""}`);
const av = await modelAvailability();
console.log(av.listed ? "" : "Could not list models (check LLM_API_KEY and LLM_BASE_URL).");
for (const [role, r] of Object.entries(av.roles)) console.log(`${role.padEnd(7)} ${r.model.padEnd(36)} ${r.available === null ? "unknown" : r.available ? "available" : "NOT AVAILABLE"}`);
process.exit(av.ok ? 0 : 1);
