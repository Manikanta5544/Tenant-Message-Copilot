import { cx } from "./cx";
import { Icon } from "./Icon";

export type Tone = "neutral" | "ready" | "review" | "escalate" | "fact" | "accent";
const T: Record<Tone, string> = {
  neutral: "bg-bg-subtle text-muted border-border",
  ready: "bg-ready-bg text-ready border-ready-line",
  review: "bg-review-bg text-review border-review-line",
  escalate: "bg-escalate-bg text-escalate border-escalate-line",
  fact: "bg-fact-bg text-fact border-fact-line",
  accent: "bg-accent-soft text-accent border-transparent",
};
export function Chip({ tone = "neutral", icon, children, title, className }: { tone?: Tone; icon?: string; children: React.ReactNode; title?: string; className?: string }) {
  return <span title={title} className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium leading-5", T[tone], className)}>{icon && <Icon name={icon} size={12} />}{children}</span>;
}

const ROUTE: Record<string, { tone: Tone; icon: string; label: string }> = {
  draft_ready: { tone: "ready", icon: "check", label: "Draft ready" },
  needs_review: { tone: "review", icon: "alert", label: "Needs review" },
  escalate_only: { tone: "escalate", icon: "ban", label: "Escalate only" },
};
/** The one status pill: icon plus text, never colour alone. */
export function StatusPill({ route, className }: { route: string | null; className?: string }) {
  const r = route ? ROUTE[route] : null;
  return r ? <Chip tone={r.tone} icon={r.icon} className={cx("font-semibold", className)}>{r.label}</Chip> : <Chip icon="minus" className={className}>Not processed</Chip>;
}
