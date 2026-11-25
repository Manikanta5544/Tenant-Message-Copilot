import { afterAll, describe, expect, it } from "vitest";
import { MockProvider } from "../core/providers/mock";
import { memoStore } from "../core/prefetch";
import { closeAllPools } from "../db/client";
import { runMessage } from "../evals/harness";
import { loadCases } from "../evals/run";
import type { EvidenceStore } from "../core/types";
import { APP_URL, HAS_DB, OWNER_URL } from "./helpers";

const AS_OF = "2026-11-19";
const strip = (o: Awaited<ReturnType<typeof runMessage>>["output"]) => JSON.stringify({ ...o, usage: undefined });

describe("memoStore", () => {
  it("reads each thing once, replays a failure to the caller, and never warms model-dependent searches", async () => {
    let leases = 0, searches = 0; const calls: string[] = [];
    const inner = {
      getLease: async () => { leases++; return { id: "L1" } as never; }, getLedger: async () => [], getSqlBalance: async () => 0,
      getBalanceSnapshot: async () => { calls.push("snap"); return { lines: [], sql_balance_paise: 0 }; },
      getPaymentEvents: async () => { calls.push("pay"); throw new Error("db down"); },
      searchClauses: async () => { searches++; return []; },
    } as unknown as EvidenceStore;
    const m = memoStore(inner);
    await m.warm(AS_OF);
    await m.getLease(AS_OF); await m.getBalanceSnapshot("L1", AS_OF);
    await expect(m.getPaymentEvents("L1", AS_OF)).rejects.toThrow("db down");
    await m.searchClauses("L1", ["a"], AS_OF); await m.searchClauses("L1", ["a"], AS_OF);
    expect(leases).toBe(1); expect(calls).toEqual(["snap", "pay"]); expect(searches).toBe(2); expect(m.hits).toBe(3);
  });
});

describe.skipIf(!HAS_DB)("evidence prefetch changes timing, never results", () => {
  afterAll(closeAllPools);
  it("every golden case (critical and extended) gives byte-identical output, facts, verification and route with prefetch on and off, in both orders", async () => {
    const cases = loadCases(2);
    expect(cases.length).toBeGreaterThanOrEqual(20);
    for (const c of cases) {
      const run = (prefetch: boolean) => runMessage({ appUrl: APP_URL!, ownerUrl: OWNER_URL!, provider: new MockProvider(), unit: c.unit, org: c.org, message: c.message, asOf: AS_OF, prefetch });
      const on1 = await run(true), off = await run(false), on2 = await run(true);
      expect(strip(on1.output), `${c.id}: on vs off`).toBe(strip(off.output));
      expect(strip(off.output), `${c.id}: off vs on (second order)`).toBe(strip(on2.output));
      expect(on1.events.map((e) => [e.stage, e.outcome]), c.id).toEqual(off.events.map((e) => [e.stage, e.outcome]));
    }
  }, 120_000);
});
