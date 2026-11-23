import { cx } from "./cx";

/** The monogram: a message bubble with a check (a reply that has been checked). Drawn as a CSS mask, like Icon, so no browser extension can
 *  rewrite SVG children. Accent colour, 1.5 px stroke in a 24-unit box, 20 px by default. */
const PATH = '<path d="M4 4.5h16a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1h-9.2L6.5 19.8V16H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1Z"/><path d="m8.2 10.2 2.5 2.5 4.6-5"/>';
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${PATH}</svg>`;
const URL_ = `url("data:image/svg+xml,${encodeURIComponent(SVG)}")`;

export function Brand({ size = 20, className }: { size?: number; className?: string }) {
  return <span suppressHydrationWarning aria-hidden="true" className={cx("inline-block bg-accent", className)}
    style={{ width: size, height: size, WebkitMaskImage: URL_, maskImage: URL_, WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat", WebkitMaskSize: "100% 100%", maskSize: "100% 100%" }} />;
}
