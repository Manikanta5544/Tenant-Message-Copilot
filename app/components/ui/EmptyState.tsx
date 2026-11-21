import { Card } from "./Card";
import { Icon } from "./Icon";
import { cx } from "./cx";

/** Empty and error states share one shape: icon, title, one sentence, an action. */
export function EmptyState({ icon, title, children, action, tone = "neutral", alert }: { icon: string; title: string; children?: React.ReactNode; action?: React.ReactNode; tone?: "neutral" | "error"; alert?: boolean }) {
  return (
    <Card role={alert ? "alert" : undefined} className={cx("flex flex-col items-center px-6 py-10 text-center", tone === "error" && "border-escalate-line bg-escalate-bg")}>
      <span className={cx("grid size-11 place-items-center rounded-full", tone === "error" ? "bg-surface text-escalate" : "bg-accent-soft text-accent")}><Icon name={icon} size={20} /></span>
      <h3 className={cx("mt-3 text-lg", tone === "error" && "text-escalate")}>{title}</h3>
      {children && <p className="mt-1 max-w-md text-base text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </Card>
  );
}
