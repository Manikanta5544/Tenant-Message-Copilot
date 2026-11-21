import type { RunView } from "../lib/types";
import { INTENT_LABEL } from "../lib/format";
import { ModeChip } from "./ModeChip";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Icon } from "./ui/Icon";
import { cx } from "./ui/cx";

const R = {
  draft_ready: { label: "Draft ready", icon: "check", box: "border-l-ready-line bg-ready-bg", icon_cls: "bg-surface text-ready", title: "text-ready", fallbackReason: "No check raised a concern. A person still reads it before anything goes out." },
  needs_review: { label: "Needs review", icon: "alert", box: "border-l-review-line bg-review-bg", icon_cls: "bg-surface text-review", title: "text-review", fallbackReason: "A person should read and correct this reply before it is used." },
  escalate_only: { label: "Escalate only", icon: "ban", box: "border-l-escalate-line bg-escalate-bg", icon_cls: "bg-surface text-escalate", title: "text-escalate", fallbackReason: "A person must handle this message." },
} as const;

/** The hero of the detail pane: the route, one line of why, the triage facts, and the standing promise that nothing is sent. */
export default function DecisionCard({ run, onGenerate }: { run: RunView; onGenerate: () => void }) {
  const r = R[(run.route ?? "needs_review") as keyof typeof R];
  const reason = run.route_reasons[0] ?? r.fallbackReason;
  return (
    <Card as="section" aria-label="Decision" className="overflow-hidden">
      <div className={cx("flex items-start gap-3 border-l-4 p-4 sm:gap-4 sm:p-5", r.box)}>
        <span className={cx("grid size-11 shrink-0 place-items-center rounded-full", r.icon_cls)}><Icon name={r.icon} size={22} /></span>
        <div className="min-w-0 flex-1">
          <h2 className={cx("text-2xl", r.title)}>{r.label}</h2>
          <p className="mt-0.5 text-base text-text">{reason}</p>
        </div>
        <div className="shrink-0"><ModeChip mode={run.mode} /></div>
      </div>

      {run.route === "escalate_only" && (
        <p role="note" className="flex gap-2 border-t border-escalate-line bg-escalate-bg px-4 py-3 text-base text-escalate sm:px-5">
          <Icon name="ban" size={18} className="mt-0.5" />
          <span><b>No drafted answer is offered.</b> A manager must handle this message. Any text below is a holding reply, not an answer to the question.</span>
        </p>
      )}
      {run.banner === "budget_exhausted" && <Notice title="Daily demo budget is used up">No model ran. This is a template reply and the message needs a person. The budget resets daily.</Notice>}
      {run.banner === "provider_failed" && <Notice title="The model was unavailable">A template reply was served and routed to escalation. Keyword safety checks still ran. If this is your own setup, run <code>npm run models</code> and check the key, model names and rate limits.</Notice>}
      {!run.banner && run.mode === "fallback" && <Notice title="Verification failed, so a template reply was served">The model's draft did not pass the checks twice, so none of it is shown.</Notice>}
      {run.status === "failed" && (
        <Notice title="This run did not finish" action={<Button small variant="secondary" onClick={onGenerate}><Icon name="refresh" size={14} />Generate again</Button>}>
          The pipeline stopped before it produced a draft (it may have timed out). Nothing was sent.
        </Notice>
      )}

      <dl className="flex flex-wrap gap-2 border-t border-border px-4 py-3 sm:px-5">
        <KV k="Language" v={run.language ?? "-"} /><KV k="Intent" v={INTENT_LABEL[run.intent ?? ""] ?? "-"} /><KV k="Urgency" v={run.urgency ?? "-"} urgent={run.urgency === "urgent"} />
      </dl>
      <p className="flex items-center gap-2 border-t border-border bg-bg-subtle px-4 py-2.5 text-sm text-muted sm:px-5">
        <Icon name="lock" size={15} className="text-accent" />Nothing is ever sent to tenants. Approving only marks a draft as reviewed in this session.
      </p>
    </Card>
  );
}

function KV({ k, v, urgent }: { k: string; v: string; urgent?: boolean }) {
  return (
    <div className={cx("flex items-baseline gap-1.5 rounded-lg border px-2.5 py-1", urgent ? "border-escalate-line bg-escalate-bg" : "border-border bg-bg-subtle")}>
      <dt className="text-sm text-muted">{k}</dt><dd className={cx("text-base font-medium capitalize", urgent && "text-escalate")}>{v}</dd>
    </div>
  );
}
function Notice({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 border-t border-escalate-line bg-escalate-bg px-4 py-3 sm:px-5">
      <Icon name="alert" size={18} className="text-escalate" />
      <div className="min-w-0 flex-1"><p className="font-medium text-escalate">{title}</p><p className="text-sm text-text">{children}</p></div>
      {action}
    </div>
  );
}
