import { cx } from "./cx";

const P: Record<string, string[]> = {
  check: ["M20 6 9 17l-5-5"],
  alert: ["m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3", "M12 9v4", "M12 17h.01"],
  ban: ["M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20", "m4.9 4.9 14.2 14.2"],
  x: ["M18 6 6 18", "m6 6 12 12"],
  file: ["M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", "M14 2v4a2 2 0 0 0 2 2h4", "M10 9H8", "M16 13H8", "M16 17H8"],
  wallet: ["M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1", "M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"],
  key: ["m21 2-9.6 9.6", "m15.5 7.5 3 3L22 7l-3-3", "M7.5 12.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11"],
  search: ["M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16", "m21 21-4.3-4.3"],
  sun: ["M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8", "M12 2v2", "M12 20v2", "m4.93 4.93 1.41 1.41", "m17.66 17.66 1.41 1.41", "M2 12h2", "M20 12h2", "m6.34 17.66-1.41 1.41", "m19.07 4.93-1.41 1.41"],
  moon: ["M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"],
  back: ["m12 19-7-7 7-7", "M19 12H5"],
  chevron: ["m6 9 6 6 6-6"],
  info: ["M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20", "M12 16v-4", "M12 8h.01"],
  shield: ["M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z", "m9 12 2 2 4-4"],
  refresh: ["M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8", "M21 3v5h-5", "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16", "M8 16H3v5"],
  pencil: ["M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"],
  minus: ["M5 12h14"],
  clock: ["M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20", "M12 6v6l4 2"],
  inbox: ["M22 12h-6l-2 3h-4l-2-3H2", "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"],
  lock: ["M7 11V7a5 5 0 0 1 10 0v4", "M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2"],
  gauge: ["m12 14 4-4", "M3.34 19a10 10 0 1 1 17.32 0"],
  help: ["M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20", "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3", "M12 17h.01"],
  menu: ["M4 6h16", "M4 12h16", "M4 18h16"],
  layers: ["m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z", "m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65", "m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"],
};

/** Icons are drawn as a CSS mask (a data-URI SVG used as the mask of a currentColor box), not as inline <svg>: browser extensions such as
 *  Dark Reader add attributes to every svg and every svg child (<path>), and React cannot suppress hydration warnings on all of them.
 *  A <span> has one element to protect, and it carries suppressHydrationWarning. */
export function Icon({ name, className, size = 16 }: { name: keyof typeof P | string; className?: string; size?: number }) {
  const body = (P[name] ?? []).map((d) => `<path d="${d}"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  return (
    <span suppressHydrationWarning aria-hidden="true" data-icon={name} className={cx("inline-block shrink-0 bg-current align-middle", className)}
      style={{ width: size, height: size, WebkitMaskImage: url, maskImage: url, WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat", WebkitMaskSize: "100% 100%", maskSize: "100% 100%" }} />
  );
}
