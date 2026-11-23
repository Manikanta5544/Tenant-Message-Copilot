import type { Metadata } from "next";
import type { CaseResult } from "@/evals/score";
import { latestEvalRuns } from "@/db/runs";
import { safe } from "../lib/safe";
import ProblemPanel from "../components/ProblemPanel";
import { getEnv } from "@/core/env";
import { Dot } from "../components/ui/Dot";
import { EmptyState } from "../components/ui/EmptyState";
import { Table } from "../components/ui/Table";
import { cx } from "../components/ui/cx";
import { usd } from "../lib/format";
import EvalTable from "./EvalTable";
import { isDev } from "@/core/dev";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Evals" };
type Run = Awaited<ReturnType<typeof latestEvalRuns>>[number];
type Cat = { total: number; passed: number; s0: number; s1: number; s2: number };
const MODE_NOTE: Record<string, string> = {
  live: "Live model responses.", replay: "Recorded real model responses replayed.", mock: "Deterministic mock provider. This tests the application's verification, routing and isolation, not any model.",
};
const when = (iso: string | Date) => new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC";

export default async function EvalsPage() {
  const loaded = await safe(() => latestEvalRuns(40));
  const runs: Run[] = loaded.ok ? loaded.data : [];
  // The headline is always the latest critical (tier 1) run, preferring the most trustworthy mode: live, then replay, then mock.
  // Extended (tier 2) runs are informational and never the headline.
  const tierOf = (r: Run) => r.summary.tier ?? 1;
  const critical = runs.filter((r) => tierOf(r) === 1 && r.summary.validity?.valid !== false);
  const latest = ["live", "replay", "mock"].map((m) => critical.find((r) => r.mode === m)).find(Boolean);
  const others = runs.filter((r) => r !== latest).slice(0, 12);
  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-[1040px] px-4 py-8 outline-none md:px-6">
      <h1 className="text-2xl">Evaluation results</h1>
      <p className="mt-2 max-w-[62ch] text-muted">Saved runs of the golden cases against the real pipeline and database, scored by severity. One S0 failure fails the build; S1 failures may not rise against the last saved run.</p>
      {!loaded.ok && <ProblemPanel problem={loaded.problem} dev={isDev()} className="px-0" />}
      {loaded.ok && !latest && <EmptyState title="No saved eval run yet" className="px-0"><p>Nothing is shown until a run exists. Run <code>npm run eval</code> against a live model, or <code>npm run eval:mock</code> to test the application only.</p></EmptyState>}
      {latest && <Latest r={latest} />}
      {others.length > 0 && (
        <section aria-labelledby="others" className="mt-10">
          <h2 id="others" className="text-lg">Other saved runs</h2>
          <div className="mt-2"><Table caption="Other saved eval runs" minWidth={640}>
            <thead><tr><th scope="col">When</th><th scope="col">Mode</th><th scope="col">Cases</th><th scope="col">Prompt</th><th scope="col" className="r">Pass</th><th scope="col" className="r">S0</th><th scope="col" className="r">S1</th><th scope="col" className="r">S2</th><th scope="col">Gate</th></tr></thead>
            <tbody>{others.map((r) => (
              <tr key={r.id}>
                <td className="tnum whitespace-nowrap">{when(r.created_at)}</td><td>{r.mode}</td><td>{tierOf(r) === 1 ? "critical" : "extended (informational)"}</td><td className="font-mono text-xs">{r.prompt_version}</td>
                <td className="r">{r.summary.passed}/{r.summary.total}</td><td className="r">{r.summary.s0_cases}</td><td className="r">{r.summary.s1_cases}</td><td className="r">{r.summary.s2_cases}</td>
                <td><Dot status={r.summary.gate?.ok ? "ready" : "escalate"} label={r.summary.gate?.ok ? "Pass" : "Fail"} /></td>
              </tr>))}</tbody>
          </Table></div>
        </section>
      )}
    </main>
  );
}

function Latest({ r }: { r: Run }) {
  const repo = getEnv().REPO_URL;
  const s = r.summary, results = r.results as CaseResult[];
  const ok = !!s.gate?.ok;
  const kpi: [string, React.ReactNode][] = [
    ["Cases", s.total], ["Passed", s.passed], ["S0 critical", <span key="s0" className={cx(s.s0_cases > 0 && "text-escalate")}>{s.s0_cases}</span>], ["S1 serious", <span key="s1" className={cx(s.s1_cases > 0 && "text-review")}>{s.s1_cases}</span>], ["S2 quality", s.s2_cases],
    ["Latency p50 / p95", `${s.latency_ms.p50} / ${s.latency_ms.p95} ms`], ["Cost", usd(s.cost_micro_usd.total)],
  ];
  return (
    <>
      <section aria-label="Gate result" className="mt-6 border-y border-border py-3">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base">
          <Dot status={ok ? "ready" : "escalate"} />
          <b className={cx("text-lg", ok ? "text-ready" : "text-escalate")}>{ok ? "PASS" : "FAIL"}</b>
          <span className="tnum font-medium">{s.passed}/{s.total}</span>
          <span className="text-muted">{r.mode} · prompt <span className="font-mono text-xs">{r.prompt_version}</span>
            {r.git_commit && <> · commit {repo ? <a href={`${repo.replace(/\/$/, "")}/commit/${r.git_commit}`} className="font-mono text-xs text-accent underline underline-offset-4">{r.git_commit}</a> : <span className="font-mono text-xs">{r.git_commit}</span>}</>}
            {" · "}<time className="tnum" dateTime={new Date(r.created_at).toISOString()}>{when(r.created_at)}</time></span>
        </p>
        {!ok && (s.gate?.reasons ?? []).length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-5 text-base text-escalate">{(s.gate.reasons as string[]).map((x, i) => <li key={i}>{x}</li>)}</ul>}
        <p className="mt-1 text-sm text-muted">{MODE_NOTE[r.mode]} Scored as of {s.as_of}; {s.previous_s1_cases !== null && s.previous_s1_cases !== undefined ? `previous saved S1: ${s.previous_s1_cases}.` : "no earlier run of this mode to compare."}</p>
      </section>

      <section aria-label="Key figures" className="mt-4">
        <dl className="flex flex-wrap gap-x-8 gap-y-2">
          {kpi.map(([k, v]) => <div key={k}><dt className="text-sm text-muted">{k}</dt><dd className="tnum text-xl font-semibold">{v}</dd></div>)}
        </dl>
      </section>

      <section aria-labelledby="cases" className="mt-8">
        <h2 id="cases" className="text-lg">Cases <span className="tnum font-normal text-muted">{results.length}</span></h2>
        <p className="mb-2 text-sm text-muted">Failed cases open to expected versus actual.</p>
        <EvalTable results={results} />
      </section>

      <section aria-labelledby="cats" className="mt-8">
        <h2 id="cats" className="text-lg">By category</h2>
        <div className="mt-2"><Table caption="Results by category" minWidth={420}>
          <thead><tr><th scope="col">Category</th><th scope="col" className="r">Passed</th><th scope="col" className="r">S0</th><th scope="col" className="r">S1</th><th scope="col" className="r">S2</th></tr></thead>
          <tbody>{Object.entries(s.by_category as Record<string, Cat>).map(([k, v]) => (
            <tr key={k}><td className="capitalize">{k.replaceAll("_", " ")}</td><td className="r"><span className={v.passed === v.total ? "" : "font-semibold text-review"}>{v.passed}/{v.total}</span></td>
              <td className={cx("r", v.s0 > 0 && "font-semibold text-escalate")}>{v.s0}</td><td className={cx("r", v.s1 > 0 && "font-semibold text-review")}>{v.s1}</td><td className="r">{v.s2}</td></tr>))}</tbody>
        </Table></div>
      </section>
    </>
  );
}
