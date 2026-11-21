// EvidenceStore over SQL. The Queryable is already scoped by RLS (organisation + resident),
// so nothing here takes an organisation or resident id; lease ids come from getLease().
import type { Queryable } from "./client";
import type { ClauseRow, EvidenceStore, IsoDate, LeaseRow, LedgerLine, PaymentEventRow } from "@/core/types";
import { withScope, type Scope } from "./client";

const MAX_QUERIES = 3;

export function makeStore(db: Queryable): EvidenceStore {
  return {
    async getLease(asOf) {
      const r = await db.query(
        `SELECT id, rent_paise::text AS rent_paise, due_day, grace_days, deposit_paise::text AS deposit_paise, late_fee_rule
           FROM leases WHERE active AND start_date <= $1 ORDER BY start_date DESC LIMIT 1`, [asOf]);
      const x = r.rows[0];
      if (!x) return null;
      const lease: LeaseRow = { id: x.id, rent_paise: Number(x.rent_paise), due_day: x.due_day, grace_days: x.grace_days, deposit_paise: Number(x.deposit_paise), late_fee_rule: x.late_fee_rule };
      return lease;
    },

    async getLedger(leaseId, asOf) {
      const r = await db.query(
        `SELECT id, entry_type, amount_paise::text AS amount_paise, description, to_char(occurred_on,'YYYY-MM-DD') AS occurred_on, external_reference
           FROM ledger_entries WHERE lease_id = $1 AND occurred_on <= $2 ORDER BY occurred_on, recorded_at, id`, [leaseId, asOf]);
      return r.rows.map((x): LedgerLine => ({ id: x.id, entry_type: x.entry_type, amount_paise: Number(x.amount_paise), description: x.description, occurred_on: x.occurred_on, external_reference: x.external_reference }));
    },

    // Independent derivation: sums the lease_balance view, not the raw rows the TypeScript path uses.
    async getSqlBalance(leaseId, asOf) {
      const r = await db.query(`SELECT coalesce(sum(total_paise),0)::text AS b FROM lease_balance WHERE lease_id = $1 AND occurred_on <= $2`, [leaseId, asOf]);
      return Number(r.rows[0]?.b ?? 0);
    },

    async getBalanceSnapshot(leaseId, asOf) {
      const r = await db.query(
        `SELECT (SELECT coalesce(json_agg(json_build_object('id', id, 'entry_type', entry_type, 'amount_paise', amount_paise::text,
                  'description', description, 'occurred_on', to_char(occurred_on,'YYYY-MM-DD'), 'external_reference', external_reference)
                  ORDER BY occurred_on, recorded_at, id), '[]'::json) FROM ledger_entries WHERE lease_id = $1 AND occurred_on <= $2) AS lines,
                (SELECT coalesce(sum(total_paise),0)::text FROM lease_balance WHERE lease_id = $1 AND occurred_on <= $2) AS sql_balance`, [leaseId, asOf]);
      const x = r.rows[0]!;
      const lines = (x.lines as (Omit<LedgerLine, "amount_paise"> & { amount_paise: string })[]).map((l): LedgerLine => ({ ...l, amount_paise: Number(l.amount_paise) }));
      return { lines, sql_balance_paise: Number(x.sql_balance) };
    },

    async getPaymentEvents(leaseId, asOf) {
      const r = await db.query(
        `SELECT e.id, e.reference, e.amount_paise::text AS amount_paise, e.state,
                to_char(e.received_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD') AS received_on,
                e.is_duplicate, e.note, (p.id IS NOT NULL) AS posted, (rv.id IS NOT NULL) AS reversed
           FROM payment_events e
           LEFT JOIN ledger_entries p  ON p.source_event_id = e.id
           LEFT JOIN ledger_entries rv ON rv.reverses_entry_id = p.id
          WHERE e.lease_id = $1 AND (e.received_at AT TIME ZONE 'Asia/Kolkata')::date <= $2
          ORDER BY e.received_at, e.id`, [leaseId, asOf]);
      return r.rows.map((x): PaymentEventRow => ({ id: x.id, reference: x.reference, amount_paise: Number(x.amount_paise), state: x.state, received_on: x.received_on, is_duplicate: x.is_duplicate, note: x.note, posted: x.posted, reversed: x.reversed }));
    },

    // English full-text search. Each query becomes an OR of its stemmed words; only clauses that apply on asOf are returned.
    async searchClauses(leaseId, queries, asOf: IsoDate) {
      const best = new Map<string, { row: ClauseRow; rank: number }>();
      for (const raw of queries.slice(0, MAX_QUERIES)) {
        const q = raw.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().slice(0, 200);
        if (!q) continue;
        const r = await db.query(
          `WITH q AS (SELECT to_tsquery('english', array_to_string(tsvector_to_array(to_tsvector('english', $2)), ' | ')) AS tsq)
           SELECT c.id, c.number, c.heading, c.text, c.version,
                  to_char(c.effective_from,'YYYY-MM-DD') AS effective_from, to_char(c.effective_to,'YYYY-MM-DD') AS effective_to,
                  c.amendment_ref, ts_rank(c.tsv, q.tsq) AS rank
             FROM lease_clauses c, q
            WHERE c.lease_id = $1 AND c.tsv @@ q.tsq
              AND c.effective_from <= $3 AND (c.effective_to IS NULL OR $3 < c.effective_to)
            ORDER BY rank DESC, c.number LIMIT 3`, [leaseId, q, asOf]);
        for (const x of r.rows) {
          const rank = Number(x.rank);
          const row: ClauseRow = { id: x.id, number: x.number, heading: x.heading, text: x.text, version: x.version, effective_from: x.effective_from, effective_to: x.effective_to, amendment_ref: x.amendment_ref, rank };
          const prev = best.get(row.id);
          if (!prev || rank > prev.rank) best.set(row.id, { row, rank });
        }
      }
      return [...best.values()].sort((a, b) => b.rank - a.rank || a.row.number - b.row.number).slice(0, 5).map((v) => v.row);
    },
  };
}

/** Store whose every call is its own short transaction with the scope set first (no transaction spans a model call). */
export function makeScopedStore(url: string, scope: Scope): EvidenceStore {
  const run = <T>(f: (s: EvidenceStore) => Promise<T>) => withScope(url, scope, (db) => f(makeStore(db)));
  return {
    getLease: (a) => run((s) => s.getLease(a)),
    getLedger: (l, a) => run((s) => s.getLedger(l, a)),
    getSqlBalance: (l, a) => run((s) => s.getSqlBalance(l, a)),
    getBalanceSnapshot: (l, a) => run((s) => s.getBalanceSnapshot(l, a)),
    getPaymentEvents: (l, a) => run((s) => s.getPaymentEvents(l, a)),
    searchClauses: (l, q, a) => run((s) => s.searchClauses(l, q, a)),
  };
}
