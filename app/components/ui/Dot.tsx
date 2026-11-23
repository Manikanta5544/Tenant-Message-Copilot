import { cx } from "./cx";

export type Status = "ready" | "review" | "escalate" | "none";
export const STATUS_WORD: Record<Status, string> = { ready: "Ready", review: "Needs review", escalate: "Escalate only", none: "Not processed" };
const TONE: Record<Status, string> = { ready: "text-ready", review: "text-review", escalate: "text-escalate", none: "text-faint" };

/** Status dot. Colour is never the only signal: each status has its own shape (filled circle, thick ring, square, thin hollow ring),
 *  and the word is always available to assistive technology (or shown, with `label`).
 *  Drawn with CSS only (no SVG): browser extensions such as Dark Reader rewrite SVG children, which cannot all be hydration-suppressed. */
const SHAPE: Record<Status, string> = {
  ready: "size-2 rounded-full bg-current",
  review: "size-2 rounded-full border-[1.8px] border-current",
  escalate: "size-[7.6px] rounded-[1px] bg-current",
  none: "size-[8.4px] rounded-full border-[1.4px] border-current",
};
export function Dot({ status, label, className }: { status: Status; label?: boolean | string; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5", TONE[status], className)}>
      <span aria-hidden="true" data-dot={status} className="grid size-2.5 shrink-0 place-items-center"><span className={SHAPE[status]} /></span>
      {label ? <span>{typeof label === "string" ? label : STATUS_WORD[status]}</span> : <span className="sr-only">{STATUS_WORD[status]}</span>}
    </span>
  );
}
export const statusOf = (route: string | null | undefined): Status => (route === "draft_ready" ? "ready" : route === "needs_review" ? "review" : route === "escalate_only" ? "escalate" : "none");
