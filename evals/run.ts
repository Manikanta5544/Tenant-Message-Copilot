import { getEnv } from "../core/env";
// Eval runner: npm run eval (live) | eval:replay | eval:mock. Saves every run to eval_runs and exits
// Tier 1 (critical) runs are saved by default; tier 2 (extended) only with --save-extended, so the Evals page headline is always the critical gate.
// non-zero when the gate fails (any S0, or S1 above the previous saved run of the same mode).
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { demoAsOf } from "../core/config";
import { PROMPT_VERSION, type LLMProvider } from "../core/provider";
import { createProvider, liveConfigured } from "../app/server/provider";
import { modelAvailability } from "../core/providers/openai-compat";
import { MockProvider } from "../core/providers/mock";
import { RecordingProvider, ReplayProvider } from "../core/providers/replay";
import { closeAllPools, withScope } from "../db/client";
import { ORG_A, ORG_B } from "../db/ids";
import { findResident, runMessage } from "./harness";
import { CaseFile, type Case } from "./schema";
import { gate, scoreCase, summarise, validity, type CaseResult } from "./score";
import { sqlTruth } from "./truth";

export type EvalMode = "live" | "replay" | "mock";
const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_FILE = path.join(here, "fixtures", "recorded.json");

export function loadCases(tier: 1 | 2, dir = path.join(here, "cases")): Case[] {
  const all = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().flatMap((f) => CaseFile.parse(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))));
  const ids = new Set<string>();
  for (const c of all) { if (ids.has(c.id)) throw new Error(`duplicate case id ${c.id}`); ids.add(c.id); }
  return all.filter((c) => c.tier <= tier);
}

export interface EvalOptions { paceMs?: number; mode: EvalMode; tier: 1 | 2; appUrl: string; ownerUrl: string; save: boolean; asOf?: string; provider?: LLMProvider; cases?: Case[]; log?: (s: string) => void }

export async function runEval(o: EvalOptions) {
  const asOf = o.asOf ?? demoAsOf();
  const cases = o.cases ?? loadCases(o.tier);
  let provider = o.provider;
  let recorder: RecordingProvider | null = null;
  if (!provider) {
    if (o.mode === "mock") provider = new MockProvider();
    else if (o.mode === "replay") {
      const rp = new ReplayProvider(FIXTURE_FILE);
      if (rp.size === 0) throw Object.assign(new Error("no recorded model responses found at evals/fixtures/recorded.json. A recording is produced only by a live run (`npm run eval` with LLM_API_KEY, or ANTHROPIC_API_KEY with LLM_PROVIDER=anthropic), which writes the file. Nothing was replayed or invented."), { code: "NO_RECORDING" });
      provider = rp;
    } else {
      if (!liveConfigured()) throw new Error("live eval needs a model key (LLM_API_KEY for Groq or any OpenAI-compatible endpoint, or ANTHROPIC_API_KEY with LLM_PROVIDER=anthropic); none is set, so no live result exists (unverified).");
      process.env.PROVIDER_MODE = "live";
      if (process.env.LLM_PROVIDER !== "anthropic") {
        // Fail fast: a retired or misspelt model ID would otherwise turn the whole run into fallbacks.
        const av = await modelAvailability();
        if (!av.listed) throw new Error("could not list models at LLM_BASE_URL/models (check the key and URL); refusing to start a live eval.");
        const dead = Object.entries(av.roles).filter(([, r]) => !r.available).map(([k, r]) => `${k}=${r.model}`);
        if (dead.length) throw new Error(`configured model(s) not available to this key: ${dead.join(", ")}. Run \`npm run models\` and set LLM_MODEL_* accordingly.`);
      }
      recorder = new RecordingProvider(createProvider(), FIXTURE_FILE);
      provider = recorder;
    }
  }
  const owner = new pg.Client({ connectionString: o.ownerUrl });
  await owner.connect();
  const results: CaseResult[] = [];
  try {
    const pace = o.paceMs ?? (o.mode === "live" ? getEnv().EVAL_PACE_MS : 0);
    for (const c of cases) {
      if (pace > 0 && results.length > 0) await new Promise((r) => setTimeout(r, pace));
      const org = c.org === "A" ? ORG_A : ORG_B;
      const truth = sqlTruth(owner, org, asOf);
      const t0 = performance.now();
      let row: CaseResult;
      try {
        const { output, events } = await runMessage({ appUrl: o.appUrl, ownerUrl: o.ownerUrl, provider, unit: c.unit, org: c.org, message: c.message, asOf });
        const latency = performance.now() - t0;
        const resident = await findResident(o.ownerUrl, c.unit, c.org);
        const failures = await scoreCase(c, resident.id, output, events, truth, latency);
        row = { id: c.id, category: c.category, unit: c.unit, route_expected: c.expect.route, route_actual: output.route, language_expected: c.expect.language, language_actual: output.language,
          mode: output.mode, draft_source: output.draft_source, pass: failures.length === 0, failures, latency_ms: Math.round(latency), cost_micro_usd: output.usage.cost_micro_usd, tokens_in: output.usage.tokens_in, tokens_out: output.usage.tokens_out };
      } catch (e) {
        row = { id: c.id, category: c.category, unit: c.unit, route_expected: c.expect.route, route_actual: "error", language_expected: c.expect.language, language_actual: "-", mode: "error", draft_source: "-", pass: false,
          failures: [{ severity: "S1", code: "run_error", detail: (e as Error).message.slice(0, 200) }], latency_ms: Math.round(performance.now() - t0), cost_micro_usd: 0, tokens_in: 0, tokens_out: 0 };
      }
      results.push(row);
    }
  } finally { await owner.end(); }
  recorder?.flush();

  const summary = summarise(results);
  let previousS1: number | null = null;
  await withScope(o.appUrl, { orgId: ORG_A }, async (db) => {
    const r = await db.query(`SELECT (summary->>'s1_cases')::int AS s1 FROM eval_runs WHERE mode = $1 AND COALESCE((summary->>'tier')::int, 1) = $2 ORDER BY created_at DESC LIMIT 1`, [o.mode, o.tier]);
    previousS1 = r.rows[0]?.s1 ?? null;
  });
  const val = validity(results);
  const g = gate(summary, previousS1);
  if (!val.valid) { g.ok = false; g.reasons.push(`INVALID RUN: ${val.unmeasured}/${results.length} cases ended in fallback or error (limit 10%); nothing was measured`); }
  let commit: string | null = null;
  try { commit = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { /* not a git checkout */ }
  const full = { ...summary, gate: g, validity: val, previous_s1_cases: previousS1, as_of: asOf, tier: o.tier };
  let id: string | null = null;
  // An invalid run is never saved: it must not become the baseline that later runs are compared with.
  if (o.save && val.valid) {
    id = randomUUID();
    await withScope(o.appUrl, { orgId: ORG_A }, (db) => db.query(
      `INSERT INTO eval_runs (id, organization_id, prompt_version, git_commit, mode, summary, results) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, ORG_A, PROMPT_VERSION, commit, o.mode, JSON.stringify(full), JSON.stringify(results)]));
  }
  return { id, results, summary: full, gate: g };
}

export function formatTable(r: Awaited<ReturnType<typeof runEval>>, mode: EvalMode): string {
  const L: string[] = [];
  L.push(`${mode.toUpperCase()} eval  prompt ${PROMPT_VERSION}  as-of ${r.summary.as_of}  ${r.id ? "saved " + r.id : "not saved"}`);
  L.push("id       category                 route(exp -> got)                   lang   sev  result");
  for (const x of r.results) {
    const sev = ["S0", "S1", "S2"].filter((s) => x.failures.some((f) => f.severity === s)).join("/") || "-";
    L.push(`${x.id.padEnd(8)} ${x.category.padEnd(24)} ${`${x.route_expected} -> ${x.route_actual}`.padEnd(35)} ${x.language_actual.slice(0, 5).padEnd(6)} ${sev.padEnd(4)} ${x.pass ? "pass" : "FAIL"}`);
    for (const f of x.failures) L.push(`           ${f.severity} ${f.code}: ${f.detail}`);
  }
  const s = r.summary;
  L.push(`total ${s.total}  pass ${s.passed}  fail ${s.failed}  | cases with S0 ${s.s0_cases}  S1 ${s.s1_cases}  S2 ${s.s2_cases}`);
  for (const [k, v] of Object.entries(s.by_category)) L.push(`  ${k.padEnd(24)} ${v.passed}/${v.total}  S0 ${v.s0} S1 ${v.s1} S2 ${v.s2}`);
  L.push(`latency p50 ${s.latency_ms.p50} ms  p95 ${s.latency_ms.p95} ms  | cost total ${(s.cost_micro_usd.total / 1e6).toFixed(4)} USD`);
  if (!r.summary.validity.valid) L.push(`INVALID: not saved. causes: ${JSON.stringify(r.summary.validity.causes)}`);
  L.push(`gate: ${r.gate.ok ? "PASS" : "FAIL (" + r.gate.reasons.join("; ") + ")"}  previous S1: ${s.previous_s1_cases ?? "none saved"}`);
  return L.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined; };
  const mode = (arg("mode") ?? "mock") as EvalMode;
  const tier = Number(arg("tier") ?? 1) as 1 | 2;
  const appUrl = process.env.DATABASE_URL_APP, ownerUrl = process.env.DATABASE_URL_OWNER;
  if (!appUrl || !ownerUrl) { console.error("DATABASE_URL_APP and DATABASE_URL_OWNER are required."); process.exit(2); }
  runEval({ mode, tier, appUrl, ownerUrl, save: !process.argv.includes("--no-save") && (tier === 1 || process.argv.includes("--save-extended")) }).then(async (r) => {
    console.log(formatTable(r, mode));
    await closeAllPools();
    process.exit(r.gate.ok ? 0 : 1);
  }, async (e) => {
    await closeAllPools();
    // Replay with nothing recorded is "not run", never a pass and never a failure: exit 0 with an unmistakable line. A real mismatch still exits 1.
    if (e?.code === "NO_RECORDING") { console.log(`NOT RUN: replay found no recording at evals/fixtures/recorded.json (no result, unverified).\n${e.message}`); process.exit(0); }
    console.error(e.message); process.exit(2);
  });
}
