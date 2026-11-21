import { cx } from "./cx";

/** Surface with a 1 px border and the first elevation level. `raised` is the second level (popovers, the draft letter). */
export function Card({ raised, className, as: As = "div", ...p }: React.HTMLAttributes<HTMLElement> & { raised?: boolean; as?: "div" | "section" | "article" | "aside" }) {
  return <As {...p} className={cx("rounded-card border border-border bg-surface", raised ? "shadow-e2 bg-raised" : "shadow-e1", className)} />;
}
