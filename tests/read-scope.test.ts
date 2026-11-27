import { afterAll, describe, expect, it } from "vitest";
import { closeAllPools, readOnlyScope, withScope } from "../db/client";
import { ORG_A, RES } from "../db/ids";
import { APP_URL, HAS_DB } from "./helpers";

describe("readOnlyScope", () => {
  it("is true only for the organisation-wide inbox view, which row level security makes read-only", () => {
    expect(readOnlyScope({ orgId: ORG_A, view: "inbox" })).toBe(true);
    expect(readOnlyScope({ orgId: ORG_A, view: "inbox", residentId: RES.asha })).toBe(false);
    expect(readOnlyScope({ orgId: ORG_A, residentId: RES.asha })).toBe(false);
    expect(readOnlyScope({ orgId: ORG_A })).toBe(false);
  });
});

describe.skipIf(!HAS_DB)("read-only scopes return before COMMIT without leaking scope", () => {
  afterAll(async () => { await closeAllPools(); });
  it("a burst of inbox reads followed by an unscoped query on the same pool sees no scope and no open transaction", async () => {
    const reads = await Promise.all(Array.from({ length: 40 }, () => withScope(APP_URL!, { orgId: ORG_A, view: "inbox" }, async (db) => (await db.query("SELECT count(*)::int AS n FROM messages")).rows[0]!.n as number)));
    expect(new Set(reads).size).toBe(1); expect(reads[0]).toBeGreaterThan(0);
    // The connections were released only after COMMIT: the next scope starts clean and a fail-closed query sees nothing.
    const after = await withScope(APP_URL!, { orgId: ORG_A, residentId: RES.asha }, async (db) => ({
      view: (await db.query("SELECT current_setting('app.view', true) AS v")).rows[0]!.v,
      inTx: (await db.query("SELECT now() = statement_timestamp() AS fresh")).rows[0]!.fresh,
    }));
    expect(after.view === "" || after.view === null).toBe(true);
    expect(after.inTx).toBe(false); // inside our own transaction now() is the transaction start, not this statement's time
  });
});
