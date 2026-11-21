import { backend, liveConfigured } from "@/app/server/provider";
import { budgetDay, dailyBudgetMicroUsd, demoAsOf, maxRunsPerDay, providerMode } from "@/core/config";
import { modelAvailability } from "@/core/providers/openai-compat";
import { appUrl, withScope } from "@/db/client";
import { DEMO_ORG_ID } from "@/db/ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Health = { provider: "reachable" | "unreachable" | "not_configured" | "model_unavailable"; models: Awaited<ReturnType<typeof modelAvailability>>["roles"] | null };

// Cached for a minute: the status bar polls on every page load and a model-list call counts against free-tier limits.
let cached: { at: number; h: Health } | null = null;
const HEALTH_TTL_MS = 60_000;
async function providerHealth(): Promise<Health> {
  if (cached && Date.now() - cached.at < HEALTH_TTL_MS) return cached.h;
  const h = await probeProvider();
  cached = { at: Date.now(), h };
  return h;
}

/** Metadata calls only (no tokens billed). Reachable is not enough: each configured model ID must be in the provider's model list. */
async function probeProvider(): Promise<Health> {
  if (!liveConfigured()) return { provider: "not_configured", models: null };
  try {
    if (backend() === "anthropic") {
      const r = await fetch("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" }, signal: AbortSignal.timeout(3000) });
      return { provider: r.ok ? "reachable" : "unreachable", models: null };
    }
    const av = await modelAvailability();
    if (!av.listed) return { provider: "unreachable", models: av.roles };
    return { provider: av.ok ? "reachable" : "model_unavailable", models: av.roles };
  } catch { return { provider: "unreachable", models: null }; }
}

export async function GET() {
  const cap = dailyBudgetMicroUsd();
  const day = budgetDay();
  let remaining: number | null = null, runsUsed: number | null = null;
  try {
    const r = await withScope(appUrl(), { orgId: DEMO_ORG_ID }, (db) => db.query<{ left: string; runs_used: number }>(
      "SELECT (cap_micro_usd - reserved_micro_usd - spent_micro_usd)::text AS left, runs_used FROM budget_days WHERE day = $1", [day]));
    remaining = r.rows[0] ? Number(r.rows[0].left) : cap;
    runsUsed = r.rows[0] ? r.rows[0].runs_used : 0;
  } catch { remaining = null; }
  const mode = providerMode();
  const h: Health = mode === "live" ? await providerHealth() : { provider: "reachable", models: null };
  return Response.json({
    demo_mode: true,
    synthetic_data: true,
    as_of: demoAsOf(),
    provider_mode: mode,
    // Setup slip: a key is present but the app is not in live mode (env is read at start, so a restart is needed).
    mock_with_key: mode !== "live" && !!(process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY),
    provider_backend: mode === "live" ? backend() : null,
    provider: mode === "live" ? h.provider : "not_used",
    models: mode === "live" ? h.models : null,
    budget: { day, cap_micro_usd: cap, remaining_micro_usd: remaining, runs_used: runsUsed, runs_cap: maxRunsPerDay() },
  });
}
