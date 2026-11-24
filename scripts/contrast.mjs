// WCAG contrast check for every token pair, light and dark. Exit 1 if any pair fails.
import fs from "node:fs";
const css = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const grab = (src) => Object.fromEntries([...src.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
const light = grab(css.slice(css.indexOf(":root {"), css.indexOf("@media (prefers-color-scheme: dark)")));
const dark = grab(css.slice(css.indexOf(':root[data-theme="dark"]'), css.indexOf("@theme inline")));
// The media-query dark block must carry exactly the same values as the data-theme="dark" block.
const mediaDark = grab(css.slice(css.indexOf("@media (prefers-color-scheme: dark)"), css.indexOf(':root[data-theme="dark"]')));
const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const pairs = [
  ["text", "bg", 4.5], ["text", "surface", 4.5], ["text", "surface-raised", 4.5], ["text", "bg-subtle", 4.5],
  ["text-muted", "bg", 4.5], ["text-muted", "surface", 4.5], ["text-muted", "bg-subtle", 4.5],
  ["text-faint", "bg", 4.5], ["text-faint", "surface", 4.5], ["text-faint", "bg-subtle", 4.5],
  ["accent", "surface", 4.5], ["accent", "bg", 4.5], ["accent", "bg-subtle", 4.5], ["accent", "accent-soft", 4.5], ["accent-fg", "accent", 4.5], ["accent-fg", "accent-hover", 4.5], ["text", "accent-soft", 4.5],
  ["border-strong", "surface", 3], ["border-strong", "bg", 3], ["accent", "surface", 3],
  ["accent", "surface-raised", 4.5], ["text-muted", "surface-raised", 4.5], ["text-faint", "surface-raised", 4.5], ["text-muted", "accent-soft", 4.5], ["text-faint", "accent-soft", 4.5],
  // Status colours appear as small dots and labels on every neutral surface, and as text on their own tint (notices).
  ...["ready", "review", "escalate"].flatMap((k) => [[`${k}-fg`, `${k}-bg`, 4.5], [`${k}-fg`, "surface", 4.5], [`${k}-fg`, "surface-raised", 4.5], [`${k}-fg`, "bg", 4.5], [`${k}-fg`, "bg-subtle", 4.5], [`${k}-fg`, "accent-soft", 4.5]]),
  // Status dots are graphical objects: 3:1 against the surfaces they sit on.
  ...["ready", "review", "escalate"].flatMap((k) => [[`${k}-fg`, "surface", 3], [`${k}-fg`, "bg-subtle", 3]]),
  // The "not processed" dot is a hollow ring in text-faint: graphical object, 3:1 on every surface a row can have (rest, hover, selected).
  ...["bg", "surface", "surface-raised", "bg-subtle", "accent-soft"].map((b) => ["text-faint", b, 3]),
  // The hairline between panes is decorative (not required); the strong border (inputs, focus targets) must be 3:1.
  ["border-strong", "bg-subtle", 3], ["border-strong", "surface-raised", 3],
];
let bad = 0; const rows = [];
for (const [theme, t] of [["light", light], ["dark", dark]]) for (const [fg, bg, min] of pairs) {
  const r = ratio(t[fg], t[bg]); const ok = r >= min; if (!ok) bad++;
  rows.push(`| ${theme} | ${fg} ${t[fg]} on ${bg} ${t[bg]} | ${r.toFixed(2)} | ${min} | ${ok ? "pass" : "FAIL"} |`);
}
for (const k of Object.keys(dark)) if (mediaDark[k] !== dark[k]) { console.error(`dark token ${k} differs between the media query and data-theme blocks`); bad++; }
console.log("| theme | pair | ratio | min | result |\n|---|---|---|---|---|\n" + rows.join("\n"));
console.log(`\n${rows.length} pairs checked, ${bad} failing`);
process.exit(bad ? 1 : 0);
