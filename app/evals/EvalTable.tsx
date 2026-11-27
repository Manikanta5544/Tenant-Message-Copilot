"use client";
import { Fragment, useMemo, useState } from "react";
import type { CaseResult } from "@/evals/score";
import { Dot, type Status } from "../components/ui/Dot";
import { Icon } from "../components/ui/Icon";
import { cx } from "../components/ui/cx";

type SortKey = "id" | "category" | "severity" | "latency";
const RANK: Record<string, number> = { S0: 0, S1: 1, S2: 2, pass: 3 };
const worst = (r: CaseResult) => (r.failures.length ? ([...r.failures].sort((a, b) => RANK[a.severity]! - RANK[b.severity]!)[0]!.severity as string) : "pass");
const DOT: Record<string, { status: Status; label: string }> = { pass: { status: "ready", label: "Pass" }, S0: { status: "escalate", label: "S0 critical" }, S1: { status: "review", label: "S1 serious" }, S2: { status: "none", label: "S2 quality" } };

/** All golden cases, sortable. A failed case expands to expected versus actual and the failures that were scored. */
export default function EvalTable({ results }: { results: CaseResult[] }) {
  const [key, setKey] = useState<SortKey>("severity");
  const [dir, setDir] = useState<1 | -1>(1);
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(() => {
    const v = (r: CaseResult) => (key === "id" ? r.id : key === "category" ? r.category : key === "latency" ? r.latency_ms : RANK[worst(r)]!);
    return [...results].sort((a, b) => { const x = v(a), y = v(b); return (x < y ? -1 : x > y ? 1 : a.id.localeCompare(b.id)) * dir; });
  }, [results, key, dir]);
  const head = (k: SortKey, label: string, cls?: string) => (
    <th scope="col" aria-sort={key === k ? (dir === 1 ? "ascending" : "descending") : "none"} className={cls}>
      <button type="button" onClick={() => { if (key === k) setDir((d) => (d === 1 ? -1 : 1)); else { setKey(k); setDir(1); } }} className="t inline-flex min-h-11 items-center gap-1 uppercase tracking-[0.04em] hover:text-text md:min-h-7">
        {label}<span aria-hidden className="w-2 text-text">{key === k ? (dir === 1 ? "↑" : "↓") : ""}</span>
      </button>
    </th>
  );
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Golden cases">
      <table className="tbl" style={{ minWidth: 640 }}>
        <caption className="sr-only">Every golden case in the latest critical run. Sort by clicking a column heading.</caption>
        <thead><tr>{head("id", "Case")}{head("category", "Category")}<th scope="col">Route expected → actual</th>{head("severity", "Result")}{head("latency", "Latency", "r")}</tr></thead>
        <tbody>
          {rows.map((r) => {
            const w = worst(r), d = DOT[w]!, isOpen = open === r.id, failed = !r.pass;
            return (
              <Fragment key={r.id}>
                <tr className={cx(failed && "bg-bg-subtle")}>
                  <td className="font-mono text-xs">
                    {failed
                      ? <button type="button" aria-expanded={isOpen} aria-controls={`case-${r.id}`} onClick={() => setOpen(isOpen ? null : r.id)} className="t inline-flex min-h-11 items-center gap-1.5 font-mono text-xs font-semibold underline underline-offset-4 md:min-h-6"><Icon name="chevron" size={12} className={cx("t", isOpen && "rotate-180")} />{r.id}</button>
                      : r.id}
                  </td>
                  <td className="capitalize">{r.category.replaceAll("_", " ")}</td>
                  <td className="font-mono text-xs">{r.route_expected} → {r.route_actual}</td>
                  <td><Dot status={d.status} label={d.label} /></td>
                  <td className="r font-mono text-xs">{r.latency_ms} ms</td>
                </tr>
                {failed && isOpen && (
                  <tr id={`case-${r.id}`}><td colSpan={5} className="bg-bg-subtle">
                    <div className="grid gap-4 py-2 md:grid-cols-2">
                      <div>
                        <p className="label-caps mb-1">Expected versus actual</p>
                        <table className="tbl"><thead><tr><th scope="col">Field</th><th scope="col">Expected</th><th scope="col">Actual</th></tr></thead><tbody>
                          {([["Route", r.route_expected, r.route_actual], ["Language", r.language_expected, r.language_actual]] as const).map(([f, e, a]) => (
                            <tr key={f}><td>{f}</td><td className="font-mono text-xs">{e}</td><td className={cx("font-mono text-xs", e !== a && "font-semibold text-escalate")}>{a}{e !== a ? " ✕" : ""}</td></tr>))}
                        </tbody></table>
                      </div>
                      <div>
                        <p className="label-caps mb-1">Failures</p>
                        <ul className="space-y-1 text-sm">{r.failures.map((f, i) => <li key={i}><b className={f.severity === "S0" ? "text-escalate" : f.severity === "S1" ? "text-review" : "text-muted"}>{f.severity}</b> <span className="font-mono text-xs">{f.code}</span> <span className="text-muted">{f.detail}</span></li>)}</ul>
                      </div>
                    </div>
                  </td></tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
