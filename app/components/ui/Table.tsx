import { cx } from "./cx";
/** Hairline table with tabular figures. Wide tables scroll inside their own wrapper, never the page. */
export function Table({ caption, children, className, minWidth }: { caption: string; children: React.ReactNode; className?: string; minWidth?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className={cx("tbl", className)} style={minWidth ? { minWidth } : undefined}>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}
