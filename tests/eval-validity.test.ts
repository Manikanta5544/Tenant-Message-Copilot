import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { MockProvider } from "../core/providers/mock";
import { closeAllPools } from "../db/client";
import { runEval } from "../evals/run";
import { validity, type CaseResult } from "../evals/score";
import { APP_URL, HAS_DB, OWNER_URL } from "./helpers";

const row = (mode: string): CaseResult => ({ id: "x", category: "c", unit: "u", route_expected: "draft_ready", route_actual: "draft_ready", language_expected: "English", language_actual: "English", mode, draft_source: "model", pass: true, failures: [], latency_ms: 1, cost_micro_usd: 0, tokens_in: 0, tokens_out: 0 });

describe("eval validity rule", () => {
  it("10% fallbacks or errors is still valid; more is invalid", () => {
    const ok = [...Array(9).fill(0).map(() => row("mock")), row("fallback")];
    expect(validity(ok).valid).toBe(true);
    expect(validity([...ok, row("error")]).valid).toBe(false);
    expect(validity([]).valid).toBe(false);
  });
});

describe.skipIf(!HAS_DB)("a run in which the provider fails every call", () => {
  afterAll(closeAllPools);
  it("is invalid, fails the gate and saves nothing", async () => {
    const c = new pg.Client({ connectionString: OWNER_URL }); await c.connect();
    const before = (await c.query("SELECT count(*)::int AS n FROM eval_runs")).rows[0].n;
    const r = await runEval({ mode: "mock", tier: 1, appUrl: APP_URL!, ownerUrl: OWNER_URL!, save: true, asOf: "2026-11-19", provider: new MockProvider({ fail: { classify: "unavailable" } }) });
    expect(r.summary.validity.valid).toBe(false);
    expect(r.gate.ok).toBe(false);
    expect(r.id).toBeNull();
    expect((await c.query("SELECT count(*)::int AS n FROM eval_runs")).rows[0].n).toBe(before);
    await c.end();
  });
});
