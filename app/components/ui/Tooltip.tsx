import { useId } from "react";
import { cx } from "./cx";

/** CSS tooltip shown on hover and keyboard focus of its child. The child gets aria-describedby via the wrapper's id. */
export function Tooltip({ text, children, side = "right", className }: { text: string; children: React.ReactNode; side?: "right" | "top"; className?: string }) {
  const id = useId();
  return (
    <span className={cx("group/tip relative inline-flex", className)} aria-describedby={id}>
      {children}
      <span id={id} role="tooltip" className={cx("pointer-events-none absolute z-50 hidden whitespace-nowrap rounded-md border border-border bg-raised px-2 py-1 text-sm text-text shadow-pop group-focus-within/tip:block group-hover/tip:block", side === "right" ? "left-full top-1/2 ml-2 -translate-y-1/2" : "bottom-full left-1/2 mb-2 -translate-x-1/2")}>{text}</span>
    </span>
  );
}
