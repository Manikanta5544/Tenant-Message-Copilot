import { latestEvalRuns, listInbox, listResidents, visitorHash } from "@/db/runs";
import { countMissingBaselines } from "@/db/baselines";
import { getEnv } from "@/core/env";
import { clientKey, fail, jsonWithEtag } from "@/app/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const [messages, residents, missing] = await Promise.all([listInbox(visitorHash(clientKey(req).ip)), listResidents(), countMissingBaselines()]);
    const env = getEnv();
    const evals = await latestEvalRuns(10).catch(() => []);
    const e = evals.find((r) => (r.summary.tier ?? 1) === 1 && r.summary.validity?.valid !== false);
    const overview = {
      eval: e ? { passed: Number(e.summary.passed), total: Number(e.summary.total), gate_ok: !!e.summary.gate?.ok, mode: String(e.mode), prompt_version: String(e.prompt_version), at: e.created_at } : null,
      model: { mode: env.PROVIDER_MODE, name: env.PROVIDER_MODE === "live" ? (env.LLM_MODEL_DRAFT ?? "configured model") : env.PROVIDER_MODE === "replay" ? "Recorded responses" : "Scripted test replies, not a real model" },
    };
    return jsonWithEtag(req, { messages, residents, overview, ...(missing > 0 ? { setup: { baselines_missing: missing, dev: getEnv().NODE_ENV !== "production" } } : {}) });
  } catch (e) { return fail(e, req); }
}
