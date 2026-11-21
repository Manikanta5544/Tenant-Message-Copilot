import { forwardRef } from "react";
import { cx } from "./cx";

type Variant = "primary" | "secondary" | "ghost" | "danger";
const V: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover border border-transparent disabled:bg-bg-subtle disabled:text-faint",
  secondary: "bg-surface text-text border border-border-strong hover:bg-bg-subtle disabled:text-faint disabled:border-border",
  ghost: "bg-transparent text-muted border border-transparent hover:bg-bg-subtle hover:text-text disabled:text-faint",
  danger: "bg-escalate-bg text-escalate border border-escalate-line hover:bg-surface disabled:opacity-60",
};
export const Button = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; small?: boolean }>(
  function Button({ variant = "secondary", small, className, type = "button", ...p }, ref) {
    // 44 px tap target on touch widths, denser from the sm breakpoint up.
    return <button ref={ref} type={type} {...p} className={cx("t inline-flex items-center justify-center gap-2 rounded-lg font-medium", small ? "min-h-11 px-3 text-sm sm:min-h-8" : "min-h-11 px-4 text-base sm:min-h-10", V[variant], className)} />;
  },
);
