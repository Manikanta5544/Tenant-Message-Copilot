import { cx } from "./cx";
/** Flat placeholder block; pass a height and width to match the content it stands in for. */
export const Skeleton = ({ className, style }: { className?: string; style?: React.CSSProperties }) => <div aria-hidden="true" style={style} className={cx("skeleton h-3", className)} />;
