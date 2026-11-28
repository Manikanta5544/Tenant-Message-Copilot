// Setup diagnostics shared by /setup (development), the startup banner (instrumentation.ts) and scripts/doctor-quick.ts.
// Read-only. Never returns a secret: variables are reported as "set" / "not set", connections as host:port.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { classifyDbError, hostPortOf } from "@/core/db-errors";
import { missingMigrations, SCHEMA_HINT } from "@/core/schema-version";
import { MIGRATIONS } from "./manifest";
import { STALE_BASELINE_SQL, USABLE_BASELINE_SQL, staleParams } from "./baselines";
import { rawEnv } from "../core/env";

export type CheckStatus = "ok" | "warn" | "fail" | "skipped";
export interface Fix { powershell: string; bash: string }
export interface Check { id: string; label: string; status: CheckStatus; detail: string; fix?: Fix }
type Raw = Record<string, string | undefined>;

const same = (c: string): Fix => ({ powershell: c, bash: c });
const COPY_ENV: Fix = { powershell: "Copy-Item .env.example .env; notepad .env", bash: "cp .env.example .env && ${EDITOR:-nano} .env" };
const PG_START: Fix = same("docker compose up -d");
const MIGRATE_SEED_BASH: Fix = { powershell: "npm run migrate; npm run seed", bash: "npm run migrate && npm run seed" };

/** Which env file the developer actually has. Notepad on Windows likes to save ".env" as ".env.txt". */
export function envFileCheck(dir = process.cwd()): Check {
  // A developer-machine check by design. The turbopackIgnore markers keep the bundler from tracing the whole project into the server output for it.
  const has = (n: string) => fs.existsSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ dir, n));
  if (has(".env")) return { id: "env-file", label: "Environment file", status: "ok", detail: ".env found" };
  const wrong = [".env.txt", ".env.example.txt", ".env (1)", "env", ".env.local.txt"].find(has);
  if (wrong) return { id: "env-file", label: "Environment file", status: "fail", detail: `".env" not found, but "${wrong}" exists. Windows Notepad adds .txt: rename it to exactly .env`, fix: { powershell: `Rename-Item "${wrong}" .env`, bash: `mv "${wrong}" .env` } };
  if (has(".env.example")) return { id: "env-file", label: "Environment file", status: "fail", detail: '".env" not found. Copy .env.example to .env (the file must not be named .env.txt)', fix: COPY_ENV };
  return { id: "env-file", label: "Environment file", status: "fail", detail: "no .env and no .env.example in this folder: run the commands from the project folder", fix: COPY_ENV };
}

const REQUIRED = ["DATABASE_URL_OWNER", "DATABASE_URL_APP", "APP_ROLE_PASSWORD"] as const;
export const missingVars = (raw: Raw): string[] => REQUIRED.filter((k) => !raw[k]?.trim());

export function nodeCheck(version = process.versions.node): Check {
  const major = Number(version.split(".")[0]);
  return major >= 22 ? { id: "node", label: "Node.js", status: "ok", detail: `v${version}` }
    : { id: "node", label: "Node.js", status: "fail", detail: `v${version} is too old: Node 22 or newer is required (the scripts use --env-file-if-exists)`, fix: same("winget install OpenJS.NodeJS.LTS   (or install Node 22+ from nodejs.org)") };
}

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 4000 });
  await c.connect();
  try { return await fn(c); } finally { await c.end().catch(() => {}); }
}

/** All checks, in the order a developer should fix them. Each failure carries the exact command for PowerShell and bash. */
export async function runChecks(raw: Raw = rawEnv(), opts: { cwd?: string; live?: boolean } = {}): Promise<Check[]> {
  const out: Check[] = [nodeCheck(), envFileCheck(opts.cwd)];
  for (const k of REQUIRED) out.push({ id: `var-${k}`, label: k, status: raw[k]?.trim() ? "ok" : "fail", detail: raw[k]?.trim() ? "set" : "not set", fix: raw[k]?.trim() ? undefined : COPY_ENV });
  const mode = raw.PROVIDER_MODE?.trim() || "live";
  out.push({ id: "provider-mode", label: "PROVIDER_MODE", status: "ok", detail: `${mode}${mode === "mock" ? " (labelled Mock; refused in production)" : ""}` });
  if (mode === "live") out.push({ id: "llm-key", label: "LLM_API_KEY", status: raw.LLM_API_KEY?.trim() || raw.ANTHROPIC_API_KEY?.trim() ? "ok" : "warn", detail: raw.LLM_API_KEY?.trim() || raw.ANTHROPIC_API_KEY?.trim() ? "set" : "not set: live drafts will fall back to a safe holding reply. Set it, or use PROVIDER_MODE=mock for a keyless demo", fix: raw.LLM_API_KEY?.trim() ? undefined : COPY_ENV });

  const owner = raw.DATABASE_URL_OWNER?.trim(), app = raw.DATABASE_URL_APP?.trim();
  const skip = (id: string, label: string, why: string): Check => ({ id, label, status: "skipped", detail: why });
  if (!owner && !app) { out.push(skip("db", "Database reachable", "needs DATABASE_URL_OWNER or DATABASE_URL_APP")); return out; }
  const url = owner ?? app!;
  const hp = hostPortOf(url);
  let reachable = false;
  try { await withClient(url, (c) => c.query("SELECT 1")); reachable = true; out.push({ id: "db", label: "Database reachable", status: "ok", detail: `${hp.host}:${hp.port}` }); }
  catch (e) {
    const i = classifyDbError(e, url);
    out.push({ id: "db", label: "Database reachable", status: "fail", detail: `${i.kind.replace("_", " ")} at ${hp.host}:${hp.port}. ${i.hint}`, fix: i.kind === "unreachable" ? PG_START : i.kind === "auth_failed" ? MIGRATE_SEED_BASH : i.kind === "database_missing" ? same("createdb copilot") : undefined });
  }
  if (!reachable) { for (const [id, l] of [["app-role", "App role can log in"], ["migrations", "Migrations current"], ["baselines", "Baseline drafts present"]] as const) out.push(skip(id, l, "needs a reachable database")); return out; }

  if (app) {
    try { await withClient(app, (c) => c.query("SELECT 1")); out.push({ id: "app-role", label: "App role can log in", status: "ok", detail: `copilot_app at ${hostPortOf(app).host}:${hostPortOf(app).port}` }); }
    catch (e) {
      const i = classifyDbError(e, app);
      out.push({ id: "app-role", label: "App role can log in", status: "fail", detail: i.kind === "auth_failed" ? "the copilot_app login failed. It is created by npm run migrate; its password must equal APP_ROLE_PASSWORD and the password in DATABASE_URL_APP. On Neon use the pooled URL for DATABASE_URL_APP and the direct URL for DATABASE_URL_OWNER" : i.hint, fix: MIGRATE_SEED_BASH });
    }
  } else out.push(skip("app-role", "App role can log in", "DATABASE_URL_APP is not set"));

  try {
    await withClient(url, async (c) => {
      let applied: string[] = [];
      try { applied = (await c.query("SELECT version FROM schema_migrations")).rows.map((r) => r.version as string); } catch { /* no table yet */ }
      const m = missingMigrations(applied, MIGRATIONS);
      out.push(m.length ? { id: "migrations", label: "Migrations current", status: "fail", detail: `${m.length} not applied (${m.join(", ")}). ${SCHEMA_HINT}`, fix: MIGRATE_SEED_BASH } : { id: "migrations", label: "Migrations current", status: "ok", detail: `${MIGRATIONS.length} applied` });
      if (m.length) { out.push(skip("baselines", "Baseline drafts present", "run the migrations first")); return; }
      if (!owner) { out.push(skip("baselines", "Baseline drafts present", "needs DATABASE_URL_OWNER")); return; }
      const n = Number((await c.query(`SELECT count(*)::text AS n FROM messages m WHERE m.source = 'seeded' AND m.scenario_label IS NOT NULL AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.message_id = m.id AND r.visitor_hash IS NULL AND ${USABLE_BASELINE_SQL})`)).rows[0]!.n);
      out.push(n > 0 ? { id: "baselines", label: "Baseline drafts present", status: "fail", detail: `${n} demo scenario(s) have no usable baseline draft`, fix: same("npm run seed") } : { id: "baselines", label: "Baseline drafts present", status: "ok", detail: "all demo scenarios have a saved draft" });
      if (n === 0) {
        const stale = (await c.query(STALE_BASELINE_SQL, staleParams())).rowCount ?? 0;
        out.push(stale > 0 ? { id: "baselines-fresh", label: "Baseline drafts current", status: "warn", detail: `${stale} baseline draft(s) were produced by an older prompt or wording version and show old text`, fix: same("npm run seed -- --refresh") } : { id: "baselines-fresh", label: "Baseline drafts current", status: "ok", detail: "all baselines match the running prompt and wording versions" });
      }
    });
  } catch (e) { out.push({ id: "migrations", label: "Migrations current", status: "fail", detail: classifyDbError(e, url).hint, fix: MIGRATE_SEED_BASH }); }

  if (opts.live && mode === "live" && raw.LLM_API_KEY?.trim() && raw.LLM_BASE_URL) {
    const ids = [raw.LLM_MODEL_TRIAGE, raw.LLM_MODEL_DRAFT, raw.LLM_MODEL_CHECK].filter((x): x is string => !!x);
    try {
      const r = await fetch(`${raw.LLM_BASE_URL.replace(/\/$/, "")}/models`, { headers: { authorization: `Bearer ${raw.LLM_API_KEY}` }, signal: AbortSignal.timeout(5000) });
      const have = new Set(((await r.json()) as { data?: { id: string }[] }).data?.map((m) => m.id) ?? []);
      const gone = ids.filter((i) => !have.has(i));
      out.push(r.ok && !gone.length ? { id: "models", label: "Model IDs reachable", status: "ok", detail: [...new Set(ids)].join(", ") } : { id: "models", label: "Model IDs reachable", status: "fail", detail: r.ok ? `not available to this key: ${gone.join(", ")}` : `the provider answered ${r.status}: check LLM_API_KEY`, fix: same("npm run models") });
    } catch { out.push({ id: "models", label: "Model IDs reachable", status: "warn", detail: "could not reach the provider (network or timeout)" }); }
  }
  return out;
}

/** One actionable line per problem, for terminals. */
export const failureLines = (checks: Check[]): string[] => checks.filter((c) => c.status === "fail" || c.status === "warn").map((c) => `${c.label}: ${c.detail}${c.fix ? `  ->  ${c.fix.bash === c.fix.powershell ? c.fix.bash : `PowerShell: ${c.fix.powershell} | bash: ${c.fix.bash}`}` : ""}`);
