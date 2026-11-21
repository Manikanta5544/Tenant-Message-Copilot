// Server configuration read from the environment. Core functions take dates as arguments;
// only this module and the route handlers read the environment.
export type ProviderMode = "live" | "replay" | "mock";

export function demoAsOf(env = process.env): string {
  const v = env.DEMO_AS_OF_DATE ?? "2026-11-19";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error("DEMO_AS_OF_DATE must be YYYY-MM-DD");
  return v;
}

export function providerMode(env = process.env): ProviderMode {
  const v = env.PROVIDER_MODE ?? (env.ANTHROPIC_API_KEY || env.LLM_API_KEY ? "live" : "replay");
  if (v !== "live" && v !== "replay" && v !== "mock") throw new Error("PROVIDER_MODE must be live, replay or mock");
  return v;
}

/** Daily demo cap in micro-USD (1 USD = 1,000,000). */
export function dailyBudgetMicroUsd(env = process.env): number {
  const usd = Number(env.DEMO_DAILY_BUDGET_USD ?? "2");
  if (!Number.isFinite(usd) || usd < 0) throw new Error("DEMO_DAILY_BUDGET_USD must be a non-negative number");
  return Math.round(usd * 1_000_000);
}

/** The real UTC date. Budgets and run caps reset on it; DEMO_AS_OF_DATE only drives lease and ledger logic. */
export const budgetDay = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

const intEnv = (v: string | undefined, d: number) => { const n = Number(v ?? d); if (!Number.isInteger(n) || n < 0) throw new Error("limit variables must be non-negative integers"); return n; };
/** Hard daily cap on runs (protects free-tier quota). */
export const maxRunsPerDay = (env = process.env) => intEnv(env.DEMO_MAX_RUNS_PER_DAY, 150);
export const maxRunsPerHour = (env = process.env) => intEnv(env.RATE_LIMIT_PER_HOUR, 20);
export const maxMessagesPerHour = (env = process.env) => intEnv(env.MESSAGE_LIMIT_PER_HOUR, 10);
export const maxRunsPerVisitorPerDay = (env = process.env) => intEnv(env.RATE_LIMIT_PER_DAY, 40);
