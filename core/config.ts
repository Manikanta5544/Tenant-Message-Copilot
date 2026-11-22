// Server configuration derived from the validated environment (core/env.ts). Core functions take dates as
// arguments; only this module and the route handlers read configuration.
import { getEnv, parseEnv, type RawEnv } from "./env";
export type ProviderMode = "live" | "replay" | "mock";

// Helpers accept an explicit env object (tests); with none they use the process-wide validated environment.
const E = (env?: RawEnv) => (env ? parseEnv(env, { crossCheck: false }) : getEnv());

export const demoAsOf = (env?: RawEnv): string => E(env).DEMO_AS_OF_DATE;
export const providerMode = (env?: RawEnv): ProviderMode => E(env).PROVIDER_MODE;

/** Daily demo cap in micro-USD (1 USD = 1,000,000). */
export const dailyBudgetMicroUsd = (env?: RawEnv): number => Math.round(E(env).DEMO_DAILY_BUDGET_USD * 1_000_000);

/** The real UTC date. Budgets and run caps reset on it; DEMO_AS_OF_DATE only drives lease and ledger logic. */
export const budgetDay = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

/** Hard daily cap on runs (protects free-tier quota). */
export const maxRunsPerDay = (env?: RawEnv) => E(env).DEMO_MAX_RUNS_PER_DAY;
export const maxRunsPerHour = (env?: RawEnv) => E(env).RATE_LIMIT_PER_HOUR;
export const maxMessagesPerHour = (env?: RawEnv) => E(env).MESSAGE_LIMIT_PER_HOUR;
export const maxRunsPerVisitorPerDay = (env?: RawEnv) => E(env).RATE_LIMIT_PER_DAY;
