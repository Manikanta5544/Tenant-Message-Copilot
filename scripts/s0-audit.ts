// Independent S0 check over every completed run in the database (read-only). It does not use the pipeline's own verifier:
//  1. free-text segments contain no money, dates, numbers or payment references;
//  2. balance and payment facts equal the ledger (the SQL view and the payment_events row);
//  3. every quoted clause is a substring of the stored clause text;
//  4. no draft_ready run carries a balance or payment fact.
// Usage: npm run s0-audit        (also run by `npm run doctor -- --deep`)
import pg from "pg";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { guardText } from "../core/guard";
import { formatInr } from "../core/money";
import { rawEnv } from "../core/env";
import type { Fact } from "../core/types";

export interface AuditRun { id: string; route: string | null; segments: { type: string; text?: string; refId?: string; id?: string }[]; facts: Fact[] }
export interface Lookups {
  /** Text of the stored lease clause with this id, or null. */
  clauseText(clauseId: string): Promise<string | null>;
  /** Amount of the stored payment event with this reference on this lease, or null. */
  paymentAmount(leaseId: string, reference: string): Promise<number | null>;
  /** Balance the SQL view reports for the lease as of the date, or null. */
  sqlBalance(leaseId: string, asOf: string): Promise<number | null>;
}

export async function auditRun(run: AuditRun, db: Lookups): Promise<string[]> {
  const v: string[] = [], byId = new Map(run.facts.map((f) => [f.id, f]));
  const refs = run.facts.filter((f) => f.kind === "payment").map((f) => (f as { reference: string }).reference);
  for (const s of run.segments) {
    if (s.type === "text") {
      for (const g of guardText(s.text ?? "")) v.push(`free text carries ${g.category} "${g.match}"`);
      for (const r of refs) if ((s.text ?? "").toLowerCase().includes(r.toLowerCase())) v.push(`free text carries payment reference ${r}`);
    }
    const sid = s.refId ?? s.id;
    const f = sid ? byId.get(sid) : undefined;
    if (s.type === "fact" && !f) v.push(`fact segment ${sid} has no fact`);
    if (s.type === "fact" && f?.kind === "balance") {
      // The text a manager reads must be the ledger's number, not a number the fact merely claims.
      const sql = await db.sqlBalance(f.leaseId, f.as_of);
      if (sql !== null && s.text !== formatInr(sql)) v.push(`balance text "${s.text}" differs from the ledger value ${formatInr(sql)}`);
    }
    if (s.type === "fact" && f?.kind === "payment") {
      const stored = await db.paymentAmount(f.leaseId, f.reference);
      if (stored !== null && !(s.text ?? "").includes(formatInr(stored))) v.push(`payment text "${s.text}" does not carry the stored amount ${formatInr(stored)}`);
    }
    if (s.type === "quote") {
      if (!f || f.kind !== "clause") v.push(`quote segment ${sid} is not a clause fact`);
      else {
        const stored = await db.clauseText(f.clause.id);
        if (stored === null || !stored.includes(f.clause.text) || (s.text !== undefined && !stored.includes(s.text.replace(/^[“"]|[”"]$/g, "")))) v.push(`clause quote ${sid} is not a substring of the stored clause`);
      }
    }
    if (run.route === "draft_ready" && f && (f.kind === "balance" || f.kind === "payment")) v.push(`draft_ready run carries a ${f.kind} fact (${f.id})`);
  }
  for (const f of run.facts) {
    if (f.kind === "balance") {
      if (!f.crosscheck.agree || f.crosscheck.ts_paise !== f.balance_paise || f.crosscheck.sql_paise !== f.balance_paise) v.push(`balance fact ${f.id} disagrees with its own crosscheck`);
      const sql = await db.sqlBalance(f.leaseId, f.as_of);
      if (sql !== null && sql !== f.balance_paise) v.push(`balance fact ${f.id} is ${f.balance_paise} but the ledger view says ${sql}`);
    }
    if (f.kind === "payment") {
      const stored = await db.paymentAmount(f.leaseId, f.reference);
      if (stored === null) v.push(`payment fact ${f.id} (${f.reference}) has no stored payment event`);
      else if (stored !== f.amount_paise) v.push(`payment fact ${f.id} (${f.reference}) is ${f.amount_paise} but the stored event is ${stored}`);
    }
  }
  return v;
}

export async function s0Audit(ownerUrl: string): Promise<{ runs: number; violations: string[] }> {
  const c = new pg.Client({ connectionString: ownerUrl, connectionTimeoutMillis: 8000 });
  await c.connect();
  try {
    await c.query("BEGIN READ ONLY");
    const db: Lookups = {
      clauseText: async (id) => (await c.query("SELECT text FROM lease_clauses WHERE id = $1", [id])).rows[0]?.text ?? null,
      paymentAmount: async (lease, ref) => { const r = (await c.query("SELECT amount_paise::bigint AS a FROM payment_events WHERE lease_id = $1 AND lower(reference) = lower($2) AND duplicate_of IS NULL LIMIT 1", [lease, ref])).rows[0]; return r ? Number(r.a) : null; },
      sqlBalance: async (lease, asOf) => { return Number((await c.query("SELECT coalesce(sum(total_paise), 0)::bigint AS b FROM lease_balance WHERE lease_id = $1 AND occurred_on <= $2::date", [lease, asOf])).rows[0].b); },
    };
    const runs = (await c.query("SELECT id, route, segments, facts FROM runs WHERE status = 'completed' ORDER BY created_at")).rows as AuditRun[];
    const violations: string[] = [];
    for (const r of runs) for (const m of await auditRun(r, db)) violations.push(`run ${r.id}: ${m}`);
    await c.query("ROLLBACK");
    return { runs: runs.length, violations };
  } finally { await c.end(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = rawEnv().DATABASE_URL_OWNER;
  if (!url) { console.error("s0-audit: DATABASE_URL_OWNER is not set"); process.exit(2); }
  const { runs, violations } = await s0Audit(url);
  for (const v of violations.slice(0, 50)) console.log("S0  " + v);
  console.log(violations.length ? `\ns0-audit: ${violations.length} violation(s) across ${runs} completed run(s)` : `s0-audit: ${runs} completed run(s), 0 violations`);
  process.exit(violations.length ? 1 : 0);
}
