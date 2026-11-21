// Atomic daily budget. Reserve is ONE conditional statement: it succeeds only if
// reserved + spent + estimate stays within the cap, so two simultaneous requests cannot both spend it.
import { withScope, type Queryable } from "./client";
import type { BudgetPort } from "@/core/pipeline";

export function dbBudget(url: string, orgId: string, day: string, capMicroUsd: number): BudgetPort {
  return {
    async reserve(estimate) {
      if (estimate > capMicroUsd) return false; // can never fit; also avoids the table CHECK firing on first insert
      return withScope(url, { orgId }, async (db) => {
        const r = await db.query(
          `INSERT INTO budget_days (organization_id, day, cap_micro_usd, reserved_micro_usd)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (organization_id, day) DO UPDATE
             SET reserved_micro_usd = budget_days.reserved_micro_usd + EXCLUDED.reserved_micro_usd,
                 cap_micro_usd = EXCLUDED.cap_micro_usd
             WHERE budget_days.reserved_micro_usd + budget_days.spent_micro_usd + EXCLUDED.reserved_micro_usd <= EXCLUDED.cap_micro_usd
           RETURNING reserved_micro_usd`, [orgId, day, capMicroUsd, estimate]);
        return (r.rowCount ?? 0) === 1;
      });
    },
    async settle(estimate, actual) {
      await withScope(url, { orgId }, (db) => db.query(
        `UPDATE budget_days SET reserved_micro_usd = greatest(reserved_micro_usd - $3, 0), spent_micro_usd = spent_micro_usd + $4
          WHERE organization_id = $1 AND day = $2`, [orgId, day, estimate, Math.min(actual, estimate)]));
    },
  };
}

export async function budgetState(url: string, orgId: string, day: string, cap: number) {
  return withScope(url, { orgId }, async (db) => {
    const r = await db.query(`SELECT reserved_micro_usd::text AS reserved, spent_micro_usd::text AS spent, runs_used FROM budget_days WHERE day = $1`, [day]);
    const reserved = Number(r.rows[0]?.reserved ?? 0), spent = Number(r.rows[0]?.spent ?? 0);
    return { reserved, spent, remaining: Math.max(cap - reserved - spent, 0), runs_used: Number(r.rows[0]?.runs_used ?? 0) };
  });
}

/** Reserves one run in the day's counter with one conditional statement (false = the daily run cap is reached). Call inside a transaction so a rejected run releases its slot. */
export async function reserveRunSlot(db: Queryable, orgId: string, day: string, costCapMicroUsd: number, maxRuns: number): Promise<boolean> {
  if (maxRuns < 1) return false;
  const r = await db.query(
    `INSERT INTO budget_days (organization_id, day, cap_micro_usd, runs_used) VALUES ($1, $2, $3, 1)
     ON CONFLICT (organization_id, day) DO UPDATE SET runs_used = budget_days.runs_used + 1
       WHERE budget_days.runs_used < $4
     RETURNING runs_used`, [orgId, day, costCapMicroUsd, maxRuns]);
  return (r.rowCount ?? 0) === 1;
}
