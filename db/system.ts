// Aggregates for /system. Counts and latencies only: no message text, names, units or visitor identifiers leave this module.
import { budgetDay, dailyBudgetMicroUsd, maxRunsPerDay } from "@/core/config";
import { countEvents } from "@/core/counters";
import { getEnv } from "@/core/env";
import { llmLimiter, rateHeadroom } from "@/core/limiter";
import { caps } from "@/app/server/sse";
import { budgetState } from "./budget";
import { poolMax, appUrl, poolWaitStats, withScope } from "./client";
import { DEMO_ORG_ID } from "./ids";

export interface SystemStats {
  generated_at: string;
  window: { runs_15m: number; runs_1h: number; failed_1h: number };
  route_mix_1h: Record<string, number>;
  end_to_end_ms: { n: number; p50: number | null; p95: number | null };
  stages_ms: { stage: string; n: number; p50: number; p95: number }[];
  retry: { runs: number; retried: number; rate: number | null };
  provider: { mode: string; model_calls_1h: number; failed_calls_1h: number; failure_rate: number | null; busy_1h: number; concurrency: { max: number; active: number; waiting: number; rejected_busy: number; wait_p95_ms: number }; rate_headroom: { remaining_requests: number | null; remaining_tokens: number | null; limit_tokens: number | null; reset_tokens: string | null; seen_s_ago: number } | null };
  budget: { day: string; cap_micro_usd: number; used_micro_usd: number; remaining_micro_usd: number; runs_used: number; runs_cap: number };
  pool: { max: number; wait_p50_ms: number; wait_p95_ms: number; wait_max_ms: number };
  limits: { rate_limited_1h: number; stream_cap_1h: number; streams_open: number };
}
const MODEL_STAGES = ["triage", "adjudicate", "draft", "semantic_check"];
const r1 = (n: unknown) => (n === null || n === undefined ? null : Math.round(Number(n)));

export async function systemStats(): Promise<SystemStats> {
  const env = getEnv();
  const q = await withScope(appUrl(), { orgId: DEMO_ORG_ID, view: "inbox" }, async (db) => {
    const runs = (await db.query(`SELECT count(*) FILTER (WHERE created_at > now() - interval '15 minutes')::int AS m15, count(*)::int AS h1, count(*) FILTER (WHERE status='failed')::int AS failed FROM runs WHERE created_at > now() - interval '1 hour'`)).rows[0];
    const mix = (await db.query(`SELECT coalesce(route,'none') AS route, count(*)::int AS n FROM runs WHERE created_at > now() - interval '1 hour' GROUP BY 1`)).rows;
    const e2e = (await db.query(`SELECT count(*)::int AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY ms) AS p50, percentile_cont(0.95) WITHIN GROUP (ORDER BY ms) AS p95
        FROM (SELECT extract(epoch FROM (finished_at - created_at)) * 1000 AS ms FROM runs WHERE status='completed' AND finished_at IS NOT NULL AND created_at > now() - interval '1 hour') x`)).rows[0];
    const stages = (await db.query(`SELECT stage, count(*)::int AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50, percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95
        FROM trace_events WHERE created_at > now() - interval '1 hour' GROUP BY stage ORDER BY stage`)).rows;
    const retry = (await db.query(`SELECT count(*)::int AS runs, count(*) FILTER (WHERE d > 1)::int AS retried FROM (SELECT run_id, count(*) AS d FROM trace_events WHERE stage='draft' AND created_at > now() - interval '1 hour' GROUP BY run_id) x`)).rows[0];
    const calls = (await db.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE outcome LIKE 'failed:%')::int AS failed FROM trace_events WHERE stage = ANY($1) AND created_at > now() - interval '1 hour'`, [MODEL_STAGES])).rows[0];
    return { runs, mix, e2e, stages, retry, calls };
  });
  const b = await budgetState(appUrl(), DEMO_ORG_ID, budgetDay(), dailyBudgetMicroUsd());
  const h = rateHeadroom();
  const lim = llmLimiter.stats();
  return {
    generated_at: new Date().toISOString(),
    window: { runs_15m: q.runs.m15, runs_1h: q.runs.h1, failed_1h: q.runs.failed },
    route_mix_1h: Object.fromEntries(q.mix.map((x: { route: string; n: number }) => [x.route, x.n])),
    end_to_end_ms: { n: q.e2e.n, p50: r1(q.e2e.p50), p95: r1(q.e2e.p95) },
    stages_ms: q.stages.map((s: { stage: string; n: number; p50: number; p95: number }) => ({ stage: s.stage, n: s.n, p50: Math.round(Number(s.p50)), p95: Math.round(Number(s.p95)) })),
    retry: { runs: q.retry?.runs ?? 0, retried: q.retry?.retried ?? 0, rate: q.retry?.runs ? Math.round((q.retry.retried / q.retry.runs) * 1000) / 1000 : null },
    provider: {
      mode: env.PROVIDER_MODE, model_calls_1h: q.calls.n, failed_calls_1h: q.calls.failed, failure_rate: q.calls.n ? Math.round((q.calls.failed / q.calls.n) * 1000) / 1000 : null,
      busy_1h: countEvents("model_busy", 3_600_000), concurrency: lim,
      rate_headroom: h ? { remaining_requests: h.remaining_requests, remaining_tokens: h.remaining_tokens, limit_tokens: h.limit_tokens, reset_tokens: h.reset_tokens, seen_s_ago: Math.round((Date.now() - h.at) / 1000) } : null,
    },
    budget: { day: budgetDay(), cap_micro_usd: dailyBudgetMicroUsd(), used_micro_usd: b.reserved + b.spent, remaining_micro_usd: b.remaining, runs_used: b.runs_used, runs_cap: maxRunsPerDay() },
    pool: (() => { const w = poolWaitStats(); return { max: poolMax(), wait_p50_ms: Math.round(w.p50_ms), wait_p95_ms: Math.round(w.p95_ms), wait_max_ms: Math.round(w.max_ms) }; })(),
    limits: { rate_limited_1h: countEvents("rate_limited", 3_600_000), stream_cap_1h: countEvents("stream_cap", 3_600_000), streams_open: caps.open },
  };
}

let memo: { at: number; v: SystemStats } | null = null;
/** Cached for 5 s so many open dashboards cost one set of queries. */
export async function cachedSystemStats(now = Date.now()): Promise<SystemStats> {
  if (memo && now - memo.at < 5000) return memo.v;
  const v = await systemStats(); memo = { at: now, v }; return v;
}
export const resetSystemCache = () => { memo = null; };
