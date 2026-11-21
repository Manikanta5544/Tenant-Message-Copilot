"use client";
import { usd } from "../lib/format";
import type { TraceRow } from "../lib/types";
import { Card } from "./ui/Card";
import { cx } from "./ui/cx";

const STAGE: Record<string, string> = {
  pipeline_started: "Pipeline started", budget: "Budget reservation", triage: "Triage", injection_suspected: "Suspected injection", evidence: "Evidence tools", adjudicate: "Clause adjudication", abstention: "Abstention",
  draft: "Draft and verification", semantic_check: "Semantic check", critical_incident: "Critical incident", route: "Route decision",
};
const bad = (o: string) => o.startsWith("failed") || o.startsWith("rejected") || o === "denied" || o === "unsupported" || o === "balance_mismatch";
const good = (o: string) => o === "ok" || o === "accepted" || o === "reserved" || o === "supported";

type ToolRecord = { tool: string; args: unknown; status: string; summary?: string; fact_ids?: string[] };
type LayerRecord = { layer: number; name: string; ok: boolean; skipped?: boolean; issues: string[] };
type Payload = { tools?: ToolRecord[]; layers?: LayerRecord[]; reasons?: string[]; flags?: string[]; fallback?: unknown; intent?: string; language?: string; urgency?: string; suggested_route?: string; suspected_injection?: boolean };

export default function TraceTable({ runId, events, mode }: { runId: string; events: TraceRow[]; mode: string }) {
  const sum = (f: (e: TraceRow) => number) => events.reduce((a, e) => a + f(e), 0);
  const maxMs = Math.max(1, ...events.map((e) => e.latency_ms));
  return (
    <section aria-label="Trace" className="space-y-3">
      <p className="text-sm text-muted">Request <code className="num rounded bg-bg-subtle px-1.5 py-0.5 text-xs text-text">{runId}</code> · mode {mode}. Saved events in order. Prompts and model reasoning are never stored or shown; payloads are redacted.</p>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <caption className="sr-only">Pipeline events with stage, outcome, model, latency, tokens and cost</caption>
          <thead className="border-b border-border text-xs text-muted">
            <tr><th scope="col" className="w-10 px-3 py-2 font-medium">#</th><th scope="col" className="px-2 font-medium">Stage</th><th scope="col" className="px-2 font-medium">Outcome</th><th scope="col" className="px-2 font-medium">Model</th><th scope="col" className="w-40 px-2 font-medium">Latency</th><th scope="col" className="px-2 text-right font-medium">Tokens in / out</th><th scope="col" className="px-3 text-right font-medium">Cost</th></tr>
          </thead>
          <tbody>
            {events.map((e) => {
              return (
                <tr key={e.seq} className="border-b border-border align-top last:border-0">
                  <td className="num px-3 py-2 text-faint">{e.seq}</td>
                  <td className="px-2 py-2 font-medium">{STAGE[e.stage] ?? e.stage}</td>
                  <td className={cx("mono px-2 py-2 text-xs", bad(e.outcome) ? "text-escalate" : good(e.outcome) ? "text-ready" : "text-muted")}>{e.outcome}</td>
                  <td className="mono px-2 py-2 text-xs text-muted">{e.model ?? "–"}</td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2"><div role="img" aria-label={`${e.latency_ms} milliseconds`} className="h-2 flex-1 rounded-full bg-bg-subtle"><div className="h-2 rounded-full bg-accent" style={{ width: `${Math.max(e.latency_ms ? 4 : 0, Math.round((e.latency_ms / maxMs) * 100))}%` }} /></div><span className="num mono w-14 text-right text-xs text-muted">{e.latency_ms ? `${e.latency_ms} ms` : "–"}</span></div>
                  </td>
                  <td className="num mono px-2 py-2 text-right text-xs">{e.tokens_in || e.tokens_out ? `${e.tokens_in} / ${e.tokens_out}` : "–"}</td>
                  <td className="num mono px-3 py-2 text-right text-xs">{e.cost_micro_usd ? usd(e.cost_micro_usd) : "–"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-border bg-bg-subtle text-xs font-semibold">
            <tr><td className="px-3 py-2" colSpan={4}>Total · {events.length} events</td><td className="num mono px-2 text-right font-normal text-muted" aria-label="slowest step">max {maxMs} ms</td><td className="num mono px-2 text-right">{sum((e) => e.tokens_in)} / {sum((e) => e.tokens_out)}</td><td className="num mono px-3 text-right">{usd(sum((e) => e.cost_micro_usd))}</td></tr>
          </tfoot>
        </table>
      </Card>
      <h3 className="pt-2 text-lg">Step details</h3>
      <ol className="space-y-2">
        {events.map((e) => {
          const p = (e.payload ?? {}) as Payload;
          const tools = p.tools ?? [];
          const any = tools.length > 0 || !!p.layers || (e.stage === "route" && !!p.reasons) || !!p.fallback || (e.stage === "triage" && !!p.intent);
          if (!any) return null;
          return (
            <li key={e.seq}>
              <Card className="p-3 text-sm">
                <p className="font-medium"><span className="num mr-2 text-faint">{e.seq}</span>{STAGE[e.stage] ?? e.stage}</p>
                {tools.length > 0 && <ul className="mt-2 space-y-1 text-xs">{tools.map((t, i) => <li key={i}><code className="font-semibold">{t.tool}</code>({JSON.stringify(t.args)}) <span className={t.status === "ok" ? "text-ready" : "text-escalate"}>{t.status}</span> <span className="text-muted">{t.summary}{t.fact_ids?.length ? ` → ${t.fact_ids.join(", ")}` : ""}</span></li>)}</ul>}
                {p.layers && <ul className="mt-2 flex flex-wrap gap-1.5 text-xs">{p.layers.map((l) => <li key={l.layer} className={cx("rounded-full border px-2 py-0.5", l.ok ? "border-ready-line bg-ready-bg text-ready" : "border-escalate-line bg-escalate-bg text-escalate")}>L{l.layer} {l.name}: {l.ok ? "ok" : l.issues.join("; ")}</li>)}</ul>}
                {e.stage === "route" && p.reasons && <p className="mt-2 text-xs text-muted">{p.reasons.join(" · ") || "No raising signals"}{p.flags?.length ? ` | flags: ${p.flags.join(", ")}` : ""}</p>}
                {p.fallback != null && <p className="mt-2 text-xs text-escalate">Fallback: {String(p.fallback)}</p>}
                {e.stage === "triage" && p.intent && <p className="mt-2 text-xs text-muted">language {p.language} · intent {p.intent} · urgency {p.urgency} · model suggested {p.suggested_route}{p.suspected_injection ? " · injection suspected" : ""}</p>}
              </Card>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
