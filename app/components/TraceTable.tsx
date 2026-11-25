"use client";
import { usd } from "../lib/format";
import { ASSUMED_PRICES_DATE } from "@/core/prices";
import { Dot, type Status } from "./ui/Dot";
import type { TraceRow } from "../lib/types";
import { Table } from "./ui/Table";
import { cx } from "./ui/cx";

const STAGE: Record<string, string> = {
  pipeline_started: "Pipeline started", budget: "Budget reservation", triage: "Triage", injection_suspected: "Suspected injection", evidence: "Evidence tools", adjudicate: "Clause adjudication", abstention: "Abstention",
  draft: "Draft and verification", semantic_check: "Semantic check", critical_incident: "Critical incident", route: "Route decision",
};
const bad = (o: string) => o.startsWith("failed") || o === "denied" || o === "unsupported" || o === "balance_mismatch";

type Mark = { status: Status; word: string };
/** The outcome as a small mark and a plain word. A rejected draft attempt that was followed by a retry is shown in the review colour: it was caught, not lost. */
export function outcomeMark(e: TraceRow, events: TraceRow[]): Mark {
  const o = e.outcome;
  const attempt = Number((e.payload as { attempt?: number } | null)?.attempt ?? 0);
  if (o.startsWith("rejected:")) return { status: "review", word: `rejected: ${o.slice(9)}${attempt === 1 && events.some((x) => x.stage === "draft" && Number((x.payload as { attempt?: number } | null)?.attempt) === 2) ? ", retried" : ""}` };
  if (o === "accepted" && attempt === 2) return { status: "ready", word: "accepted after retry" };
  if (bad(o)) return { status: "escalate", word: o.replace(":", ": ") };
  if (o === "ok" || o === "accepted" || o === "reserved" || o === "supported") return { status: "ready", word: o };
  return { status: "none", word: o.replaceAll("_", " ") };
}

type ToolRecord = { tool: string; args: unknown; status: string; summary?: string; fact_ids?: string[] };
type LayerRecord = { layer: number; name: string; ok: boolean; skipped?: boolean; issues: string[] };
type Payload = { tools?: ToolRecord[]; layers?: LayerRecord[]; reasons?: string[]; flags?: string[]; fallback?: unknown; intent?: string; language?: string; urgency?: string; suggested_route?: string; suspected_injection?: boolean };

export default function TraceTable({ runId, events, mode }: { runId: string; events: TraceRow[]; mode: string }) {
  const sum = (f: (e: TraceRow) => number) => events.reduce((a, e) => a + f(e), 0);
  const maxMs = Math.max(1, ...events.map((e) => e.latency_ms));
  const totalMs = sum((e) => e.latency_ms);
  const drafts = events.filter((e) => e.stage === "draft").length;
  const attemptOf = (e: TraceRow) => Number((e.payload as { attempt?: number } | null)?.attempt ?? 0);
  const cost = (e: TraceRow) => (e.model === null ? "-" : mode === "mock" ? "free (mock)" : usd(e.cost_micro_usd));
  return (
    <section aria-label="Trace" className="space-y-4">
      <p className="max-w-prose text-sm text-muted">Request <code className="tnum wrap-anywhere text-text">{runId}</code> · {mode} run. Saved events in order. Prompts and model reasoning are never stored or shown; payloads are redacted.</p>
      <Table caption="Pipeline events with stage, outcome, model, latency, tokens and cost" minWidth={720}>
        <thead><tr><th scope="col">#</th><th scope="col">Stage</th><th scope="col">Outcome</th><th scope="col">Model</th><th scope="col" className="w-48">Latency</th><th scope="col" className="r">Tokens in / out</th><th scope="col" className="r">Cost</th></tr></thead>
        <tbody>
          {events.map((e) => {
            const m = outcomeMark(e, events);
            const att = e.stage === "draft" && drafts > 1 ? attemptOf(e) : 0;
            return (
              <tr key={e.seq} id={`trace-${e.seq}`} data-attempt={att || undefined} className={cx(att === 2 && "border-l-2 border-l-review")}>
                <td className="tnum text-faint">{e.seq}</td>
                <td className="font-medium">{STAGE[e.stage] ?? e.stage}{att > 0 && <span className="block text-xs font-normal text-muted">attempt {att} of 2</span>}</td>
                <td className="text-xs"><Dot status={m.status} label={m.word} /></td>
                <td className="font-mono text-xs text-muted">{e.model ?? "-"}</td>
                <td><div className="flex items-center gap-2"><div role="img" aria-label={`${e.latency_ms} milliseconds`} className="h-1 min-w-0 flex-1 bg-bg-subtle"><div className="h-1 bg-accent" style={{ width: `${e.latency_ms ? Math.max(3, Math.round((e.latency_ms / maxMs) * 100)) : 0}%` }} /></div><span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-muted">{e.latency_ms ? `${e.latency_ms} ms` : "-"}</span></div></td>
                <td className="r font-mono text-xs tabular-nums">{e.tokens_in || e.tokens_out ? `${e.tokens_in} / ${e.tokens_out}` : "-"}</td>
                <td className="r font-mono text-xs tabular-nums">{cost(e)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr><td colSpan={4}>Total · {events.length} events</td>
            <td><div className="flex items-center gap-2"><div role="img" aria-label={`${totalMs} milliseconds in total`} className="h-0.5 min-w-0 flex-1 bg-text/60" /><span className="w-16 shrink-0 text-right font-mono text-xs font-normal tabular-nums text-muted">{totalMs} ms</span></div></td>
            <td className="r font-mono text-xs tabular-nums">{sum((e) => e.tokens_in)} / {sum((e) => e.tokens_out)}</td>
            <td className="r font-mono text-xs tabular-nums">{mode === "mock" ? "free (mock)" : usd(sum((e) => e.cost_micro_usd))}</td></tr>
        </tfoot>
      </Table>
      {mode === "live" && <p className="max-w-prose text-sm text-muted">Costs are estimates from assumed list prices dated {ASSUMED_PRICES_DATE}, not billing. Set <code>LLM_PRICES_JSON</code> to use your own. A model with no price is counted at a deliberately high rate so the daily budget still holds.</p>}
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
