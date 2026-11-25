"use client";
import { useEffect, useState } from "react";
import type { SystemStats } from "@/db/system";
import { Dot } from "../components/ui/Dot";
import { Table } from "../components/ui/Table";
import { ROUTE_LABEL, usd } from "../lib/format";

const ms = (n: number | null) => (n === null ? "-" : n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`);
const pct = (n: number | null) => (n === null ? "-" : `${(n * 100).toFixed(1)}%`);

function Row({ k, v, note }: { k: string; v: React.ReactNode; note?: string }) {
  return <div className="flex min-w-0 items-baseline justify-between gap-4 border-b border-border py-2"><dt className="min-w-0 text-muted">{k}{note && <span className="ml-2 text-sm text-faint">{note}</span>}</dt><dd className="font-mono tabular-nums">{v}</dd></div>;
}

export default function SystemLive() {
  const [s, setS] = useState<SystemStats | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true; let t: ReturnType<typeof setTimeout>;
    const load = async () => {
      if (!document.hidden) {
        try { const r = await fetch("/api/system"); if (!r.ok) throw new Error(); const j = (await r.json()) as SystemStats; if (alive) { setS(j); setErr(false); } } catch { if (alive) setErr(true); }
      }
      if (alive) t = setTimeout(load, 5000);
    };
    void load();
    return () => { alive = false; clearTimeout(t); };
  }, []);
  if (!s) return <p className="mt-8 text-muted" role="status">{err ? "System numbers could not be loaded. Check that the database is running." : "Loading…"}</p>;
  const mixTotal = Object.values(s.route_mix_1h).reduce((a, b) => a + b, 0);
  const h = s.provider.rate_headroom;
  const budgetPct = s.budget.cap_micro_usd ? Math.round((s.budget.used_micro_usd / s.budget.cap_micro_usd) * 100) : 0;
  return (
    <div className="mt-6 space-y-8" aria-live="off">
      {err && <p className="text-sm text-review" role="status">Showing the last numbers received; the latest refresh failed.</p>}
      <section aria-labelledby="runs-h">
        <h2 id="runs-h" className="text-lg">Runs</h2>
        <dl className="mt-2">
          <Row k="Last 15 minutes" v={s.window.runs_15m} />
          <Row k="Last hour" v={s.window.runs_1h} note={s.window.failed_1h ? `${s.window.failed_1h} failed` : undefined} />
          <Row k="End to end, median" v={ms(s.end_to_end_ms.p50)} note={`${s.end_to_end_ms.n} completed`} />
          <Row k="End to end, 95th percentile" v={ms(s.end_to_end_ms.p95)} />
          <Row k="Drafted twice (retry rate)" v={pct(s.retry.rate)} note={`${s.retry.retried} of ${s.retry.runs}`} />
        </dl>
        {mixTotal > 0 && (
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-label="Route mix, last hour">
            {Object.entries(s.route_mix_1h).map(([r, n]) => <li key={r} className="flex items-center gap-2"><Dot status={r === "draft_ready" ? "ready" : r === "needs_review" ? "review" : "escalate"} /><span>{ROUTE_LABEL[r] ?? r}</span><span className="font-mono tabular-nums text-muted">{n} ({Math.round((n / mixTotal) * 100)}%)</span></li>)}
          </ul>
        )}
      </section>

      <section aria-labelledby="stage-h">
        <h2 id="stage-h" className="text-lg">Latency by stage</h2>
        {s.stages_ms.length === 0 ? <p className="mt-2 text-muted">No runs in the last hour.</p> : (
          <Table caption="Per-stage latency over the last hour" minWidth={420}>
            <thead><tr><th scope="col">Stage</th><th scope="col" className="text-right">Count</th><th scope="col" className="text-right">Median</th><th scope="col" className="text-right">95th percentile</th></tr></thead>
            <tbody>{s.stages_ms.map((x) => <tr key={x.stage}><th scope="row" className="font-normal">{x.stage.replaceAll("_", " ")}</th><td className="text-right font-mono tabular-nums">{x.n}</td><td className="text-right font-mono tabular-nums">{ms(x.p50)}</td><td className="text-right font-mono tabular-nums">{ms(x.p95)}</td></tr>)}</tbody>
          </Table>
        )}
      </section>

      <section aria-labelledby="prov-h">
        <h2 id="prov-h" className="text-lg">Model provider</h2>
        <dl className="mt-2">
          <Row k="Mode" v={s.provider.mode} />
          <Row k="Model calls, last hour" v={s.provider.model_calls_1h} note={s.provider.failed_calls_1h ? `${s.provider.failed_calls_1h} failed (${pct(s.provider.failure_rate)})` : undefined} />
          <Row k="Calls in flight" v={`${s.provider.concurrency.active} of ${s.provider.concurrency.max}`} note={s.provider.concurrency.waiting ? `${s.provider.concurrency.waiting} waiting` : undefined} />
          <Row k="Turned away as busy, last hour" v={s.provider.busy_1h} />
          <Row k="Queue wait, 95th percentile" v={ms(s.provider.concurrency.wait_p95_ms)} />
          <Row k="Provider requests remaining" v={h?.remaining_requests ?? "not reported"} />
          <Row k="Provider tokens remaining" v={h?.remaining_tokens != null ? `${h.remaining_tokens}${h.limit_tokens ? ` of ${h.limit_tokens}` : ""}` : "not reported"} note={h ? `seen ${h.seen_s_ago} s ago${h.reset_tokens ? `, resets in ${h.reset_tokens}` : ""}` : undefined} />
        </dl>
      </section>

      <section aria-labelledby="bud-h">
        <h2 id="bud-h" className="text-lg">Budget and limits</h2>
        <dl className="mt-2">
          <Row k={`Budget used today (${s.budget.day} UTC)`} v={`${usd(s.budget.used_micro_usd)} of ${usd(s.budget.cap_micro_usd)}`} note={`${budgetPct}%`} />
          <Row k="Budget remaining" v={usd(s.budget.remaining_micro_usd)} />
          <Row k="Runs today" v={`${s.budget.runs_used} of ${s.budget.runs_cap}`} />
          <Row k="Rate-limit rejections, last hour" v={s.limits.rate_limited_1h} note="this server instance" />
          <Row k="Live streams open" v={s.limits.streams_open} note={s.limits.stream_cap_1h ? `${s.limits.stream_cap_1h} refused at the cap` : undefined} />
        </dl>
      </section>
      <p className="text-sm text-faint">Updated {new Date(s.generated_at).toLocaleTimeString()}. Counters marked "this server instance" reset on restart.</p>
    </div>
  );
}
