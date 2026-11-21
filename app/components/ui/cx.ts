/** Tiny class-name joiner (no dependency): falsy values are dropped. */
export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");
