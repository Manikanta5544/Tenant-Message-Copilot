import { cx } from "./cx";
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cx("inline-flex min-w-5 items-center justify-center rounded border border-border-strong bg-bg-subtle px-1 font-mono text-xs text-muted", className)}>{children}</kbd>;
}
