// Resolves SQL references in golden cases to integer paise using the OWNER connection and the
// lease_balance view: ground truth is independent of the application's tool path.
import pg from "pg";
import type { Value } from "./schema";

export async function resolveValue(c: pg.Client, v: Value, asOf: string, org: string): Promise<number> {
  if (typeof v === "number") return v;
  if (v.sql === "balance") {
    const r = await c.query(
      `SELECT coalesce(sum(b.total_paise),0)::text AS v FROM lease_balance b JOIN residents r ON r.id = b.resident_id
        WHERE r.unit = $1 AND r.organization_id = $2 AND b.occurred_on <= $3`, [v.unit, org, asOf]);
    return Number(r.rows[0].v);
  }
  const r = await c.query(`SELECT amount_paise::text AS v FROM payment_events WHERE reference = $1 AND organization_id = $2 AND NOT is_duplicate LIMIT 1`, [v.reference, org]);
  if (!r.rows[0]) throw new Error(`no payment event with reference ${v.reference}`);
  return Number(r.rows[0].v);
}
