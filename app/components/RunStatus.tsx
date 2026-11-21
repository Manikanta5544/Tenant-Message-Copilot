import type { RunState } from "../lib/run-state";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { EmptyState } from "./ui/EmptyState";
import { Icon } from "./ui/Icon";
import { Skeleton } from "./ui/Skeleton";
import { cx } from "./ui/cx";

// Stages a run passes through, in order, with the trace stage that marks each as done.
const STEPS = [
  { stage: "triage", label: "Read the message" },
  { stage: "evidence", label: "Gather evidence" },
  { stage: "draft", label: "Draft and verify" },
  { stage: "route", label: "Decide the route" },
];

/** Idle, loading and error states of the detail pane. (A finished run is rendered by DecisionCard and the tabs.) */
export default function RunStatus({ state, onGenerate }: { state: Exclude<RunState, { status: "ready" }>; onGenerate: () => void }) {
  if (state.status === "idle") {
    return (
      <EmptyState icon="file" title="No draft yet for this message" action={<Button variant="primary" onClick={onGenerate}>Generate draft</Button>}>
        Generating reads this resident's lease and ledger, drafts a reply and checks it. Nothing is sent.
      </EmptyState>
    );
  }
  if (state.status === "error") {
    return <EmptyState alert tone="error" icon="alert" title={state.message} action={<Button variant="secondary" onClick={onGenerate}><Icon name="refresh" size={15} />Try again</Button>}>Nothing was sent to the tenant.</EmptyState>;
  }
  const seen = new Set(state.steps ?? []);
  const current = STEPS.findIndex((s) => !seen.has(s.stage));
  return (
    <Card className="p-5">
      <div role="status" aria-live="polite">
        <p className="text-base font-medium">{state.label}</p>
        <ol className="mt-4 flex flex-col gap-2 sm:flex-row sm:gap-6" aria-label="Progress">
          {STEPS.map((s, i) => {
            const done = seen.has(s.stage), active = i === current;
            return (
              <li key={s.stage} aria-current={active ? "step" : undefined} className={cx("flex items-center gap-2 text-sm", done ? "text-ready" : active ? "font-medium text-text" : "text-faint")}>
                <span className={cx("grid size-6 place-items-center rounded-full border", done ? "border-ready-line bg-ready-bg" : active ? "border-accent bg-accent-soft text-accent" : "border-border")}>{done ? <Icon name="check" size={13} /> : <span className="num text-xs">{i + 1}</span>}</span>
                {s.label}<span className="sr-only">{done ? ", done" : active ? ", in progress" : ", waiting"}</span>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="mt-5 space-y-2.5" aria-hidden><Skeleton className="w-3/4" /><Skeleton className="w-full" /><Skeleton className="w-2/3" /></div>
    </Card>
  );
}
