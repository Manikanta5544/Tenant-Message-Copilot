// Baseline runs for the seeded scenarios (decision D3): runs.visitor_hash IS NULL, produced by the real pipeline with the
// configured provider. Every visitor sees these until they generate their own run. Created by `npm run seed`.
import type { LLMProvider } from "@/core/provider";
import { randomUUID } from "node:crypto";
import { appUrl, withScope } from "./client";
import { clearInboxCache } from "./inbox-cache";
import { DEMO_ORG_ID } from "./ids";
import { startRun } from "./runs";
import { TEMPLATE_VERSION } from "@/core/facts";
import { PROMPT_VERSION } from "@/core/provider";

/**
 * A baseline is usable only if it is real pipeline output: completed, and not a degraded fallback. The one fallback-mode
 * run that IS legitimate is an escalation the verifier itself produced (a model-independent safety decision).
 * Provider-down, budget-exhausted and evidence-unavailable fallbacks are excluded, so a seed run during a provider
 * outage can never freeze "the provider was unavailable" in as the demo.
 */
export const USABLE_BASELINE_SQL = `(r.status = 'completed' AND (r.mode <> 'fallback' OR r.flags ?| ARRAY['verification_failed','critical_incident']))`;

/** The newest usable shared baseline per seeded scenario that was produced by an older prompt or wording version than the running code
 *  (or by code that did not record a version). Parameters: $1 = PROMPT_VERSION, $2 = TEMPLATE_VERSION. */
export const STALE_BASELINE_SQL = `SELECT m.id, m.scenario_label AS label FROM messages m
  JOIN LATERAL (SELECT r.* FROM runs r WHERE r.message_id = m.id AND r.visitor_hash IS NULL AND ${USABLE_BASELINE_SQL} ORDER BY r.created_at DESC LIMIT 1) r ON true
  WHERE m.source = 'seeded' AND m.scenario_label IS NOT NULL
    AND (r.prompt_version <> $1 OR NOT EXISTS (SELECT 1 FROM trace_events t WHERE t.run_id = r.id AND t.stage = 'pipeline_started' AND t.payload->>'template_version' = $2))`;
export const staleParams = (): [string, string] => [PROMPT_VERSION, TEMPLATE_VERSION];

export interface BaselineResult { created: number; kept: number; failed: { label: string; reason: string }[] }

export async function seedBaselines(provider: LLMProvider, log: (s: string) => void = () => {}, opts: { refresh?: boolean } = {}): Promise<BaselineResult> {
  const todo = await withScope(appUrl(), { orgId: DEMO_ORG_ID, view: "inbox" }, async (db) =>
    (await db.query<{ id: string; label: string; ok: boolean }>(
      `SELECT m.id, m.scenario_label AS label,
              EXISTS (SELECT 1 FROM runs r WHERE r.message_id = m.id AND r.visitor_hash IS NULL AND ${USABLE_BASELINE_SQL}) AS ok
         FROM messages m WHERE m.source = 'seeded' AND m.scenario_label IS NOT NULL ORDER BY m.scenario_label`)).rows);
  // --refresh: also regenerate scenarios whose newest baseline came from an older prompt or wording version. The old run stays as history.
  const stale = opts.refresh ? new Set(await withScope(appUrl(), { orgId: DEMO_ORG_ID, view: "inbox" }, async (db) => (await db.query<{ id: string }>(STALE_BASELINE_SQL, staleParams())).rows.map((x) => x.id))) : new Set<string>();
  let created = 0, kept = 0;
  const failed: BaselineResult["failed"] = [];
  for (const m of todo) {
    if (m.ok && !stale.has(m.id)) { kept++; continue; }
    try {
      const { runId } = await startRun({ messageId: m.id, idempotencyKey: randomUUID(), provider, visitor: null });
      const usable = await withScope(appUrl(), { orgId: DEMO_ORG_ID, view: "inbox" }, async (db) =>
        (await db.query(`SELECT 1 FROM runs r WHERE r.id = $1 AND ${USABLE_BASELINE_SQL}`, [runId])).rowCount === 1);
      if (usable) { created++; log(`baseline run for ${m.label}`); }
      else { failed.push({ label: m.label, reason: "the run fell back (provider unavailable, budget exhausted or evidence missing)" }); log(`FAILED ${m.label}: run was a fallback, not kept as a baseline`); }
    } catch (e) {
      failed.push({ label: m.label, reason: e instanceof Error ? e.message.slice(0, 200) : "error" });
      log(`FAILED ${m.label}: ${failed.at(-1)!.reason}`);
    }
  }
  clearInboxCache();
  return { created, kept, failed };
}

/** Seeded scenarios that have no usable baseline (what the inbox reports as `setup.baselines_missing`). */
export async function countMissingBaselines(): Promise<number> {
  return withScope(appUrl(), { orgId: DEMO_ORG_ID, view: "inbox" }, async (db) =>
    Number((await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM messages m WHERE m.source = 'seeded' AND m.scenario_label IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.message_id = m.id AND r.visitor_hash IS NULL AND ${USABLE_BASELINE_SQL})`)).rows[0]!.n));
}

/** Prints the outcome and returns the process exit code: non-zero when any scenario has no usable baseline. */
/** Number of seeded scenarios whose newest baseline is older than the running prompt/wording version. */
export async function countStaleBaselines(): Promise<number> {
  return withScope(appUrl(), { orgId: DEMO_ORG_ID, view: "inbox" }, async (db) => (await db.query(STALE_BASELINE_SQL, staleParams())).rowCount ?? 0);
}

export function reportBaselines(r: BaselineResult, print: (s: string) => void = console.log): number {
  print(`baselines: ${r.created} created, ${r.kept} already present, ${r.failed.length} failed`);
  if (!r.failed.length) return 0;
  for (const f of r.failed) print(`  - ${f.label}: ${f.reason}`);
  print("Baselines were NOT created for the scenarios above. Fix the provider (npm run doctor) and re-run: npm run seed");
  return 1;
}
