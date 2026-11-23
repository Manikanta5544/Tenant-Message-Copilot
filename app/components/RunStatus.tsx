import type { RunState } from "../lib/run-state";
import { Button } from "./ui/Button";
import { EmptyState } from "./ui/EmptyState";
import { Icon } from "./ui/Icon";
import { Skeleton } from "./ui/Skeleton";
import { cx } from "./ui/cx";

// Stages a run passes through, in order, with the trace stage that marks each as done.
// Stages a run passes through, in order, with the trace stage that marks each as done.
const STEPS = [
  { stage: "triage", label: "Read the message" },
  { stage: "evidence", label: "Gather evidence" },
  { stage: "draft", label: "Draft and verify" },
  { stage: "route", label: "Decide the route" },
];

/** Idle, loading and error states of the detail pane. Loading is a skeleton shaped like the strip and letter, with live progress text. */
export default function RunStatus({ state, onGenerate }: { state: Exclude<RunState, { status: "ready" }>; onGenerate: () => void }) {
  if (state.status === "idle") {
    return (
      <EmptyState title="No draft yet for this message" action={<Button variant="primary" onClick={onGenerate}>Generate draft</Button>}>
        <p>Generating reads this resident's lease and ledger, drafts a reply and checks it. Nothing is sent.</p>
      </EmptyState>
    );
  }
  if (state.status === "error") {
    return (
      <EmptyState alert tone="error" title={state.message} reference={state.reference} action={<Button onClick={onGenerate}><Icon name="refresh" size={13} />Generate again</Button>}>
        {state.hint && <p className="font-mono text-sm text-text">{state.hint}</p>}
        <p>Nothing was sent to the tenant.</p>
      </EmptyState>
    );
  }
  if (!state.live) {
    // A stored run is just being fetched: show the shape of the page (strip, tabs, letter lines), never a pipeline that is not running.
    return (
      <div aria-busy="true" role="status">
        <span className="sr-only">Loading</span>
        <div aria-hidden>
          <Skeleton className="h-10 w-full" />
          <div className="mt-4 flex gap-4">{[56, 72, 64].map((w, i) => <Skeleton key={i} className="h-4" style={{ width: w }} />)}</div>
          <div className="mt-5 max-w-[62ch] space-y-2.5">{[100, 96, 88, 100, 70].map((w, i) => <Skeleton key={i} className="h-3.5" style={{ width: `${w}%` }} />)}</div>
        </div>
      </div>
    );
  }
  const seen = new Set(state.steps ?? []);
  const current = STEPS.findIndex((s) => !seen.has(s.stage));
  return (
    <div>
      <div role="status" aria-live="polite">
        <p className="text-base font-medium">{state.label}</p>
        <ol className="mt-2 flex flex-wrap gap-x-5 gap-y-1" aria-label="Progress">
          {STEPS.map((s, i) => {
            const done = seen.has(s.stage), active = i === current;
            return <li key={s.stage} aria-current={active ? "step" : undefined} className={cx("flex items-center gap-1.5 text-sm", done ? "text-ready" : active ? "font-medium text-text" : "text-faint")}>{done ? <Icon name="check" size={13} /> : <span className="tnum w-3.5 text-center">{i + 1}</span>}{s.label}</li>;
          })}
        </ol>
      </div>
      <div aria-hidden className="mt-4"><Skeleton className="h-10 w-full" /><div className="mt-5 max-w-[62ch] space-y-2.5">{[100, 96, 88, 100, 70].map((w, i) => <Skeleton key={i} className="h-3.5" style={{ width: `${w}%` }} />)}</div></div>
    </div>
  );
}
