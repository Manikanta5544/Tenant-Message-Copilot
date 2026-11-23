import { changeSentence } from "../lib/diff";
import type { ReviewRow } from "../lib/types";

export const fmtTime = (iso: string) => new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const fmtDay = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(new Date(iso));
const LABEL = { approved: "Approved as drafted", edited: "Approved with your edits", regenerated: "Generated again" } as const;

/** Append-only audit of this visitor's decisions on this message, as ledger lines. Recorded in the database; nothing was sent to the tenant. */
export default function ReviewHistory({ reviews, currentRunId, originalText }: { reviews: ReviewRow[]; currentRunId: string; originalText?: string }) {
  if (reviews.length === 0) return null;
  return (
    <section aria-label="Review history" className="mt-6 max-w-[62ch]">
      <h3 className="label-caps mb-1">Review log</h3>
      <ol className="divide-y divide-border border-y border-border text-sm">
        {[...reviews].reverse().map((r) => (
          <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 py-1.5">
            <span className="tnum w-24 shrink-0 text-muted">{fmtDay(r.created_at)}, {fmtTime(r.created_at)}</span>
            <span className="font-medium">{LABEL[r.action]}</span>
            {r.action === "edited" && r.edited_text && r.run_id === currentRunId && originalText !== undefined && <span className="text-muted">edited: {changeSentence(originalText, r.edited_text)}</span>}
            <span className="text-muted">{r.run_id !== currentRunId ? "earlier draft · " : ""}recorded</span>
            {r.edited_text && <span className="basis-full break-words text-muted">“{r.edited_text.length > 140 ? r.edited_text.slice(0, 140) + "…" : r.edited_text}”</span>}
          </li>
        ))}
      </ol>
      <p className="mt-1 text-sm text-faint">Append-only. Nothing is ever sent to tenants.</p>
    </section>
  );
}
