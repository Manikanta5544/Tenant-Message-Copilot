import { visitorHash } from "@/db/runs";
import { cachedEvalRuns, cachedInbox, cachedMissingBaselines, cachedResidents } from "@/app/server/inbox";
import { getEnv } from "@/core/env";
import { clientKey, fail, jsonWithEtag } from "@/app/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const [messages, residents, missing] = await Promise.all([cachedInbox(visitorHash(clientKey(req).ip)), cachedResidents(), cachedMissingBaselines()]);
    // Additive: tells the UI when `npm run seed` has not produced usable baselines yet (never blocks the inbox itself).
    // Additive: the facts the empty-detail overview shows (latest critical-set eval gate, and which model/mode answers).
    const env = getEnv();
    const evals = await cachedEvalRuns();
    const e = evals.find((r) => (r.summary.tier ?? 1) === 1 && r.summary.validity?.valid !== false);
    const overview = {
      eval: e ? { passed: Number(e.summary.passed), total: Number(e.summary.total), gate_ok: !!e.summary.gate?.ok, mode: String(e.mode), prompt_version: String(e.prompt_version), at: e.created_at } : null,
      model: { mode: env.PROVIDER_MODE, name: env.PROVIDER_MODE === "live" ? (env.LLM_MODEL_DRAFT ?? "configured model") : env.PROVIDER_MODE === "replay" ? "Recorded responses" : "Scripted test replies, not a real model" },
    };
    return jsonWithEtag(req, { messages, residents, overview, ...(missing > 0 ? { setup: { baselines_missing: missing, dev: getEnv().NODE_ENV !== "production" } } : {}) });
  } catch (e) { return fail(e, req); }
}
