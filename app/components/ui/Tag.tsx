import { cx } from "./cx";
/** A small plain label. Neutral only: colour is reserved for status. */
export function Tag({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return <span title={title} className={cx("inline-flex items-center whitespace-nowrap rounded border border-border px-1.5 text-xs leading-5 text-muted", className)}>{children}</span>;
}
