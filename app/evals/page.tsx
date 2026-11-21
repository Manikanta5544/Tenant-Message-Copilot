import type { CaseResult } from "@/evals/score";
import { latestEvalRuns } from "@/db/runs";
import { ModeChip } from "../components/ModeChip";
import { Card } from "../components/ui/Card";
import { Chip } from "../components/ui/Chip";
import { EmptyState } from "../components/ui/EmptyState";
import { Icon } from "../components/ui/Icon";
import { cx } from "../components/ui/cx";
import { usd } from "../lib/format";

export const dynamic = "force-dynamic";
type Run = Awaited<ReturnType<typeof latestEvalRuns>>[number];
type Cat = { total: number; passed: number; s0: number; s1: number; s2: number };
const SEV_TEXT: Record<string, string> = { S0: "text-escalate", S1: "text-review", S2: "text-muted" };
const MODE_NOTE: Record<string, string> = {
  live: "Live model responses.", replay: "Recorded real model responses replayed.", mock: "Deterministic mock provider. This tests the application's verification, routing and isolation, not any model.",
};
const when = (iso: string | Date) => new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC";

export default async function EvalsPage() {
  let runs: Run[] = [];
  let error = false;
  try { runs = await latestEvalRuns(40); } catch { error = true; }
  // The headline is always the latest critical (tier 1) run, preferring the most trustworthy mode: live, then replay, then mock.
  // Extended (tier 2) runs are informational and never the headline.
  const tierOf = (r: Run) => r.summary.tier ?? 1;
  const critical = runs.filter((r) => tierOf(r) === 1 && r.summary.validity?.valid !== false);
  const latest = ["live", "replay", "mock"].map((m) => critical.find((r) => r.mode === m)).find(Boolean);
  const others = runs.filter((r) => r !== latest).slice(0, 12);
  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-[1100px] space-y-6 px-4 py-6 outline-none">
      <div>
        <h1 className="text-2xl">Evaluation results</h1>
        <p className="mt-1 max-w-2xl text-base text-muted">Saved runs of the golden cases against the real pipeline and database. Scored by severity: one S0 failure fails the build, and S1 failures may not rise against the last saved run.</p>
      </div>
      {error && <EmptyState alert tone="error" icon="alert" title="Saved results could not be loaded">Check the database connection and reload the page.</EmptyState>}
      {!error && !latest && <EmptyState icon="gauge" title="No saved eval run yet">Nothing is shown until a run exists: run <code>npm run eval</code> against a live model (or <code>npm run eval:mock</code> to test the application only).</EmptyState>}
      {latest && <Latest r={latest} />}
      {others.length > 0 && (
        <section aria-label="Other saved runs">
          <h2 className="mb-2 text-lg">Other saved runs</h2>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="border-b border-border text-xs text-muted"><tr><th scope="col" className="p-3 font-medium">When</th><th scope="col" className="font-medium">Mode</th><th scope="col" className="font-medium">Cases</th><th scope="col" className="font-medium">Prompt</th><th scope="col" className="font-medium">Pass</th><th scope="col" className="font-medium">S0</th><th scope="col" className="font-medium">S1</th><th scope="col" className="font-medium">S2</th><th scope="col" className="pr-3 font-medium">Gate</th></tr></thead>
              <tbody>{others.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="num p-3">{when(r.created_at)}</td><td>{r.mode}</td><td>{tierOf(r) === 1 ? "critical" : "extended (informational)"}</td><td>{r.prompt_version}</td>
                  <td className="num">{r.summary.passed}/{r.summary.total}</td><td className="num">{r.summary.s0_cases}</td><td className="num">{r.summary.s1_cases}</td><td className="num">{r.summary.s2_cases}</td>
                  <td className="pr-3"><Chip tone={r.summary.gate?.ok ? "ready" : "escalate"} icon={r.summary.gate?.ok ? "check" : "x"}>{r.summary.gate?.ok ? "Pass" : "Fail"}</Chip></td>
                </tr>))}</tbody>
            </table>
          </Card>
        </section>
      )}
    </main>
  );
}

function Latest({ r }: { r: Run }) {
  const s = r.summary, results = r.results as CaseResult[];
  const failed = results.filter((x) => !x.pass);
  const ok = !!s.gate?.ok;
  const tiles: [string, string | number, string?][] = [
    ["Cases", s.total], ["Passed", s.passed], ["S0 critical", s.s0_cases, s.s0_cases > 0 ? "text-escalate" : ""], ["S1 serious", s.s1_cases, s.s1_cases > 0 ? "text-review" : ""], ["S2 quality", s.s2_cases],
    ["Latency p50 / p95", `${s.latency_ms.p50} / ${s.latency_ms.p95} ms`], ["Cost", usd(s.cost_micro_usd.total)],
  ];
  return (
    <>
      <Card as="section" aria-label="Gate result" className={cx("overflow-hidden border-l-4 p-5", ok ? "border-l-ready-line" : "border-l-escalate-line")}>
        <div className="flex flex-wrap items-center gap-3">
          <span className={cx("grid size-12 place-items-center rounded-full", ok ? "bg-ready-bg text-ready" : "bg-escalate-bg text-escalate")}><Icon name={ok ? "shield" : "ban"} size={24} /></span>
          <div>
            <h2 className={cx("text-2xl", ok ? "text-ready" : "text-escalate")}>Gate {ok ? "PASS" : "FAIL"}</h2>
            <p className="text-base text-muted">Critical cases, latest run · {s.passed} of {s.total} passed</p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2"><ModeChip mode={r.mode} /><Chip>prompt {r.prompt_version}</Chip>{r.git_commit && <Chip>commit {r.git_commit}</Chip>}</div>
        </div>
        {!ok && (s.gate?.reasons ?? []).length > 0 && <ul className="mt-3 list-disc space-y-0.5 pl-5 text-base text-escalate">{(s.gate.reasons as string[]).map((x, i) => <li key={i}>{x}</li>)}</ul>}
        <p className="num mt-3 text-sm text-muted">{when(r.created_at)} · as of {s.as_of} · {s.previous_s1_cases !== null && s.previous_s1_cases !== undefined ? `previous saved S1: ${s.previous_s1_cases}` : "no earlier run of this mode to compare"}</p>
        <p className="mt-1 text-sm text-muted">{MODE_NOTE[r.mode]}</p>
      </Card>

      <section aria-label="Key figures">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {tiles.map(([k, v, cls]) => <Card key={k} className="p-3"><dt className="text-sm text-muted">{k}</dt><dd className={cx("num mt-0.5 text-xl font-semibold", cls)}>{v}</dd></Card>)}
        </dl>
      </section>

      <section aria-label="By category">
        <h2 className="mb-2 text-lg">By category</h2>
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="border-b border-border text-xs text-muted"><tr><th scope="col" className="p-3 font-medium">Category</th><th scope="col" className="font-medium">Passed</th><th scope="col" className="font-medium">S0</th><th scope="col" className="font-medium">S1</th><th scope="col" className="pr-3 font-medium">S2</th></tr></thead>
            <tbody>{Object.entries(s.by_category as Record<string, Cat>).map(([k, v]) => (
              <tr key={k} className="border-b border-border last:border-0">
                <td className="p-3 capitalize">{k.replaceAll("_", " ")}</td>
                <td className="num"><span className={v.passed === v.total ? "text-ready" : "text-review"}>{v.passed}/{v.total}</span></td>
                <td className={cx("num", v.s0 > 0 && "font-semibold text-escalate")}>{v.s0}</td><td className={cx("num", v.s1 > 0 && "font-semibold text-review")}>{v.s1}</td><td className="num pr-3">{v.s2}</td>
              </tr>))}</tbody>
          </table>
        </Card>
      </section>

      <section aria-label="Failed cases">
        <h2 className="mb-2 text-lg">Failed cases ({failed.length})</h2>
        {failed.length === 0 ? <Card className="p-4 text-base text-muted">Every case in this run passed.</Card> : (
          <ul className="space-y-2">{failed.map((x) => (
            <li key={x.id}>
              <Card as="div" className="overflow-hidden">
                <details className="group">
                  <summary className="t flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-bg-subtle">
                    <b className="mono text-base">{x.id}</b>
                    <span className="text-sm text-muted capitalize">{x.category.replaceAll("_", " ")} · unit {x.unit}</span>
                    {[...new Set(x.failures.map((f) => f.severity))].map((sv) => <Chip key={sv} tone={sv === "S0" ? "escalate" : sv === "S1" ? "review" : "neutral"}>{sv}</Chip>)}
                    <Icon name="chevron" size={14} className="ml-auto text-faint transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="border-t border-border px-4 py-3 text-sm">
                    <p className="text-muted">Expected {x.route_expected}, got {x.route_actual}</p>
                    <ul className="mt-2 space-y-1">{x.failures.map((f, i) => <li key={i}><b className={SEV_TEXT[f.severity]}>{f.severity}</b> <span className="mono text-xs">{f.code}</span>: <span className="text-muted">{f.detail}</span></li>)}</ul>
                  </div>
                </details>
              </Card>
            </li>))}</ul>)}
      </section>
    </>
  );
}
