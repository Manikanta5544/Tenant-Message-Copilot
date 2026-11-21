import { cx } from "./cx";
export const Skeleton = ({ className }: { className?: string }) => <div aria-hidden="true" className={cx("skeleton h-3", className)} />;
