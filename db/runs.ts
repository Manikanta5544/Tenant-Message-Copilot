import { getEnv } from "@/core/env";
// Run service: messages, runs and trace events. Reads for the manager inbox use the read-only inbox
// view scope; every write, and every pipeline query, uses the strict organisation + resident scope
// taken from the stored message row, never from the request or the model.
import { createHash, randomUUID } from "node:crypto";
import { budgetDay, dailyBudgetMicroUsd, demoAsOf, maxMessagesPerHour, maxRunsPerDay, maxRunsPerHour, maxRunsPerIpPerDay, maxRunsPerIpPerHour, maxRunsPerVisitorPerDay, secondsToUtcMidnight } from "@/core/config";
import { logRun, visitorPrefix } from "@/core/log";
import { redact } from "@/core/redact";
import { runPipeline, type PipelineOutput, type TraceEvent } from "@/core/pipeline";
import type { LLMProvider } from "@/core/provider";
import type { Language } from "@/core/types";
import { dbBudget, reserveRunSlot } from "./budget";
import { clearInboxCache } from "./inbox-cache";
import { appUrl, connectClient, withScope, type Queryable } from "./client";
import { DEMO_ORG_ID } from "./ids";
import { makeScopedStore } from "./store";

export const MAX_MESSAGE_CHARS = 1000;
export const STALE_RUN_SECONDS = 90;

export interface InboxRow {
  message_id: string; text: string; created_at: string; scenario_label: string | null; source: "seeded" | "live";
  resident_id: string; resident_name: string; unit: string; preferred_language: Language;
  run: null | { id: string; intent: string | null; urgency: string | null; language: string | null; route: string | null; status: string; mode: string };
}

/** Seeded scenarios plus the caller's own live messages; other visitors' messages are never shown.
 *  Per message, the run shown is the caller's own latest, else the shared baseline run (decision D3). */
export async function listInbox(visitor: string | null = null): Promise<InboxRow[]> {
  return withScope(appUrl(), { orgId: DEMO_ORG_ID, view: "inbox" }, async (db) => {
    const r = await db.query(`
      SELECT m.id AS message_id, m.text, m.created_at, m.scenario_label, m.source, r.id AS resident_id, r.name AS resident_name, r.unit, r.preferred_language,
             lr.id AS run_id, lr.intent, lr.urgency, lr.language, lr.route, lr.status, lr.mode
        FROM messages m JOIN residents r ON r.id = m.resident_id
        -- D3: the visitor's own latest run if one exists, otherwise the shared baseline (visitor_hash IS NULL). A visitor's run never alters what others see.
        LEFT JOIN LATERAL (SELECT * FROM runs WHERE message_id = m.id AND (visitor_hash = $1 OR visitor_hash IS NULL)
                            ORDER BY (visitor_hash IS NULL), created_at DESC LIMIT 1) lr ON true
       WHERE m.source = 'seeded' OR (m.visitor_hash IS NOT NULL AND m.visitor_hash = $1)
       ORDER BY (m.scenario_label IS NULL), m.scenario_label, m.created_at DESC`, [visitor]);
    return r.rows.map((x) => ({
      message_id: x.message_id, text: x.text, created_at: new Date(x.created_at).toISOString(), scenario_label: x.scenario_label, source: x.source,
      resident_id: x.resident_id, resident_name: x.resident_name, unit: x.unit, preferred_language: x.preferred_language,
      run: x.run_id ? { id: x.run_id, intent: x.intent, urgency: x.urgency, language: x.language, route: x.route, status: x.status, mode: x.mode } : null,
    }));
  });
}

export async function listResidents(): Promise<{ id: string; name: string; unit: string; preferred_language: Language }[]> {
  return withScope(appUrl(), { orgId: DEMO_ORG_ID, view: "inbox" }, async (db) =>
    (await db.query(`SELECT id, name, unit, preferred_language FROM residents ORDER BY unit`)).rows);
}

/** A custom message: the resident is chosen from the seeded list; the database rejects anything outside the fixed organisation.
 *  The per-visitor hourly cap is checked under an advisory lock, so concurrent posts cannot slip past it. */
export async function createMessage(residentId: string, text: string, visitor: string | null = null): Promise<string> {
  const id = randomUUID();
  await withScope(appUrl(), { orgId: DEMO_ORG_ID, residentId, view: "inbox" }, async (db) => {
    const ok = await db.query(`SELECT 1 FROM residents WHERE id = $1`, [residentId]);
    if (ok.rowCount !== 1) throw new HttpError(404, "unknown resident");
    if (visitor) {
      await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`msg:${visitor}`]);
      const n = Number((await db.query(`SELECT count(*)::int AS n FROM messages WHERE visitor_hash = $1 AND created_at > now() - interval '60 minutes'`, [visitor])).rows[0]!.n);
      if (n >= maxMessagesPerHour()) throw new HttpError(429, "message limit reached for this demo", { retry_after_s: Math.min(86_400, Math.max(1, Number((await db.query(`SELECT CEIL(EXTRACT(EPOCH FROM (min(created_at) + interval '60 minutes' - now())))::int AS s FROM messages WHERE visitor_hash = $1 AND created_at > now() - interval '60 minutes'`, [visitor])).rows[0]?.s ?? 3600))) });
    }
    await db.query(`INSERT INTO messages (id, organization_id, resident_id, text, source, visitor_hash) VALUES ($1, $2, $3, $4, 'live', $5)`, [id, DEMO_ORG_ID, residentId, text, visitor]);
  });
  clearInboxCache();
  return id;
}

export class HttpError extends Error { constructor(public status: number, message: string, public extra?: Record<string, unknown>) { super(message); } }

/** IP only: the User-Agent is attacker-controlled, so hashing it would let anyone dodge the limit by changing it. */
/** Salted hash of the client address a trusted proxy reported (the per-network ceiling key). Never the raw address. */
export const netHash = (addr: string) => createHash("sha256").update(`${getEnv().VISITOR_SALT ?? "demo"}|net|${addr}`).digest("hex").slice(0, 32);
export const visitorHash = (ip: string) => createHash("sha256").update(`${getEnv().VISITOR_SALT ?? "demo"}|${ip}`).digest("hex").slice(0, 32);

export async function recentRunCount(hash: string, windowMinutes: number): Promise<number> {
  return withScope(appUrl(), { orgId: DEMO_ORG_ID, view: "inbox" }, async (db) =>
    Number((await db.query(`SELECT count(*)::int AS n FROM runs WHERE visitor_hash = $1 AND created_at > now() - ($2 || ' minutes')::interval`, [hash, String(windowMinutes)])).rows[0]!.n));
}

export interface RunView {
  id: string; message_id: string; message_text: string; resident: { name: string; unit: string; preferred_language: Language };
  prompt_version: string; mode: string; intent: string | null; urgency: string | null; language: string | null; route: string | null; route_reasons: string[];
  segments: unknown[]; facts: unknown[]; verification: unknown[]; flags: string[]; status: string; created_at: string; finished_at: string | null;
  banner: "budget_exhausted" | "provider_failed" | null;
}
export interface TraceRow { seq: number; stage: string; model: string | null; tokens_in: number; tokens_out: number; cost_micro_usd: number; latency_ms: number; outcome: string; payload: unknown; created_at: string }

type TraceDbRow = { seq: number; stage: string; model: string | null; tokens_in: number; tokens_out: number; cost: string | number; latency_ms: number; outcome: string; payload: unknown; created_at: string | Date };
type RunRow = Record<string, unknown> & { id: string; message_id: string; message_text: string; name: string; unit: string; preferred_language: Language; prompt_version: string; mode: string; intent: string | null; urgency: string | null; language: string | null; route: string | null; status: string; created_at: string | Date; finished_at: string | Date | null; flags: string[] | null; route_reasons: string[] | null; segments: RunView["segments"] | null; facts: RunView["facts"] | null; verification: RunView["verification"] | null };
function toView(x: RunRow): RunView {
  const flags: string[] = x.flags ?? [];
  return {
    id: x.id, message_id: x.message_id, message_text: x.message_text, resident: { name: x.name, unit: x.unit, preferred_language: x.preferred_language },
    prompt_version: x.prompt_version, mode: x.mode, intent: x.intent, urgency: x.urgency, language: x.language, route: x.route, route_reasons: x.route_reasons ?? [],
    segments: x.segments ?? [], facts: x.facts ?? [], verification: x.verification ?? [], flags, status: x.status,
    created_at: new Date(x.created_at).toISOString(), finished_at: x.finished_at ? new Date(x.finished_at).toISOString() : null,
    banner: flags.includes("budget_exhausted") ? "budget_exhausted" : flags.includes("provider_failed") ? "provider_failed" : null,
  };
}
const RUN_SELECT = `SELECT r.*, m.text AS message_text, s.name, s.unit, s.preferred_language FROM runs r JOIN messages m ON m.id = r.message_id JOIN residents s ON s.id = r.resident_id`;

/** A cheap version token for conditional GETs: one small query, no run body. It changes when the run's status, its trace or the caller's reviews change. */
export async function runVersion(runId: string, visitor: string | null): Promise<{ token: string; stale: boolean } | null> {
  return withScope(appUrl(), { orgId: DEMO_ORG_ID, view: "inbox" }, async (db) => {
    const r = await db.query(
      `SELECT r.status, extract(epoch FROM r.finished_at)::text AS fin, extract(epoch FROM (now() - r.created_at)) AS age_s,
              (SELECT count(*) FROM trace_events t WHERE t.run_id = r.id)::int AS n,
              (SELECT count(*) FROM review_actions a JOIN runs q ON q.id = a.run_id WHERE q.message_id = r.message_id AND a.visitor_hash = $2)::int AS rev
         FROM runs r WHERE r.id = $1`, [runId, visitor]);
    const x = r.rows[0] as { status: string; fin: string | null; age_s: number; n: number; rev: number } | undefined;
    if (!x) return null;
    return { token: `${runId}.${x.status}.${x.fin ?? "-"}.${x.n}.${x.rev}`, stale: x.status === "running" && x.age_s > STALE_RUN_SECONDS };
  });
}

export async function getRun(runId: string): Promise<{ run: RunView; trace: TraceRow[] } | null> {
  const url = appUrl();
  const found = await withScope(url, { orgId: DEMO_ORG_ID, view: "inbox" }, async (db) => {
    const r = await db.query(`${RUN_SELECT} WHERE r.id = $1`, [runId]);
    if (!r.rows[0]) return null;
    const t = await db.query(`SELECT seq, stage, model, tokens_in, tokens_out, cost_micro_usd::text AS cost, latency_ms, outcome, payload, created_at FROM trace_events WHERE run_id = $1 ORDER BY seq`, [runId]);
    return { row: r.rows[0], trace: t.rows };
  });
  if (!found) return null;
  let row = found.row;
  // An unfinished run past its timeout is marked failed on the next read (the function may have been cut).
  if (row.status === "running" && Date.now() - new Date(row.created_at).getTime() > STALE_RUN_SECONDS * 1000) {
    await withScope(url, { orgId: DEMO_ORG_ID, residentId: row.resident_id }, (db) =>
      db.query(`UPDATE runs SET status = 'failed', finished_at = now() WHERE id = $1 AND status = 'running'`, [runId]));
    clearInboxCache();
    row = { ...row, status: "failed" };
  }
  return {
    run: toView(row),
    trace: found.trace.map((t: TraceDbRow): TraceRow => ({ seq: t.seq, stage: t.stage, model: t.model, tokens_in: t.tokens_in, tokens_out: t.tokens_out, cost_micro_usd: Number(t.cost), latency_ms: t.latency_ms, outcome: t.outcome, payload: redact(t.payload), created_at: new Date(t.created_at).toISOString() })),
  };
}

/** One cheap query for the live stream: the run's status plus the trace rows after `afterSeq`. Same scope as getRun. */
export async function pollRun(runId: string, afterSeq: number): Promise<{ status: string; age_s: number; events: TraceRow[] } | null> {
  return withScope(appUrl(), { orgId: DEMO_ORG_ID, view: "inbox" }, async (db) => {
    const r = await db.query(
      `SELECT r.status, extract(epoch FROM (now() - r.created_at))::float AS age_s,
              COALESCE((SELECT json_agg(x ORDER BY x.seq) FROM (SELECT seq, stage, model, tokens_in, tokens_out, cost_micro_usd::text AS cost, latency_ms, outcome, payload, created_at
                          FROM trace_events WHERE run_id = r.id AND seq > $2 ORDER BY seq) x), '[]'::json) AS ev
         FROM runs r WHERE r.id = $1`, [runId, afterSeq]);
    const x = r.rows[0] as { status: string; age_s: number; ev: TraceDbRow[] } | undefined;
    if (!x) return null;
    return { status: x.status, age_s: x.age_s, events: x.ev.map((t): TraceRow => ({ seq: t.seq, stage: t.stage, model: t.model, tokens_in: t.tokens_in, tokens_out: t.tokens_out, cost_micro_usd: Number(t.cost), latency_ms: t.latency_ms, outcome: t.outcome, payload: redact(t.payload), created_at: new Date(t.created_at).toISOString() })) };
  });
}

export interface RunHandle {
  runId: string; created: boolean;
  /** Present only when this call created the run; executes the pipeline and persists every step. */
  execute: (() => Promise<void>) | null;
}

/** Creates the run (or returns the existing one for this idempotency key). Limits are enforced inside the same
 *  transaction as the insert, under a per-visitor advisory lock, so a rejected run leaves no row and no used slot. */
/** A 'running' row older than this belongs to a dead process (maxDuration is 60 s). */
const STALE_RUN_S = 120;

/** Seconds until the oldest run in the window leaves it, i.e. when this client may create another. Capped at one day, at least 1. */
async function waitForRunSlot(db: Queryable, by: "visitor" | "net", key: string, windowS: number): Promise<number> {
  const sql = by === "visitor"
    ? `SELECT CEIL(EXTRACT(EPOCH FROM (min(created_at) + make_interval(secs => $2) - now())))::int AS s FROM runs WHERE visitor_hash = $1 AND created_at > now() - make_interval(secs => $2)`
    : `SELECT CEIL(EXTRACT(EPOCH FROM (min(created_at) + make_interval(secs => $2) - now())))::int AS s FROM runs WHERE net_hash = $1 AND created_at > now() - make_interval(secs => $2)`;
  const s = Number((await db.query(sql, [key, windowS])).rows[0]?.s ?? windowS);
  return Math.min(86_400, Math.max(1, s));
}

export async function createRun(a: { messageId: string; idempotencyKey: string; provider: LLMProvider; visitor: string | null; net?: string | null }): Promise<RunHandle> {
  const url = appUrl();
  const asOf = demoAsOf();
  // The resident comes from the stored message row.
  const msg = await withScope(url, { orgId: DEMO_ORG_ID, view: "inbox" }, async (db) => {
    const r = await db.query(`SELECT m.id, m.text, m.resident_id, s.unit, s.preferred_language FROM messages m JOIN residents s ON s.id = m.resident_id WHERE m.id = $1 AND (m.source = 'seeded' OR (m.visitor_hash IS NOT NULL AND m.visitor_hash = $2))`, [a.messageId, a.visitor]);
    return r.rows[0] as { id: string; text: string; resident_id: string; unit: string; preferred_language: Language } | undefined;
  });
  if (!msg) throw new HttpError(404, "message not found");
  const scope = { orgId: DEMO_ORG_ID, residentId: msg.resident_id };
  const runId = randomUUID();

  // The inbox view is added so the visitor's runs can be counted across residents; inserts still need the strict scope.
  const inserted = await withScope(url, { ...scope, view: "inbox" }, async (db) => {
    if (a.visitor) await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`run:${a.visitor}`]);
    if (a.net) await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`net:${a.net}`]);
    // Single flight per (message, visitor): the lock serialises concurrent POSTs; the partial unique index is the backstop.
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`flight:${msg.id}:${a.visitor ?? ""}`]);
    // A run whose process died stays 'running'; after STALE_RUN_S it is closed so it cannot block the message forever.
    await db.query(`UPDATE runs SET status='failed', finished_at=now() WHERE message_id=$1 AND COALESCE(visitor_hash,'')=$2 AND status='running' AND created_at < now() - ($3 || ' seconds')::interval`, [msg.id, a.visitor ?? "", String(STALE_RUN_S)]);
    // A key already used is answered before the single-flight join: a reused key for a different message must be a 409 even while that
    // other message has a run in flight (row-level security hides other residents' rows, so they fall through to the insert below).
    const used = await db.query(`SELECT id, message_id FROM runs WHERE idempotency_key = $1`, [a.idempotencyKey]);
    if (used.rowCount === 1) return used.rows[0] as { id: string; message_id: string };
    const same = await db.query(`SELECT id FROM runs WHERE message_id=$1 AND COALESCE(visitor_hash,'')=$2 AND status='running' AND idempotency_key <> $3 LIMIT 1`, [msg.id, a.visitor ?? "", a.idempotencyKey]);
    if (same.rowCount === 1) return { id: same.rows[0].id as string, message_id: msg.id };
    const r = await db.query(
      `INSERT INTO runs (id, organization_id, resident_id, message_id, prompt_version, mode, status, idempotency_key, visitor_hash, net_hash)
       VALUES ($1,$2,$3,$4,$5,$6,'running',$7,$8,$9) ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING id`,
      [runId, DEMO_ORG_ID, msg.resident_id, msg.id, (await import("@/core/provider")).PROMPT_VERSION, a.provider.label, a.idempotencyKey, a.visitor, a.net ?? null]);
    if (r.rowCount === 1) {
      if (a.visitor) {
        const n = Number((await db.query(`SELECT count(*)::int AS n FROM runs WHERE visitor_hash = $1 AND created_at > now() - interval '60 minutes'`, [a.visitor])).rows[0]!.n);
        if (n > maxRunsPerHour()) throw new HttpError(429, "rate limit reached for this demo", { retry_after_s: await waitForRunSlot(db, "visitor", a.visitor, 3600) });
        // A per-visitor daily ceiling stops one noisy visitor from using the demo-wide daily run cap for everyone.
        const d = Number((await db.query(`SELECT count(*)::int AS n FROM runs WHERE visitor_hash = $1 AND created_at > now() - interval '24 hours'`, [a.visitor])).rows[0]!.n);
        if (d > maxRunsPerVisitorPerDay()) throw new HttpError(429, "daily limit reached for this visitor; try again tomorrow", { retry_after_s: await waitForRunSlot(db, "visitor", a.visitor, 86_400) });
      }
      if (a.net) {
        // Per-network ceilings do not depend on the cookie, so discarding it buys nothing.
        const h = Number((await db.query(`SELECT count(*)::int AS n FROM runs WHERE net_hash = $1 AND created_at > now() - interval '60 minutes'`, [a.net])).rows[0]!.n);
        if (h > maxRunsPerIpPerHour()) throw new HttpError(429, "rate limit reached for this network; try again later", { retry_after_s: await waitForRunSlot(db, "net", a.net, 3600) });
        const d = Number((await db.query(`SELECT count(*)::int AS n FROM runs WHERE net_hash = $1 AND created_at > now() - interval '24 hours'`, [a.net])).rows[0]!.n);
        if (d > maxRunsPerIpPerDay()) throw new HttpError(429, "daily limit reached for this network; try again tomorrow", { retry_after_s: await waitForRunSlot(db, "net", a.net, 86_400) });
      }
      if (!(await reserveRunSlot(db, DEMO_ORG_ID, budgetDay(), dailyBudgetMicroUsd(), maxRunsPerDay()))) throw new HttpError(429, "the demo's daily run limit is reached; try again tomorrow (UTC)", { retry_after_s: secondsToUtcMidnight() });
      return null;
    }
    const ex = await db.query(`SELECT id, message_id FROM runs WHERE idempotency_key = $1`, [a.idempotencyKey]);
    // Row-level security hides another resident's run: a key collision with one is reported as a conflict, revealing nothing about it.
    return (ex.rows[0] as { id: string; message_id: string } | undefined) ?? { id: "", message_id: "" };
  });
  if (inserted) {
    if (inserted.message_id !== msg.id) throw new HttpError(409, "idempotency key already used for a different message");
    return { runId: inserted.id, created: false, execute: null };
  }
  clearInboxCache();
  return { runId, created: true, execute: () => executeRun({ runId, msg, scope, asOf, provider: a.provider, visitor: a.visitor }) };
}

async function executeRun(c: { runId: string; msg: { id: string; text: string; resident_id: string; unit: string; preferred_language: Language }; scope: { orgId: string; residentId: string }; asOf: string; provider: LLMProvider; visitor: string | null }): Promise<void> {
  const url = appUrl();
  const { runId, msg, scope, asOf } = c;
  let seq = 0;
  const stages: Record<string, number> = {}; let tin = 0, tout = 0, cost = 0;
  const emit = async (e: TraceEvent) => {
    stages[e.stage] = Math.round((stages[e.stage] ?? 0) + (e.latency_ms ?? 0)); tin += e.tokens_in ?? 0; tout += e.tokens_out ?? 0; cost += e.cost_micro_usd ?? 0;
    // One statement and one round trip: the scope is set in a CTE that the INSERT reads from, so row security sees it.
    // Saved before it is emitted anywhere else.
    const client = await connectClient(url);
    let broken = false;
    try {
      await client.query(
        `WITH s AS (SELECT set_config('app.org_id', $1, true), set_config('app.resident_id', $2, true), set_config('app.view', '', true))
         INSERT INTO trace_events (id, organization_id, resident_id, run_id, seq, stage, model, tokens_in, tokens_out, cost_micro_usd, latency_ms, outcome, payload)
         SELECT $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15 FROM s`,
        [scope.orgId, scope.residentId, randomUUID(), DEMO_ORG_ID, msg.resident_id, runId, ++seq, e.stage, e.model ?? null, e.tokens_in ?? 0, e.tokens_out ?? 0, e.cost_micro_usd ?? 0, Math.round(e.latency_ms ?? 0), e.outcome, JSON.stringify(e.payload ?? {})]);
    } catch (err) { broken = true; throw err; } finally { client.release(broken); }
  };

  let out: PipelineOutput | null = null;
  try {
    out = await runPipeline(
      { provider: c.provider, store: makeScopedStore(url, scope), budget: dbBudget(url, DEMO_ORG_ID, budgetDay(), dailyBudgetMicroUsd()), emit, now: () => performance.now() },
      { message: msg.text, residentId: msg.resident_id, ownUnit: msg.unit, preferredLanguage: msg.preferred_language, asOf });
    const o = out;
    await withScope(url, scope, (db) => db.query(
      `UPDATE runs SET mode=$2, intent=$3, urgency=$4, language=$5, route=$6, route_reasons=$7, segments=$8, facts=$9, verification=$10, flags=$11, status='completed', finished_at=now() WHERE id=$1`,
      [runId, o.mode, o.intent, o.urgency, o.language, o.route, JSON.stringify(o.reasons), JSON.stringify(o.rendered), JSON.stringify(o.bundle.facts), JSON.stringify(o.verification), JSON.stringify(o.flags)]));
    clearInboxCache();
    logRun({ run_id: runId, route: o.route, outcome: "completed", mode: o.mode, stage_latency_ms: stages, tokens_in: tin, tokens_out: tout, cost_micro_usd: cost, visitor: visitorPrefix(c.visitor) });
  } catch (e) {
    logRun({ run_id: runId, route: null, outcome: "failed", mode: null, stage_latency_ms: stages, tokens_in: tin, tokens_out: tout, cost_micro_usd: cost, visitor: visitorPrefix(c.visitor), error: e instanceof Error ? e.name : "error" });
    await withScope(url, scope, (db) => db.query(`UPDATE runs SET status='failed', finished_at=now() WHERE id=$1`, [runId])).catch(() => {});
    clearInboxCache();
    throw e;
  }
}

/** Create and run to completion (tests, scripts). The HTTP route uses createRun and finishes the pipeline after responding. */
export async function startRun(a: { messageId: string; idempotencyKey: string; provider: LLMProvider; visitor: string | null }): Promise<{ runId: string; created: boolean }> {
  const h = await createRun(a);
  if (h.execute) await h.execute();
  return { runId: h.runId, created: h.created };
}

export async function latestEvalRuns(limit = 5) {
  return withScope(appUrl(), { orgId: DEMO_ORG_ID }, async (db) =>
    (await db.query(`SELECT id, prompt_version, git_commit, mode, summary, results, created_at FROM eval_runs ORDER BY created_at DESC LIMIT $1`, [limit])).rows.map((x) => ({
      id: x.id, prompt_version: x.prompt_version, git_commit: x.git_commit, mode: x.mode, summary: x.summary, results: x.results, created_at: new Date(x.created_at).toISOString() })));
}
