import Link from "next/link";
import type { InboxRow } from "../lib/types";
import { Dot, statusOf } from "./ui/Dot";
import { Kbd } from "./ui/Kbd";

export interface OverviewFacts {
  eval: { passed: number; total: number; gate_ok: boolean; mode: string; prompt_version: string; at: string } | null;
  model: { mode: "live" | "replay" | "mock"; name: string };
}

// One promise per scenario, in the order a first-time reviewer should open them.
const SCENARIOS: { label: string; line: string }[] = [
  { label: "Scenario 1", line: "A tenant reports a dripping tap; the reply cites the maintenance clause." },
  { label: "Scenario 2", line: "A tenant says they paid; the ledger disagrees." },
  { label: "Scenario 3", line: "A tenant asks if a cat is allowed; the reply quotes the lease." },
  { label: "Scenario 4", line: "A Hinglish message about a payment that still shows pending." },
  { label: "Scenario 5", line: "A message tries to extract another resident's balance." },
];
const MODE_WORD = { live: "Live", replay: "Replay", mock: "Mock" } as const;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** The first thing in the detail pane: what needs a person, how the last evaluation went, which model answers, and a guided walkthrough.
 *  Plain text and a few links, no illustration. */
export default function Overview({ rows, facts, onSelect }: { rows: InboxRow[]; facts?: OverviewFacts; onSelect: (r: InboxRow) => void }) {
  const n = { ready: 0, needs: 0, none: 0 };
  for (const r of rows) { const s = statusOf(r.run?.route); if (s === "ready") n.ready++; else if (s === "none") n.none++; else n.needs++; }
  const open = (label: string) => { const r = rows.find((x) => x.scenario_label === label); if (r) onSelect(r); };
  const ev = facts?.eval;
  return (
    <div className="max-w-2xl px-6 py-8">
      <h2 className="text-lg">Today</h2>
      <dl className="mt-3 grid grid-cols-3 gap-x-6 border-y border-border py-3 text-base">
        <div><dt className="flex items-center gap-1.5 text-muted"><Dot status="review" />Needs you</dt><dd className="tnum mt-0.5 text-xl font-medium">{n.needs}</dd></div>
        <div><dt className="flex items-center gap-1.5 text-muted"><Dot status="ready" />Ready</dt><dd className="tnum mt-0.5 text-xl font-medium">{n.ready}</dd></div>
        <div><dt className="flex items-center gap-1.5 text-muted"><Dot status="none" />Unprocessed</dt><dd className="tnum mt-0.5 text-xl font-medium">{n.none}</dd></div>
      </dl>
      <p className="mt-3 text-base">
        <span className="text-muted">Last eval gate </span>
        {ev ? <Link href="/evals" className="font-medium text-accent underline underline-offset-4">{ev.gate_ok ? "Pass" : "Fail"} {ev.passed}/{ev.total}</Link> : <Link href="/evals" className="text-accent underline underline-offset-4">no run yet</Link>}
        {ev && <span className="text-muted"> ({ev.mode}, prompt {ev.prompt_version}, {day(ev.at)})</span>}
      </p>
      {facts && <p className="mt-1 text-base"><span className="text-muted">Model </span>{facts.model.name} <span className="text-muted">({MODE_WORD[facts.model.mode]})</span></p>}
      <p className="mt-1 text-sm text-muted">Every reply is a draft for a property manager. Nothing is ever sent to a tenant. All residents, leases and payments are synthetic.</p>

      <h3 className="mt-7 text-base">Start with Scenario 2 (payment mismatch)</h3>
      <p className="mt-1 text-base text-muted">It shows the whole path: the claim is checked against the ledger, the draft quotes only verified values, and the route asks for review.</p>
      <ol className="mt-3 space-y-1 text-base">
        {SCENARIOS.map((s, i) => rows.some((r) => r.scenario_label === s.label) && (
          <li key={s.label} className="flex gap-2">
            <span className="tnum w-4 shrink-0 text-right text-muted">{i + 1}.</span>
            <button type="button" onClick={() => open(s.label)} className="t -my-0.5 min-h-8 rounded px-1 text-left hover:bg-bg-subtle focus-visible:bg-bg-subtle">
              <span className="text-accent underline decoration-accent/40 underline-offset-2">{s.line}</span>
            </button>
          </li>
        ))}
      </ol>

      <p className="mt-7 text-sm text-muted max-md:hidden"><Kbd>j</Kbd> <Kbd>k</Kbd> move, <Kbd>Enter</Kbd> opens, <Kbd>/</Kbd> searches, <Kbd>?</Kbd> lists every shortcut.</p>
    </div>
  );
}
