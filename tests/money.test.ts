import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { OpenAICompatProvider } from "../core/providers/openai-compat";
import { MockProvider } from "../core/providers/mock";
import { runMessage } from "../evals/harness";
import { budgetState, dbBudget } from "../db/budget";
import { closeAllPools } from "../db/client";
import { ORG_A } from "../db/ids";
import { APP_URL, HAS_DB, OWNER_URL } from "./helpers";

const DAY = "2030-02-02";
// A live provider on the default Groq models, with every model call delegated to the mock so no network is needed.
const live = () => {
  const real = new OpenAICompatProvider({ baseUrl: "http://127.0.0.1:1", apiKey: "k", models: { triage: "openai/gpt-oss-20b", draft: "openai/gpt-oss-120b", check: "openai/gpt-oss-20b" } });
  const mock = new MockProvider({ priced: true });
  return Object.assign(Object.create(mock), { worstCaseCostMicroUsd: () => real.worstCaseCostMicroUsd() }) as MockProvider;
};

describe("live-provider money", () => {
  it("the worst-case reservation of the default live models is non-zero (it was 0 before prices shipped)", () => {
    expect(live().worstCaseCostMicroUsd()).toBeGreaterThan(0);
  });
});

describe.skipIf(!HAS_DB)("the daily budget depletes with a live-priced provider", () => {
  afterAll(closeAllPools);
  beforeEach(async () => {
    const c = new pg.Client({ connectionString: OWNER_URL }); await c.connect();
    await c.query("DELETE FROM budget_days WHERE day = $1", [DAY]); await c.end();
  });
  it("runs spend recorded cost, then the next run gets the existing budget_exhausted response", async () => {
    const est = live().worstCaseCostMicroUsd();
    const budget = dbBudget(APP_URL!, ORG_A, DAY, est * 2 + 10); // room for two reservations
    const run = (msg: string) => runMessage({ appUrl: APP_URL!, ownerUrl: OWNER_URL!, provider: live(), unit: "102", message: msg, asOf: "2026-11-19", budget });
    const a = await run("The kitchen tap has been dripping since Monday.");
    expect(a.output.usage.cost_micro_usd).toBeGreaterThan(0);
    expect(a.events.filter((e) => e.stage === "triage").every((e) => (e.cost_micro_usd ?? 0) > 0)).toBe(true);
    const s1 = await budgetState(APP_URL!, ORG_A, DAY, est * 2 + 10);
    expect(s1.spent).toBe(Math.min(a.output.usage.cost_micro_usd, est)); // settle never charges more than the reservation
    // Reservations that are not settled yet (concurrent runs) also count: take the whole remainder, then a run must be denied.
    expect(await budget.reserve(s1.remaining)).toBe(true);
    const denied = await run("What is my balance?");
    expect(denied.output.banner).toBe("budget_exhausted");
  });
});
