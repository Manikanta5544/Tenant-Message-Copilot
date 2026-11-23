import { forwardRef } from "react";
import { cx } from "./cx";

type Variant = "primary" | "secondary" | "ghost" | "link";
const V: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover border border-transparent disabled:bg-bg-subtle disabled:text-faint",
  secondary: "bg-surface text-text border border-border-strong hover:bg-bg-subtle disabled:text-faint disabled:border-border",
  ghost: "bg-transparent text-muted border border-transparent hover:bg-bg-subtle hover:text-text disabled:text-faint",
  // Tertiary: reads as text, not as a control.
  link: "bg-transparent text-muted border border-transparent underline underline-offset-4 decoration-border-strong hover:text-text disabled:text-faint",
};
/** One primary per screen. 44 px tap target on touch widths, denser from the md breakpoint up. */
export const Button = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; small?: boolean }>(
  function Button({ variant = "secondary", small, className, type = "button", ...p }, ref) {
    return <button ref={ref} type={type} {...p} className={cx("t inline-flex items-center justify-center gap-1.5 rounded-md font-medium", small ? "min-h-11 px-2.5 text-sm md:min-h-7" : "min-h-11 px-3.5 text-base md:min-h-8", V[variant], className)} />;
  },
);
