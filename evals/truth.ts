// Ground truth read straight from the tables over the OWNER connection, deliberately not through the
// application's tools, store or the lease_balance view (a third, independent derivation).
import pg from "pg";
import { resolveValue } from "./expectations";
import type { Truth } from "./score";

export function sqlTruth(c: pg.Client, org: string, asOf: string): Truth {
  return {
    value: (v) => resolveValue(c, v, asOf, org),
    async clause(id) {
      const r = await c.query(`SELECT resident_id, text, number, version, to_char(effective_from,'YYYY-MM-DD') AS f, to_char(effective_to,'YYYY-MM-DD') AS t FROM lease_clauses WHERE id = $1`, [id]);
      const x = r.rows[0];
      return x ? { resident_id: x.resident_id, text: x.text, number: x.number, version: x.version, effective_from: x.f, effective_to: x.t } : null;
    },
    async balanceAt(residentId, at) {
      const r = await c.query(`SELECT coalesce(sum(amount_paise),0)::text AS v FROM ledger_entries WHERE resident_id = $1 AND occurred_on <= $2`, [residentId, at]);
      return Number(r.rows[0].v);
    },
    async payment(residentId, reference, amount, state) {
      const r = await c.query(`SELECT 1 FROM payment_events WHERE resident_id = $1 AND reference = $2 AND amount_paise = $3 AND state = $4 LIMIT 1`, [residentId, reference, amount, state]);
      return r.rowCount === 1;
    },
  };
}
