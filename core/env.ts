// Single source of truth for configuration (decision D6). Every environment variable the runtime reads
// is declared and validated here; other modules call getEnv() or the helpers in core/config.ts.
// Validation is lazy (first use, not import) so `next build` works without secrets, and a bad production
// config produces a readable error and a "not ready" state instead of a crash loop.
import { z } from "zod";

export type RawEnv = Record<string, string | undefined>;
/** The only place the process environment is read. */
export const rawEnv = (): RawEnv => process.env;

/** Empty strings in .env files mean "unset". */
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const str = () => z.preprocess(blank, z.string().optional());
const int = (d: number, min = 0, max = 1_000_000) =>
  z.preprocess(blank, z.coerce.number().int().min(min).max(max).default(d));
const num = (d: number, min = 0, max = 1_000_000) =>
  z.preprocess(blank, z.coerce.number().min(min).max(max).default(d));
const flag = z.preprocess(blank, z.enum(["0", "1", "true", "false", "yes", "no"]).optional()).transform((v) => v === "1" || v === "true" || v === "yes");

const schema = z.object({
  NODE_ENV: z.preprocess(blank, z.enum(["development", "test", "production"]).default("development")),
  VERCEL: str(),
  TRUST_PROXY: flag,
  /** Trusted proxies in front of the app; the client address is the Nth entry from the right of x-forwarded-for. */
  TRUSTED_PROXY_HOPS: int(1, 1, 10),
  /** Adds `preload` to Strict-Transport-Security. Off by default: preload is hard to undo and covers every subdomain. */
  HSTS_PRELOAD: flag,

  PROVIDER_MODE: z.preprocess(blank, z.enum(["live", "replay", "mock"]).optional()),
  LLM_PROVIDER: z.preprocess(blank, z.enum(["openai_compat", "anthropic"]).default("openai_compat")),
  LLM_API_KEY: str(),
  ANTHROPIC_API_KEY: str(),
  LLM_BASE_URL: z.preprocess(blank, z.url().default("https://api.groq.com/openai/v1")),
  LLM_MODEL: str(),
  LLM_MODEL_FAST: str(),
  LLM_MODEL_TRIAGE: str(),
  LLM_MODEL_DRAFT: str(),
  LLM_MODEL_CHECK: str(),
  LLM_REASONING_EFFORT: z.preprocess(blank, z.enum(["low", "medium", "high"]).optional()),
  LLM_OUTPUT_HEADROOM: int(0, 0, 32_000),
  /** Reasoning effort for the short triage and semantic-check calls only; the draft keeps LLM_REASONING_EFFORT. */
  LLM_REASONING_EFFORT_FAST: z.preprocess(blank, z.enum(["low", "medium", "high"]).optional()),
  /** Model calls in flight per server instance, and how long a call may wait for a slot before the honest "busy" fallback. */
  LLM_MAX_CONCURRENCY: int(4, 1, 64),
  LLM_QUEUE_WAIT_MS: int(8000, 0, 60_000),
  /** Live-stream (SSE) connection caps: per client IP, and per server instance. Beyond them the stream answers 429 and the browser polls instead. */
  SSE_MAX_PER_IP: int(4, 1, 50),
  SSE_MAX_GLOBAL: int(200, 1, 5000),
  LLM_JSON_MODE: z.preprocess(blank, z.enum(["true", "false"]).default("true")),
  LLM_PRICES_JSON: str(),

  DEMO_AS_OF_DATE: z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD").default("2026-11-19")),
  DEMO_DAILY_BUDGET_USD: num(2, 0, 10_000),
  DEMO_MAX_RUNS_PER_DAY: int(150),
  RATE_LIMIT_PER_HOUR: int(20),
  RATE_LIMIT_PER_DAY: int(40),
  MESSAGE_LIMIT_PER_HOUR: int(10),
  EVAL_PACE_MS: int(2000, 0, 60_000),

  REPO_URL: z.preprocess(blank, z.url().optional()),
  VISITOR_SALT: str(),
  DATABASE_URL_APP: str(),
  DATABASE_URL_OWNER: str(),
  APP_ROLE_PASSWORD: str(),
});

export type Env = Omit<z.infer<typeof schema>, "PROVIDER_MODE"> & { PROVIDER_MODE: "live" | "replay" | "mock" };

export class EnvError extends Error {
  constructor(public problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "EnvError";
  }
}

const WEAK_SALTS = new Set(["change-me", "demo", "local-dev-salt"]);

/** Parses and cross-checks an environment object. Throws EnvError listing every problem with a fix hint. */
export function parseEnv(raw: RawEnv = rawEnv(), opts: { crossCheck?: boolean } = {}): Env {
  const r = schema.safeParse(raw);
  if (!r.success) {
    throw new EnvError(r.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`));
  }
  const e = r.data;
  const prod = e.NODE_ENV === "production";
  const hasKey = e.LLM_PROVIDER === "anthropic" ? !!e.ANTHROPIC_API_KEY : !!e.LLM_API_KEY;
  // Outside production the historical default holds: a key means live, otherwise replay. In production the default is live.
  const mode = e.PROVIDER_MODE ?? (prod ? "live" : hasKey ? "live" : "replay");
  if (opts.crossCheck === false) return { ...e, PROVIDER_MODE: mode };
  const problems: string[] = [];
  if (e.LLM_PRICES_JSON) { try { JSON.parse(e.LLM_PRICES_JSON); } catch { problems.push("LLM_PRICES_JSON: must be valid JSON"); } }
  if (mode === "live" && !hasKey) problems.push(`PROVIDER_MODE=live but ${e.LLM_PROVIDER === "anthropic" ? "ANTHROPIC_API_KEY" : "LLM_API_KEY"} is not set`);
  if (prod) {
    if (mode === "mock") problems.push("PROVIDER_MODE=mock is not allowed in production (decision D1): set PROVIDER_MODE=live");
    if (!e.VISITOR_SALT || e.VISITOR_SALT.length < 32 || WEAK_SALTS.has(e.VISITOR_SALT)) problems.push("VISITOR_SALT must be a random string of at least 32 characters in production (e.g. `openssl rand -hex 32`)");
    if (!e.DATABASE_URL_APP) problems.push("DATABASE_URL_APP is required in production (the pooled, restricted-role URL)");
  }
  if (problems.length) throw new EnvError(problems);
  return { ...e, PROVIDER_MODE: mode };
}

let cached: { env?: Env; error?: EnvError } | null = null;

/** Validated environment for the running process. Throws EnvError (cached) when the configuration is invalid. */
export function getEnv(): Env {
  // Cached in production only, so tests can change process.env between cases.
  if (cached && cached.env && rawEnv().NODE_ENV !== "production") cached = null;
  if (!cached) {
    try { cached = { env: parseEnv(rawEnv()) }; } catch (e) { cached = { error: e instanceof EnvError ? e : new EnvError([String(e)]) }; }
  }
  if (cached.error) { const err = cached.error; if (rawEnv().NODE_ENV !== "production") cached = null; throw err; }
  return cached.env!;
}

/** For /api/ready and the maintenance state: never throws. */
export function bootStatus(): { ok: true } | { ok: false; problems: string[] } {
  try { getEnv(); return { ok: true }; } catch (e) { return { ok: false, problems: e instanceof EnvError ? e.problems : [String(e)] }; }
}

/** Test hook. */
export function resetEnvCache() { cached = null; }

/** Whether x-forwarded-for may be trusted: only behind Vercel's proxy or when the operator says so (documented in RUNBOOK). */
export const trustsProxy = (e: Pick<Env, "VERCEL" | "TRUST_PROXY">) => e.VERCEL === "1" || e.TRUST_PROXY;
