import { avatarTone, initials } from "../../lib/present";
import { cx } from "./cx";
export const Avatar = ({ name, size = "md" }: { name: string; size?: "md" | "lg" }) => (
  <span aria-hidden className={cx("grid shrink-0 place-items-center rounded-full font-semibold", size === "lg" ? "size-10 text-base" : "size-9 text-sm", avatarTone(name))}>{initials(name)}</span>
);
