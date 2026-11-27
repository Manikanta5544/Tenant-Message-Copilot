// `npm run doctor`: pre-flight for a deployment. Exits non-zero on any failure, with a fix hint per check.
// The model round trip is a REAL, BILLED one-token completion per role; its token usage is printed. Skip with --skip-roundtrip.
import pg from "pg";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { EnvError, parseEnv, rawEnv, type Env, type RawEnv } from "../core/env";
import { ASSUMED_PRICES_DATE, modelAvailability, openAICompatFromEnv } from "../core/providers/openai-compat";
import { MIGRATIONS } from "../db/manifest";
import { s0Audit } from "./s0-audit";

export interface CheckResult { name: string; ok: boolean; skipped?: boolean; warn?: boolean; detail: string; hint?: string }
const ok = (name: string, detail: string): CheckResult => ({ name, ok: true, detail });
const bad = (name: string, detail: string, hint: string): CheckResult => ({ name, ok: false, detail, hint });
const warning = (name: string, detail: string, hint: string): CheckResult => ({ name, ok: true, warn: true, detail, hint });
const skip = (name: string, detail: string): CheckResult => ({ name, ok: true, skipped: true, detail });
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 160);

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 8000 });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

export async function doctor(raw: RawEnv = rawEnv(), o: { roundtrip?: boolean; fetch?: typeof fetch; deep?: boolean } = {}): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  let env: Env;
  try {
    env = parseEnv(raw);
    out.push(ok("env schema", `valid (NODE_ENV=${env.NODE_ENV}, PROVIDER_MODE=${env.PROVIDER_MODE})`));
  } catch (e) {
    const problems = e instanceof EnvError ? e.problems : [msg(e)];
    out.push(bad("env schema", problems.join("; "), "Fix the listed variables in .env (see .env.example and docs/RUNBOOK.md), then re-run."));
    return out; // nothing else is meaningful with an invalid configuration
  }

  // Without a trusted proxy the server cannot see client addresses, so per-visitor limits rest on a cookie the client can discard.
  if (env.NODE_ENV === "production" && env.VERCEL !== "1" && !env.TRUST_PROXY) {
    out.push(warning("rate-limit identity", "no trusted proxy: per-visitor limits are cookie-only and therefore advisory; there is no per-network ceiling", "Behind a proxy or load balancer set TRUST_PROXY=1 and TRUSTED_PROXY_HOPS (docs/RUNBOOK.md). The global daily cap and budget remain the hard stop."));
  }
  const ownerUrl = env.DATABASE_URL_OWNER, appUrl = env.DATABASE_URL_APP;
  if (!ownerUrl) out.push(bad("database (owner role)", "DATABASE_URL_OWNER is not set", "Set the DIRECT (non-pooled) connection string; it is used by migrate and seed."));
  else try { await withClient(ownerUrl, (c) => c.query("SELECT 1")); out.push(ok("database (owner role)", "connected")); }
  catch (e) { out.push(bad("database (owner role)", msg(e), "Check DATABASE_URL_OWNER (Neon: the direct URL) and that the database is reachable.")); }

  if (!appUrl) out.push(bad("database (app role)", "DATABASE_URL_APP is not set", "Set the POOLED connection string of the restricted role copilot_app."));
  else {
    try {
      await withClient(appUrl, async (c) => {
        out.push(ok("database (app role)", "connected"));
        const r = (await c.query("SELECT current_user AS u, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user")).rows[0];
        out.push(r && !r.rolsuper && !r.rolbypassrls ? ok("RLS role is non-bypass", `${r.u}: no superuser, no BYPASSRLS`) : bad("RLS role is non-bypass", `runtime role ${r?.u} can bypass row level security`, "DATABASE_URL_APP must use copilot_app, not an owner or superuser. Run `npm run migrate` and set APP_ROLE_PASSWORD."));
        try {
          const have = (await c.query("SELECT version FROM schema_migrations ORDER BY version")).rows.map((x) => x.version as string);
          const missing = MIGRATIONS.filter((m) => !have.includes(m));
          out.push(missing.length ? bad("migrations current", `missing: ${missing.join(", ")}`, "Run `npm run migrate` with DATABASE_URL_OWNER.") : ok("migrations current", `${MIGRATIONS.length} applied`));
        } catch (e) { out.push(bad("migrations current", msg(e), "Run `npm run migrate`.")); }
      });
    } catch (e) { out.push(bad("database (app role)", msg(e), /password|authentication|28P01/i.test(msg(e)) ? "Login as copilot_app failed. The role is created by `npm run migrate` with the password in APP_ROLE_PASSWORD, so DATABASE_URL_APP must use exactly that password. On Neon, DATABASE_URL_OWNER is the DIRECT url (host without -pooler) and DATABASE_URL_APP is the POOLED url (host with -pooler) with user copilot_app. Run `npm run migrate` again after changing APP_ROLE_PASSWORD." : "Check DATABASE_URL_APP (Neon: the pooled url, host with -pooler, user copilot_app) and that the database is reachable.")); }
  }

  // The S0 audit reads completed runs whatever the provider mode, so it runs before the live-model checks (which return early otherwise).
  if (o.deep && ownerUrl) {
    try {
      const a = await s0Audit(ownerUrl);
      out.push(a.violations.length ? bad("S0 audit (deep)", `${a.violations.length} violation(s) in ${a.runs} completed run(s): ${a.violations[0]}`, "Run `npm run s0-audit` for the list. A draft must never carry a figure the ledger does not.") : ok("S0 audit (deep)", `${a.runs} completed run(s), 0 violations`));
    } catch (e) { out.push(bad("S0 audit (deep)", msg(e), "The audit reads runs with the owner role; check DATABASE_URL_OWNER.")); }
  }
  if (env.PROVIDER_MODE !== "live") {
    out.push(skip("model availability", `PROVIDER_MODE=${env.PROVIDER_MODE}: no live model in use`));
    out.push(skip("model round trip", `PROVIDER_MODE=${env.PROVIDER_MODE}`));
    return out;
  }
  if (env.LLM_PROVIDER === "anthropic") {
    out.push(skip("model availability", "anthropic backend: use the Anthropic console; doctor checks the OpenAI-compatible path"));
    return out;
  }
  {
    // A model with no price cannot be budgeted: refuse it instead of silently counting zero.
    const prov = openAICompatFromEnv({ ...raw, LLM_API_KEY: raw.LLM_API_KEY || "x" });
    const unpriced = prov.unpricedModels();
    out.push(unpriced.length
      ? bad("model prices", `no price for model ${unpriced.join(", ")}: budget cannot be enforced (it is costed at a worst-case price meanwhile)`, `Set LLM_PRICES_JSON, for example {"${unpriced[0]}":{"in":150000,"out":600000}} (micro-USD per million tokens).`)
      : ok("model prices", `all configured models have a price (assumed list prices dated ${ASSUMED_PRICES_DATE} unless overridden by LLM_PRICES_JSON)`));
  }
  const f = o.fetch ?? fetch;
  const av = await modelAvailability(raw, f);
  if (!av.listed) out.push(bad("model availability", "could not list models", "Check LLM_API_KEY and LLM_BASE_URL (Groq: https://api.groq.com/openai/v1)."));
  else {
    const missing = Object.entries(av.roles).filter(([, r]) => !r.available).map(([k, r]) => `${k}=${r.model}`);
    out.push(missing.length ? bad("model availability", `not listed for this key: ${missing.join(", ")}`, "Run `npm run models`, then set LLM_MODEL_TRIAGE / LLM_MODEL_DRAFT / LLM_MODEL_CHECK to listed IDs.") : ok("model availability", Object.entries(av.roles).map(([k, r]) => `${k}=${r.model}`).join(", ")));
  }
  if (o.roundtrip === false) { out.push(skip("model round trip", "skipped (--skip-roundtrip)")); return out; }
  const cfg = openAICompatFromEnv(raw);
  const models = (cfg as unknown as { c: { models: Record<string, string>; apiKey: string; baseUrl: string } }).c.models;
  for (const [role, model] of Object.entries(models)) {
    try {
      const res = await f(`${env.LLM_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.LLM_API_KEY}` }, signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ model, max_tokens: 1 + env.LLM_OUTPUT_HEADROOM, temperature: 0, ...(env.LLM_REASONING_EFFORT ? { reasoning_effort: env.LLM_REASONING_EFFORT } : {}), messages: [{ role: "user", content: "ok" }] }),
      });
      if (res.status === 429) { out.push(bad(`model round trip: ${role}`, "429 rate limited", "Free-tier quota: wait for Retry-After, lower EVAL_PACE_MS pressure, or use a paid key.")); continue; }
      if (!res.ok) { out.push(bad(`model round trip: ${role}`, `HTTP ${res.status}`, "Check the key, the model ID (`npm run models`) and LLM_JSON_MODE / LLM_REASONING_EFFORT support.")); continue; }
      const j = (await res.json()) as { usage?: { prompt_tokens?: number; completion_tokens?: number } };
      out.push(ok(`model round trip: ${role}`, `${model} answered (BILLED: ${j.usage?.prompt_tokens ?? "?"} in / ${j.usage?.completion_tokens ?? "?"} out tokens)`));
    } catch (e) { out.push(bad(`model round trip: ${role}`, msg(e), "Endpoint unreachable or timed out: check LLM_BASE_URL and network egress.")); }
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const res = await doctor(rawEnv(), { roundtrip: !process.argv.includes("--skip-roundtrip"), deep: process.argv.includes("--deep") });
  for (const r of res) console.log(`${r.skipped ? "SKIP" : r.warn ? "WARN" : r.ok ? " OK " : "FAIL"}  ${r.name.padEnd(28)} ${r.detail}${r.ok && !r.warn ? "" : `\n      ${r.warn ? "advice" : "fix"}: ${r.hint}`}`);
  const failed = res.filter((r) => !r.ok).length;
  const notLive = res.some((r) => r.name === "env schema" && r.ok && !/PROVIDER_MODE=live/.test(r.detail));
  if (notLive) console.log("\nNOTE: PROVIDER_MODE is not live. This is fine locally and in CI, but it is not a production configuration (decision D1).");
  console.log(failed ? `\ndoctor: ${failed} check(s) failed` : "\ndoctor: all checks passed");
  process.exit(failed ? 1 : 0);
}
