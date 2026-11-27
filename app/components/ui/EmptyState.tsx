import { cx } from "./cx";

/** Empty, error and offline states share one shape: a title, one sentence of what to do, an action, and (for errors) a reference id.
 *  Left-aligned, no card, no illustration. */
export function EmptyState({ title, children, action, tone = "neutral", alert, reference, className }: { title: string; children?: React.ReactNode; action?: React.ReactNode; tone?: "neutral" | "error"; alert?: boolean; reference?: string; className?: string }) {
  return (
    <div role={alert ? "alert" : undefined} className={cx("max-w-prose px-4 py-8", tone === "error" && "border-l-2 border-escalate-line", className)}>
      <h2 className={cx("text-lg", tone === "error" && "text-escalate")}>{title}</h2>
      {children && <div className="mt-1 space-y-1 text-base text-muted">{children}</div>}
      {reference && <p className="mt-2 font-mono text-sm text-faint">Reference: <span className="select-all text-text">{reference}</span></p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
