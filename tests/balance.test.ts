import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FactIds, buildBalanceFact } from "../core/facts";
import { deriveBalance } from "../core/money";
import { appUrl as _unused, closeAllPools, withScope } from "../db/client";
import { ORG_A, ORG_B, RES, uid } from "../db/ids";
import { makeStore } from "../db/store";
import { APP_URL, HAS_DB, OWNER_URL } from "./helpers";

void _unused;
const ASOF = "2026-11-19";
const leaseOf = (n: number) => uid("lease", n);

const WHO = [
  { name: "asha 101", org: ORG_A, res: RES.asha, lease: leaseOf(1), expected: 1200000 },
  { name: "ravi 102", org: ORG_A, res: RES.ravi, lease: leaseOf(2), expected: 0 },
  { name: "meera 103", org: ORG_A, res: RES.meera, lease: leaseOf(3), expected: 2200000 },
  { name: "imran 201", org: ORG_A, res: RES.imran, lease: leaseOf(4), expected: 1600000 },
  { name: "vikram 202", org: ORG_A, res: RES.vikram, lease: leaseOf(5), expected: 0 },
  { name: "lakshmi 204", org: ORG_A, res: RES.lakshmi, lease: leaseOf(6), expected: 1500000 },
  { name: "sunita 302", org: ORG_A, res: RES.sunita, lease: leaseOf(7), expected: 1735000 },
  { name: "rohan B-11", org: ORG_B, res: RES.rohan, lease: leaseOf(8), expected: 1535000 },
  { name: "priya B-12", org: ORG_B, res: RES.priya, lease: leaseOf(9), expected: 0 },
];

const as = <T>(w: { org: string; res: string }, fn: (s: ReturnType<typeof makeStore>) => Promise<T>) =>
  withScope(APP_URL!, { orgId: w.org, residentId: w.res }, (db) => fn(makeStore(db)));

describe.skipIf(!HAS_DB)("balance: TypeScript derivation vs SQL view", () => {
  afterAll(closeAllPools);

  it.each(WHO)("agrees for $name and matches the expected figure", async (w) => {
    const fact = await as(w, async (s) => {
      const lines = await s.getLedger(w.lease, ASOF);
      return buildBalanceFact(new FactIds(), { residentId: w.res, leaseId: w.lease, asOf: ASOF }, lines, await s.getSqlBalance(w.lease, ASOF));
    });
    expect(fact.crosscheck.agree).toBe(true);
    expect(fact.balance_paise).toBe(w.expected);
    expect(fact.crosscheck.sql_paise).toBe(w.expected);
  });

  it("agrees at every as-of date across the seeded history", async () => {
    for (const w of WHO) {
      for (const d of ["2026-09-30", "2026-10-01", "2026-10-31", "2026-11-02", "2026-11-06", "2026-11-12", "2026-11-19"]) {
        const [lines, sql] = await as(w, async (s) => [await s.getLedger(w.lease, d), await s.getSqlBalance(w.lease, d)] as const);
        expect(deriveBalance(lines, d).balance_paise, `${w.name} ${d}`).toBe(sql);
      }
    }
  });

  it("stores a duplicate UPI reference but never posts or counts it twice (Ravi)", async () => {
    const w = WHO[1]!;
    const { events, lines } = await as(w, async (s) => ({ events: await s.getPaymentEvents(w.lease, ASOF), lines: await s.getLedger(w.lease, ASOF) }));
    const dups = events.filter((e) => e.reference === "UPI-R102-DUP1");
    expect(dups).toHaveLength(2);
    expect(dups.filter((e) => e.is_duplicate)).toHaveLength(1);
    expect(dups.filter((e) => e.posted)).toHaveLength(1);
    expect(lines.filter((l) => l.external_reference === "UPI-R102-DUP1")).toHaveLength(1);
    expect(deriveBalance(lines, ASOF).balance_paise).toBe(0);
  });

  it("keeps pending and failed payments out of the ledger (Imran)", async () => {
    const w = WHO[3]!;
    const { events, lines } = await as(w, async (s) => ({ events: await s.getPaymentEvents(w.lease, ASOF), lines: await s.getLedger(w.lease, ASOF) }));
    const pending = events.find((e) => e.state === "pending")!;
    const failed = events.find((e) => e.state === "failed")!;
    expect([pending.posted, failed.posted]).toEqual([false, false]);
    expect(lines.some((l) => l.external_reference === pending.reference || l.external_reference === failed.reference)).toBe(false);
    expect(deriveBalance(lines, ASOF).balance_paise).toBe(1600000);
  });

  it("models a reversal as a new entry that leaves the original payment untouched (Lakshmi)", async () => {
    const w = WHO[5]!;
    const { events, lines } = await as(w, async (s) => ({ events: await s.getPaymentEvents(w.lease, ASOF), lines: await s.getLedger(w.lease, ASOF) }));
    const pay = lines.find((l) => l.entry_type === "payment" && l.external_reference === "UPI-L204-5002")!;
    const rev = lines.find((l) => l.entry_type === "reversal")!;
    expect(pay.amount_paise).toBe(-500000);
    expect(rev.amount_paise).toBe(500000);
    const ev = events.find((e) => e.reference === "UPI-L204-5002")!;
    expect([ev.posted, ev.reversed]).toEqual([true, true]);
    expect(deriveBalance(lines, "2026-11-04").balance_paise).toBe(1000000 + 0); // payment applied, reversal not yet
    expect(deriveBalance(lines, ASOF).balance_paise).toBe(1500000);
  });
});

describe.skipIf(!HAS_DB)("lease versions and clause retrieval", () => {
  afterAll(closeAllPools);
  const clauses = (w: (typeof WHO)[number], q: string[], d: string) => as(w, (s) => s.searchClauses(w.lease, q, d));

  it("returns only the version in force on the date (Meera pets)", async () => {
    const meera = WHO[2]!;
    const now = await clauses(meera, ["cat pets keep"], "2026-11-19");
    expect(now.map((c) => [c.number, c.version])).toEqual([[3, 2]]);
    expect(now[0]!.amendment_ref).toBe("AMD-2026-07");
    expect(now[0]!.text).toContain("One cat is permitted");
    const before = await clauses(meera, ["cat pets keep"], "2026-06-30");
    expect(before.map((c) => [c.number, c.version])).toEqual([[3, 1]]);
    expect((await clauses(meera, ["cat pets keep"], "2026-07-01")).map((c) => c.version)).toEqual([2]);
  });

  it("switches an amended due date exactly on its effective date (Lakshmi)", async () => {
    const l = WHO[5]!;
    expect((await clauses(l, ["rent due date"], "2026-09-30"))[0]!.text).toContain("1st of each month");
    expect((await clauses(l, ["rent due date"], "2026-10-01"))[0]!.text).toContain("5th of each month");
  });

  it("returns both conflicting clauses so the router can send them to review (Vikram)", async () => {
    const found = await clauses(WHO[4]!, ["guests overnight stay nights visitors"], ASOF);
    expect(found.map((c) => c.number).sort((a, b) => a - b)).toEqual([7, 12]);
  });

  it("finds the maintenance clause for a dripping tap and nothing for an unrelated topic", async () => {
    expect((await clauses(WHO[1]!, ["dripping tap leak repair"], ASOF))[0]!.number).toBe(4);
    expect(await clauses(WHO[6]!, ["paint bedroom wall colour"], ASOF)).toEqual([]);
  });
});

describe.skipIf(!HAS_DB)("database constraints (owner connection)", () => {
  let c: pg.Client;
  beforeAll(async () => { c = new pg.Client({ connectionString: OWNER_URL }); await c.connect(); });
  afterAll(async () => { await c.end(); });
  const fails = async (sql: string, params: unknown[] = []) => {
    await c.query("BEGIN");
    try { await c.query(sql, params); await c.query("ROLLBACK"); return null; }
    catch (e) { await c.query("ROLLBACK"); return (e as Error).message; }
  };
  const ledgerInsert = (over: Record<string, unknown>): [string, unknown[]] => {
    const r = { id: uid("ledger", 9000), org: ORG_A, res: RES.asha, lease: leaseOf(1), type: "charge", amt: 100, key: "t:1", ev: null, rev: null, cur: "INR", ...over };
    return [`INSERT INTO ledger_entries(id,organization_id,resident_id,lease_id,entry_type,amount_paise,currency,description,idempotency_key,occurred_on,source_event_id,reverses_entry_id) VALUES ($1,$2,$3,$4,$5,$6,$7,'t',$8,'2026-11-19',$9,$10)`,
      [r.id, r.org, r.res, r.lease, r.type, r.amt, r.cur, r.key, r.ev, r.rev]];
  };

  it("ledger and payment events are append-only", async () => {
    expect(await fails("UPDATE ledger_entries SET amount_paise = 1")).toMatch(/append-only/);
    expect(await fails("DELETE FROM ledger_entries")).toMatch(/append-only/);
    expect(await fails("TRUNCATE ledger_entries")).toMatch(/append-only/);
    expect(await fails("UPDATE payment_events SET state = 'settled'")).toMatch(/append-only/);
    expect(await fails("DELETE FROM payment_events")).toMatch(/append-only/);
  });
  it("eval results are written once, never edited", async () => {
    // Insert a row inside a transaction so the row-level trigger has something to act on, then try to change it.
    await c.query("BEGIN");
    let updateErr = "", deleteErr = "";
    try {
      await c.query(`INSERT INTO eval_runs(id,organization_id,prompt_version,mode,summary,results) VALUES ($1,$2,'t','mock','{}','[]')`, [uid("ledger", 9100), ORG_A]);
      await c.query("SAVEPOINT s1");
      try { await c.query("UPDATE eval_runs SET prompt_version = 'x'"); } catch (e) { updateErr = (e as Error).message; await c.query("ROLLBACK TO s1"); }
      try { await c.query("DELETE FROM eval_runs"); } catch (e) { deleteErr = (e as Error).message; await c.query("ROLLBACK TO s1"); }
    } finally { await c.query("ROLLBACK"); }
    expect(updateErr).toMatch(/append-only/);
    expect(deleteErr).toMatch(/append-only/);
  });
  it("rejects entries with the wrong sign, a non-INR currency and a duplicate idempotency key", async () => {
    expect(await fails(...ledgerInsert({ type: "charge", amt: -100 }))).toMatch(/check constraint/);
    expect(await fails(...ledgerInsert({ cur: "USD" }))).toMatch(/check constraint/);
    expect(await fails(...ledgerInsert({ key: `seed:asha:charge:2026-11` }))).toMatch(/unique|duplicate key/);
  });
  it("stores integer paise only", async () => {
    expect(await fails(...ledgerInsert({ amt: "1.5" }))).toMatch(/invalid input syntax for type bigint/);
  });
  it("posts a settled event once; pending, failed and duplicate events cannot post", async () => {
    const ev = async (where: string) => (await c.query(`SELECT id, lease_id, amount_paise FROM payment_events WHERE ${where} LIMIT 1`)).rows[0];
    const settledPosted = await ev("reference = 'UPI-A101-5521'");
    expect(await fails(...ledgerInsert({ type: "payment", amt: -800000, ev: settledPosted.id, key: "t:again" }))).toMatch(/unique|duplicate key/);
    const pend = await ev("reference = 'UPI-I201-PEND'");
    expect(await fails(...ledgerInsert({ type: "payment", res: RES.imran, lease: leaseOf(4), amt: -800000, ev: pend.id, key: "t:p" }))).toMatch(/only settled events may post/);
    const fail = await ev("reference = 'UPI-I201-FAIL'");
    expect(await fails(...ledgerInsert({ type: "payment", res: RES.imran, lease: leaseOf(4), amt: -800000, ev: fail.id, key: "t:f" }))).toMatch(/only settled events may post/);
    const dup = (await c.query("SELECT id, lease_id FROM payment_events WHERE is_duplicate LIMIT 1")).rows[0];
    expect(await fails(...ledgerInsert({ type: "payment", res: RES.ravi, lease: leaseOf(2), amt: -1800000, ev: dup.id, key: "t:d" }))).toMatch(/duplicate event may not post/);
  });
  it("a reversal must negate one payment, exactly once", async () => {
    const pay = (await c.query("SELECT id FROM ledger_entries WHERE external_reference = 'UPI-A101-5521'")).rows[0];
    expect(await fails(...ledgerInsert({ type: "reversal", amt: 100, rev: pay.id, key: "t:r1" }))).toMatch(/reversal must negate/);
    expect(await fails(...ledgerInsert({ type: "reversal", amt: 800000, rev: pay.id, key: "t:r2" }))).toBeNull(); // valid, rolled back
    const already = (await c.query("SELECT reverses_entry_id AS id FROM ledger_entries WHERE reverses_entry_id IS NOT NULL LIMIT 1")).rows[0];
    expect(await fails(...ledgerInsert({ type: "reversal", res: RES.lakshmi, lease: leaseOf(6), amt: 500000, rev: already.id, key: "t:r3" }))).toMatch(/unique|duplicate key/);
  });
  it("rejects overlapping versions of the same clause", async () => {
    const msg = await fails(
      `INSERT INTO lease_clauses(id,organization_id,resident_id,lease_id,number,heading,text,version,effective_from,effective_to)
       VALUES ($1,$2,$3,$4,3,'Pets','overlap',3,'2026-08-01',NULL)`, [uid("clause", 9000), ORG_A, RES.meera, leaseOf(3)]);
    expect(msg).toMatch(/conflicting key value violates exclusion constraint|exclusion/);
  });
  it("allows only one active lease per resident", async () => {
    expect(await fails(`INSERT INTO leases(id,organization_id,resident_id,rent_paise,due_day,grace_days,late_fee_rule,deposit_paise,start_date) VALUES ($1,$2,$3,100,1,1,'x',0,'2026-01-01')`,
      [uid("lease", 9000), ORG_A, RES.asha])).toMatch(/unique|duplicate key/);
  });
});
