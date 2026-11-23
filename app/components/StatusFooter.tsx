"use client";
import { useEffect, useRef, useState } from "react";
import { useStatus } from "../lib/useStatus";
import ThemeToggle from "./ThemeToggle";
import { Dot, type Status } from "./ui/Dot";
import { cx } from "./ui/cx";
import { isDev } from "@/core/dev";

const MODE: Record<string, string> = { live: "Live", replay: "Replay", mock: "Mock" };
const MODE_NOTE: Record<string, string> = { live: "Responses come from a live model.", replay: "Replaying recorded real model responses.", mock: "Deterministic mock provider, not a real model." };

/** The single quiet status line: "Synthetic data · Live · model". Detail (demo date, models, limits) opens in a popover.
 *  Nothing here is a banner: environment facts live in one place and a problem shows as a status dot. */
export default function StatusFooter() {
  const { s, err } = useStatus();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);

  const unavailable = s?.models ? [...new Set(Object.values(s.models).filter((m) => m.available === false).map((m) => m.model))] : [];
  const providerProblem = s?.provider_mode === "live" && s.provider !== "reachable" && s.provider !== "model_unavailable" ? s.provider.replaceAll("_", " ") : null;
  const runsLeft = s && s.budget.runs_used !== null ? s.budget.runs_cap - s.budget.runs_used : null;
  const noRuns = runsLeft !== null && runsLeft <= 0;
  const lowRuns = runsLeft !== null && s ? runsLeft > 0 && runsLeft <= Math.ceil(s.budget.runs_cap * 0.1) : false;
  const budgetOut = s?.budget.remaining_micro_usd != null && s.budget.remaining_micro_usd <= 0;
  const problems: string[] = [];
  if (s?.mock_with_key) problems.push("Mock mode is on although a model key is set: set PROVIDER_MODE=live and restart.");
  if (unavailable.length) problems.push(`Model ${unavailable.join(", ")} is not available to this key. Run npm run models.`);
  if (providerProblem) problems.push(`Model provider: ${providerProblem}.`);
  if (noRuns || budgetOut) problems.push(`${budgetOut ? "Daily budget used up." : "Daily run limit reached."} It resets at 00:00 UTC.`);
  else if (lowRuns) problems.push(`${runsLeft} demo runs left today.`);
  const dot: Status = problems.length ? "review" : "ready";
  const draftModel = s?.models?.draft?.model;
  const line = s ? ["Synthetic data", MODE[s.provider_mode], s.provider_mode === "live" ? draftModel : null].filter(Boolean).join(" · ") : err ? "Synthetic data · status unavailable" : "Synthetic data";

  return (
    <footer className={cx("flex min-h-11 shrink-0 items-center gap-2 border-t border-border bg-surface px-3 text-sm text-muted md:min-h-8", isDev() && "pr-16")}>
      <div ref={box} className="relative min-w-0">
        <button type="button" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)} className="t flex min-h-11 min-w-0 items-center gap-2 rounded-md px-1 hover:text-text md:min-h-7">
          {s && <Dot status={dot} />}<span className="truncate" data-testid="status-line">{line}</span>
        </button>
        {open && (
          <div role="dialog" aria-label="Environment details" className={cx("pop absolute bottom-full left-0 z-40 mb-1 w-[min(24rem,calc(100vw-1.5rem))] rounded-lg border border-border bg-raised p-4 text-sm shadow-pop")}>
            <p className="font-semibold text-text">Demo environment</p>
            <p className="mt-0.5">Every resident, lease and payment is synthetic. Nothing is ever sent to a tenant.</p>
            {s ? (
              <dl className="mt-3 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1">
                <dt>Model mode</dt><dd className="text-text">{MODE[s.provider_mode]}{s.provider_backend ? ` · ${s.provider_backend}` : ""}<span className="block text-muted">{MODE_NOTE[s.provider_mode]}</span></dd>
                <dt>Demo date</dt><dd className="tnum text-text">{s.as_of}</dd>
                {s.models && Object.entries(s.models).map(([role, m]) => (
                  <div key={role} className="contents"><dt className="capitalize">{role}</dt><dd className="break-all font-mono text-xs text-text">{m.model} <span className="font-sans text-muted">{m.available === false ? "unavailable" : m.available ? "available" : "unchecked"}</span></dd></div>
                ))}
                <dt>Runs today</dt><dd className="tnum text-text">{s.budget.runs_used ?? "?"} of {s.budget.runs_cap}</dd>
              </dl>
            ) : <p className="mt-3">{err ? "Status could not be loaded." : "Checking…"}</p>}
            {problems.length > 0 && <ul role="status" className="mt-3 space-y-1 border-l-2 border-review-line pl-3 text-text">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          </div>
        )}
      </div>
      {s && <span className="tnum ml-auto hidden shrink-0 sm:inline" title="Leases, balances and due dates are computed as of this fixed date.">Demo date {s.as_of}</span>}
      <span className="ml-auto sm:ml-0"><ThemeToggle /></span>
    </footer>
  );
}
