"use client";
import { usd } from "../lib/format";
import type { TraceRow } from "../lib/types";
import { Table } from "./ui/Table";
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
    <section aria-label="Trace" className="space-y-4">
      <p className="max-w-prose text-sm text-muted">Request <code className="tnum text-text">{runId}</code> · {mode} run. Saved events in order. Prompts and model reasoning are never stored or shown; payloads are redacted.</p>
      <Table caption="Pipeline events with stage, outcome, model, latency, tokens and cost" minWidth={720}>
        <thead><tr><th scope="col">#</th><th scope="col">Stage</th><th scope="col">Outcome</th><th scope="col">Model</th><th scope="col" className="w-44">Latency</th><th scope="col" className="r">Tokens in / out</th><th scope="col" className="r">Cost</th></tr></thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.seq}>
              <td className="tnum text-faint">{e.seq}</td>
              <td className="font-medium">{STAGE[e.stage] ?? e.stage}</td>
              <td className={cx("font-mono text-xs", bad(e.outcome) ? "text-escalate" : good(e.outcome) ? "text-ready" : "text-muted")}>{e.outcome}</td>
              <td className="font-mono text-xs text-muted">{e.model ?? "–"}</td>
              <td><div className="flex items-center gap-2"><div role="img" aria-label={`${e.latency_ms} milliseconds`} className="h-1 flex-1 bg-bg-subtle"><div className="h-1 bg-accent" style={{ width: `${Math.max(e.latency_ms ? 3 : 0, Math.round((e.latency_ms / maxMs) * 100))}%` }} /></div><span className="w-14 text-right font-mono text-xs text-muted">{e.latency_ms ? `${e.latency_ms} ms` : "–"}</span></div></td>
              <td className="r font-mono text-xs">{e.tokens_in || e.tokens_out ? `${e.tokens_in} / ${e.tokens_out}` : "–"}</td>
              <td className="r font-mono text-xs">{e.cost_micro_usd ? usd(e.cost_micro_usd) : "–"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={4}>Total · {events.length} events</td><td className="font-mono text-xs font-normal text-muted" aria-label="slowest step">{events.reduce((a, e) => a + e.latency_ms, 0)} ms · max {maxMs} ms</td><td className="r font-mono text-xs">{sum((e) => e.tokens_in)} / {sum((e) => e.tokens_out)}</td><td className="r font-mono text-xs">{usd(sum((e) => e.cost_micro_usd))}</td></tr></tfoot>
      </Table>
      <h3 className="label-caps pt-2">Step details</h3>
      <ol className="divide-y divide-border border-y border-border">
        {events.map((e) => {
          const p = (e.payload ?? {}) as Payload;
          const tools = p.tools ?? [];
          const any = tools.length > 0 || !!p.layers || (e.stage === "route" && !!p.reasons) || !!p.fallback || (e.stage === "triage" && !!p.intent);
          if (!any) return null;
          return (
            <li key={e.seq} className="py-2 text-sm">
              <p className="font-medium"><span className="tnum mr-2 text-faint">{e.seq}</span>{STAGE[e.stage] ?? e.stage}</p>
              {tools.length > 0 && <ul className="mt-1 space-y-1 pl-5 text-xs">{tools.map((t, i) => <li key={i}><code className="font-semibold">{t.tool}</code>({JSON.stringify(t.args)}) <span className={t.status === "ok" ? "text-ready" : "text-escalate"}>{t.status}</span> <span className="text-muted">{t.summary}{t.fact_ids?.length ? ` → ${t.fact_ids.join(", ")}` : ""}</span></li>)}</ul>}
              {p.layers && <ul className="mt-1 space-y-0.5 pl-5 text-xs">{p.layers.map((l) => <li key={l.layer}><span className={l.ok ? "text-ready" : "text-escalate"}>{l.ok ? "ok" : "failed"}</span> <span className="text-muted">L{l.layer} {l.name}{l.ok ? "" : `: ${l.issues.join("; ")}`}</span></li>)}</ul>}
              {e.stage === "route" && p.reasons && <p className="mt-1 pl-5 text-xs text-muted">{p.reasons.join(" · ") || "No raising signals"}{p.flags?.length ? ` | flags: ${p.flags.join(", ")}` : ""}</p>}
              {p.fallback != null && <p className="mt-1 pl-5 text-xs text-escalate">Fallback: {String(p.fallback)}</p>}
              {e.stage === "triage" && p.intent && <p className="mt-1 pl-5 text-xs text-muted">language {p.language} · intent {p.intent} · urgency {p.urgency} · model suggested {p.suggested_route}{p.suspected_injection ? " · injection suspected" : ""}</p>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
