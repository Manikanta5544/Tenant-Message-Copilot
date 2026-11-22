import type { ReviewRow } from "../lib/types";
import { Card } from "./ui/Card";
import { Icon } from "./ui/Icon";

export const fmtTime = (iso: string) => new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const fmtDay = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(new Date(iso));

const LABEL = { approved: "Approved as drafted", edited: "Approved with your edits", regenerated: "Generated again" } as const;

/** Append-only audit of this visitor's decisions on this message. Recorded in the database; nothing was sent to the tenant. */
export default function ReviewHistory({ reviews, currentRunId }: { reviews: ReviewRow[]; currentRunId: string }) {
  if (reviews.length === 0) return null;
  return (
    <Card as="section" aria-label="Review history" className="p-4">
      <h3 className="mb-2 text-lg">Review history</h3>
      <ol className="space-y-2 text-base">
        {[...reviews].reverse().map((r) => (
          <li key={r.id} className="flex gap-2">
            <Icon name={r.action === "regenerated" ? "refresh" : "check"} size={16} className="mt-1 shrink-0 text-muted" />
            <span className="min-w-0">
              <span className="font-medium">{LABEL[r.action]}</span>
              <span className="text-muted"> · {fmtDay(r.created_at)}, {fmtTime(r.created_at)}{r.run_id !== currentRunId ? " · earlier draft" : ""} · recorded</span>
              {r.edited_text && <span className="mt-0.5 block break-words text-sm text-muted">“{r.edited_text.length > 140 ? r.edited_text.slice(0, 140) + "…" : r.edited_text}”</span>}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-sm text-faint">Decisions are saved to an append-only log. Nothing is ever sent to tenants.</p>
    </Card>
  );
}
