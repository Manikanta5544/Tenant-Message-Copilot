// Two-scope isolation, enforced by the database. Runs against the local test database and, when
// DATABASE_URL_APP points at Neon's pooled endpoint, against that too (otherwise: unverified).
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { closeAllPools, withScope, type Queryable } from "../db/client";
import { ORG_A, ORG_B, RES, uid } from "../db/ids";
import { makeStore } from "../db/store";
import { APP_URL, HAS_DB, OWNER_URL } from "./helpers";

const neonUrl = process.env.DATABASE_URL_APP && /\.neon\.tech/.test(process.env.DATABASE_URL_APP) ? process.env.DATABASE_URL_APP : undefined;
const TARGETS: [string, string | undefined][] = [["local postgres", HAS_DB ? APP_URL : undefined], ["neon pooled connection", neonUrl]];

const STRICT_TABLES = ["leases", "lease_clauses", "payment_events", "ledger_entries", "lease_balance", "messages", "runs", "trace_events"];
const ALL_TABLES = ["organizations", "residents", "eval_runs", "budget_days", ...STRICT_TABLES];
const count = async (db: Queryable, t: string) => Number((await db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0]!.n);

for (const [label, url] of TARGETS) {
  // A skipped suite must be impossible to miss: say what was not verified and the exact command that verifies it.
  if (!url) console.warn(`\n[SKIPPED, UNVERIFIED] isolation on ${label}: ${label.startsWith("neon") ? "DATABASE_URL_APP is not a *.neon.tech URL. Verify with: TEST_DATABASE_URL_OWNER=<direct url> TEST_DATABASE_URL_APP=<pooled url> npm run verify:neon" : "no local test database. Start Postgres 16 and set TEST_DATABASE_URL_OWNER and TEST_DATABASE_URL_APP"}\n`);
  describe.skipIf(!url)(`isolation on ${label}`, () => {
    afterAll(closeAllPools);
    const scoped = <T>(s: Parameters<typeof withScope>[1], fn: (db: Queryable) => Promise<T>) => withScope(url!, s, fn);

    it("organisation A sees none of organisation B's rows, and the reverse", async () => {
      for (const [org, res, other] of [[ORG_A, RES.asha, RES.rohan], [ORG_B, RES.rohan, RES.asha]] as const) {
        await scoped({ orgId: org, residentId: res }, async (db) => {
          for (const t of ["leases", "ledger_entries", "payment_events", "messages", "residents"]) {
            const col = t === "residents" ? "id" : "resident_id";
            expect(Number((await db.query(`SELECT count(*)::int AS n FROM ${t} WHERE ${col} = $1`, [other])).rows[0]!.n), `${t}`).toBe(0);
          }
          expect(await count(db, "organizations")).toBe(1);
        });
      }
    });

    it("a run for one resident sees nothing of a sibling in the same organisation", async () => {
      await scoped({ orgId: ORG_A, residentId: RES.vikram }, async (db) => {
        for (const sibling of [RES.sunita, RES.asha, RES.ravi]) {
          for (const t of ["leases", "lease_clauses", "payment_events", "ledger_entries", "messages", "lease_balance"]) {
            expect(Number((await db.query(`SELECT count(*)::int AS n FROM ${t} WHERE resident_id = $1`, [sibling])).rows[0]!.n), `${t}`).toBe(0);
          }
        }
        expect(await count(db, "residents")).toBe(1);
      });
    });

    it("Scenario 5: nothing of apartment 302 reaches resident 202, even through tools handed 302's lease id", async () => {
      const sunitaLease = uid("lease", 7);
      await scoped({ orgId: ORG_A, residentId: RES.vikram }, async (db) => {
        const s = makeStore(db);
        expect(await s.getLedger(sunitaLease, "2026-11-19")).toEqual([]);
        expect(await s.getSqlBalance(sunitaLease, "2026-11-19")).toBe(0);
        expect(await s.getPaymentEvents(sunitaLease, "2026-11-19")).toEqual([]);
        expect(await s.searchClauses(sunitaLease, ["rent late fee deposit"], "2026-11-19")).toEqual([]);
        // Whole-table sweep: the distinctive balance and the neighbour's identity appear in no table.
        for (const t of ALL_TABLES) {
          const dump = JSON.stringify((await db.query(`SELECT * FROM ${t}`)).rows);
          for (const needle of ["1735000", "17350", "17,350", "Sunita", "Rao", "UPI-S302"]) expect(dump.includes(needle), `${t} leaked ${needle}`).toBe(false);
        }
      });
    });

    it("fails closed: an unset or empty scope returns no rows and raises no error", async () => {
      await scoped({ orgId: null, residentId: null }, async (db) => { for (const t of ALL_TABLES) expect(await count(db, t), t).toBe(0); });
      await scoped({ orgId: ORG_A, residentId: null }, async (db) => { for (const t of STRICT_TABLES.filter((x) => x !== "messages" && x !== "runs" && x !== "trace_events")) expect(await count(db, t), t).toBe(0); });
      await scoped({ orgId: null, residentId: RES.asha }, async (db) => { for (const t of ALL_TABLES) expect(await count(db, t), t).toBe(0); });
    });

    it("the transaction-local scope does not leak to the next statement or the next transaction on a pooled connection", async () => {
      const raw = new pg.Pool({ connectionString: url, max: 1 }); // one physical connection, reused
      try {
        const c = await raw.connect();
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.org_id', $1, true), set_config('app.resident_id', $2, true)", [ORG_A, RES.asha]);
        expect(Number((await c.query("SELECT count(*)::int AS n FROM ledger_entries")).rows[0].n)).toBeGreaterThan(0);
        await c.query("COMMIT");
        // Same connection, no scope set: the setting is back to an empty string. Must be zero rows, not an error.
        expect(Number((await c.query("SELECT count(*)::int AS n FROM ledger_entries")).rows[0].n)).toBe(0);
        expect(Number((await c.query("SELECT count(*)::int AS n FROM residents")).rows[0].n)).toBe(0);
        c.release();
      } finally { await raw.end(); }
    });

    it("the inbox view is read-only, organisation-wide, and limited to the four inbox tables", async () => {
      await scoped({ orgId: ORG_A, view: "inbox" }, async (db) => {
        expect(await count(db, "residents")).toBe(7);
        expect(await count(db, "messages")).toBeGreaterThanOrEqual(19);
        for (const t of ["leases", "lease_clauses", "payment_events", "ledger_entries", "lease_balance"]) expect(await count(db, t), t).toBe(0);
        const names = (await db.query("SELECT name FROM residents")).rows.map((r) => r.name);
        expect(names).not.toContain("Rohan Mehta");
      });
      // The inbox view cannot write.
      await expect(scoped({ orgId: ORG_A, view: "inbox" }, (db) =>
        db.query("INSERT INTO messages(id,organization_id,resident_id,text,source) VALUES ($1,$2,$3,'x','live')", [uid("message", 9001), ORG_A, RES.asha]))).rejects.toThrow(/row-level security/);
    });

    it("writes need the resident scope: a message cannot be created for a different resident", async () => {
      const insert = (res: string) => (db: Queryable) =>
        db.query("INSERT INTO messages(id,organization_id,resident_id,text,source) VALUES ($1,$2,$3,'probe','live')", [uid("message", 9002), ORG_A, res]);
      await expect(scoped({ orgId: ORG_A, residentId: RES.asha }, insert(RES.ravi))).rejects.toThrow(/row-level security/);
      await expect(scoped({ orgId: ORG_B, residentId: RES.rohan }, insert(RES.rohan))).rejects.toThrow(/row-level security|violates foreign key/); // org mismatch
      // A permitted insert succeeds; roll it back so the data stays unchanged.
      await expect(scoped({ orgId: ORG_A, residentId: RES.asha }, async (db) => { await insert(RES.asha)(db); throw new Error("rollback"); })).rejects.toThrow("rollback");
    });

    it("the runtime role cannot bypass RLS and has no destructive privileges", async () => {
      await scoped({ orgId: ORG_A, residentId: RES.asha }, async (db) => {
        const r = (await db.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")).rows[0]!;
        expect([r.rolsuper, r.rolbypassrls]).toEqual([false, false]);
      });
      for (const sql of ["DELETE FROM ledger_entries", "UPDATE ledger_entries SET amount_paise = 1", "DELETE FROM runs", "TRUNCATE messages",
        "INSERT INTO ledger_entries(id) VALUES (gen_random_uuid())", "UPDATE leases SET rent_paise = 1", "ALTER TABLE leases DISABLE ROW LEVEL SECURITY"]) {
        await expect(scoped({ orgId: ORG_A, residentId: RES.asha }, (db) => db.query(sql)), sql).rejects.toThrow(/permission denied|must be owner/);
      }
    });
  });
}

describe.skipIf(!HAS_DB)("row level security is forced for table owners too", () => {
  it("every table has RLS enabled and forced", async () => {
    const c = new pg.Client({ connectionString: OWNER_URL });
    await c.connect();
    const r = await c.query(`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname <> 'schema_migrations'`);
    await c.end();
    expect(r.rows.length).toBe(12); // the 11 original tables plus review_actions (0007)
    expect(r.rows.map((x: { relname: string }) => x.relname)).toContain("review_actions");
    for (const row of r.rows) expect([row.relname, row.relrowsecurity, row.relforcerowsecurity]).toEqual([row.relname, true, true]);
  });
});

if (!neonUrl) console.warn("UNVERIFIED: no Neon pooled DATABASE_URL_APP configured; isolation was not run against Neon.");
