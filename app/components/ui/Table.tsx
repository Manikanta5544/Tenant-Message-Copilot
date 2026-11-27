import { cx } from "./cx";
/** Hairline table with tabular figures. Wide tables scroll inside their own wrapper, never the page. */
export function Table({ caption, children, className, minWidth }: { caption: string; children: React.ReactNode; className?: string; minWidth?: number }) {
  // A region that can scroll sideways must be reachable and operable from the keyboard (WCAG 2.1.1).
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={caption}>
      <table className={cx("tbl", className)} style={minWidth ? { minWidth } : undefined}>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}
