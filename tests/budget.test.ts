import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { budgetState, dbBudget } from "../db/budget";
import { closeAllPools } from "../db/client";
import { ORG_A } from "../db/ids";
import { APP_URL, HAS_DB, OWNER_URL } from "./helpers";

const DAY = "2030-01-01";
describe.skipIf(!HAS_DB)("atomic daily budget", () => {
  afterAll(closeAllPools);
  beforeEach(async () => {
    const c = new pg.Client({ connectionString: OWNER_URL }); await c.connect();
    await c.query("DELETE FROM budget_days WHERE day = $1", [DAY]); await c.end();
  });
  const mk = (cap: number) => dbBudget(APP_URL!, ORG_A, DAY, cap);

  it("grants within the cap and denies beyond it", async () => {
    const b = mk(1000);
    expect(await b.reserve(600)).toBe(true);
    expect(await b.reserve(600)).toBe(false);
    expect(await b.reserve(400)).toBe(true);
    expect(await b.reserve(1)).toBe(false);
  });
  it("never over-grants under concurrency: 20 simultaneous reservations of 100 against a cap of 1000 grant exactly 10", async () => {
    const b = mk(1000);
    const results = await Promise.all(Array.from({ length: 20 }, () => b.reserve(100)));
    expect(results.filter(Boolean)).toHaveLength(10);
    const s = await budgetState(APP_URL!, ORG_A, DAY, 1000);
    expect(s.reserved).toBe(1000);
    expect(s.remaining).toBe(0);
  });
  it("settles actual cost and releases the unused reservation", async () => {
    const b = mk(1000);
    expect(await b.reserve(500)).toBe(true);
    await b.settle(500, 120);
    expect(await budgetState(APP_URL!, ORG_A, DAY, 1000)).toEqual({ reserved: 0, spent: 120, remaining: 880, runs_used: 0 });
    expect(await b.reserve(880)).toBe(true);
    expect(await b.reserve(1)).toBe(false);
  });
  it("denies an estimate larger than the whole cap, and a zero cap denies everything", async () => {
    expect(await mk(100).reserve(101)).toBe(false);
    expect(await mk(0).reserve(1)).toBe(false);
  });
  it("cannot be modified across organisations (RLS)", async () => {
    const other = dbBudget(APP_URL!, "00000000-0000-4000-8000-010000000002", DAY, 1000);
    await mk(1000).reserve(100);
    expect(await other.reserve(1000)).toBe(true); // its own row, not org A's
    expect((await budgetState(APP_URL!, ORG_A, DAY, 1000)).reserved).toBe(100);
  });
});
