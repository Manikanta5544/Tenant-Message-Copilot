import { decisionSentences, escalationKind } from "@/core/reasons";
import { LAYER_LABEL } from "../lib/format";
import type { LayerView, Route, RunView } from "../lib/types";
import { Dot, STATUS_WORD, statusOf } from "./ui/Dot";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";

const NEXT: Record<string, string> = { draft_ready: "Read it, check the values, approve", needs_review: "Check each value, then approve", escalate_only: "Handle this one yourself" };

/** The status, in one strip above the draft: dot, bold label, one reason sentence, the next action. Two lines below 1500 px (state and reason, then the action), one baseline-aligned row above. No banner, no tint. */
/** "6 of 6 checks passed" or "2 flagged: Exactness, Policy" (the layers that did not pass). */
export function verificationSummary(layers: LayerView[]): { text: string; flagged: boolean } | null {
  const ran = layers.filter((l) => !l.skipped);
  if (!ran.length) return null;
  const bad = ran.filter((l) => !l.ok);
  return bad.length ? { text: `${bad.length} flagged: ${bad.map((l) => LAYER_LABEL[l.name]).join(", ")}`, flagged: true } : { text: `${ran.length} of ${ran.length} checks passed`, flagged: false };
}

export default function StatusStrip({ run, onVerification }: { run: RunView; onVerification?: () => void }) {
  const sum = verificationSummary((run.verification ?? []) as LayerView[]);
  const status = statusOf(run.route);
  const d = decisionSentences({ route: run.route as Route | null, reasons: run.route_reasons, intent: run.intent, flags: run.flags });
  return (
    <section aria-label="Decision" className="flex flex-col gap-y-0.5 border-y border-border py-2 2xl:min-h-10 2xl:flex-row 2xl:items-baseline 2xl:gap-x-3">
      <div className="flex items-baseline gap-x-3 2xl:contents">
        <span className="self-center"><Dot status={status} /></span>
        <h2 className="shrink-0 text-base">{STATUS_WORD[status]}</h2>
        <p className="min-w-0 flex-1 text-base text-muted">{d.why}</p>
      </div>
      <p className="flex flex-wrap items-baseline gap-x-4 pl-[22px] text-base 2xl:pl-0">
        <span className="font-medium text-text">{NEXT[run.route ?? "needs_review"]}</span>
        {sum && onVerification && <button type="button" onClick={onVerification} className="t rounded text-sm text-accent underline underline-offset-4 hover:text-accent-hover" data-testid="verification-summary">{sum.text}</button>}
      </p>
    </section>
  );
}

/** Failure and degraded-mode notices: a plain row with a rule, never a filled banner. */
export function Notices({ run, onGenerate }: { run: RunView; onGenerate: () => void }) {
  const items: { title: string; body: React.ReactNode; action?: boolean }[] = [];
  if (run.banner === "budget_exhausted") items.push({ title: "Daily demo budget is used up", body: "No model ran. This is a template reply and the message needs a person. The budget resets daily." });
  if (run.banner === "provider_failed") items.push({ title: "The model is unavailable; showing a safe holding reply", body: <>Keyword safety checks still ran and the message is routed to a person. If this is your own setup, run <code>npm run doctor</code> and check the key, model names and rate limits.</> });
  if (!run.banner && run.mode === "fallback" && run.route !== "escalate_only") items.push({ title: "A check failed, so a standard reply is shown", body: "The model's draft did not pass the checks twice, so none of it is shown." });
  if (run.status === "failed") items.push({ title: "This draft did not finish", body: "It stopped before the reply was written (it may have timed out). Nothing was sent.", action: true });
  if (!items.length) return null;
  return (
    <div className="mt-3 space-y-2">
      {items.map((n) => (
        <div key={n.title} role="alert" className="flex flex-wrap items-center gap-3 border-l-2 border-escalate-line py-1 pl-3">
          <div className="min-w-0 flex-1"><p className="text-base font-medium text-escalate">{n.title}</p><p className="text-sm text-muted">{n.body}</p></div>
          {n.action && <Button small onClick={onGenerate}><Icon name="refresh" size={13} />Generate again</Button>}
        </div>
      ))}
    </div>
  );
}

/** Escalate-only: the draft is replaced by a plain statement and the matched reason. No empty card. */
export function EscalationStatement({ run }: { run: RunView }) {
  return (
    <section aria-label="Escalation" className="mt-4 max-w-prose" role="note">
      <p className="text-lg font-medium">No reply is drafted for this message.</p>
      <p className="mt-1 text-base text-muted">Matched: <span className="text-text">{escalationKind(run.route_reasons, run.flags)}</span>. Handle it yourself and reply to the tenant personally. Nothing was prepared to send.</p>
    </section>
  );
}
