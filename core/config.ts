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

/** Per-network (client address) ceilings. A script that discards its cookie gets a new visitor every request but not a new address. */
export const maxRunsPerIpPerHour = (env?: RawEnv) => E(env).RATE_LIMIT_PER_IP_PER_HOUR || 3 * maxRunsPerHour(env);
/** One address may use at most a quarter of the demo-wide daily run cap (never less than a single visitor's own daily limit), so one script cannot starve everyone. */
export const maxRunsPerIpPerDay = (env?: RawEnv) => E(env).RATE_LIMIT_PER_IP_PER_DAY || Math.max(maxRunsPerVisitorPerDay(env), Math.ceil(maxRunsPerDay(env) / 4));

/** Seconds until the next UTC midnight, when the demo-wide daily caps reset. Capped at one day. */
export const secondsToUtcMidnight = (now: Date = new Date()): number => Math.min(86_400, Math.max(1, Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 1000)));
