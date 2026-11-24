// Run after `next build`: asserts the emitted CSS contains the Tailwind utilities the layout depends on.
// If Tailwind's source detection failed (for example on a path with spaces or brackets), the page would ship unstyled; this fails the build instead.
import fs from "node:fs";
import path from "node:path";

const dir = path.join(".next", "static");
const files = [];
(function walk(d) { for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : p.endsWith(".css") && files.push(p); } })(dir);
if (!files.length) { console.error(`check-css: no CSS found under ${dir}. Run "npm run build" first.`); process.exit(1); }
const css = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
// Utilities used by app/layout.tsx and the shell. A responsive variant is included on purpose: it is emitted as an @media block.
const NEED = [[".h-dvh", /\.h-dvh\b/], [".sr-only", /\.sr-only\b/], [".grid", /\.grid\{|\.grid,|\.grid\s*\{/], [".flex", /\.flex\{|\.flex,|\.flex\s*\{/], [".hidden", /\.hidden\{|\.hidden,|\.hidden\s*\{/], ["a responsive variant (md:)", /\.md\\:flex-row|\.md\\:w-14|\.md\\:hidden/], [".bg-accent", /\.bg-accent\b/]];
// Responsive rules must be real @media blocks, not just class names: the page showed the mobile layout at 1920 px when they were not applied.
/** Returns the text of every @media block whose condition matches `cond`, with nested braces balanced. */
function mediaBlocks(src, cond) {
  const out = []; const re = /@media([^{]*)\{/g; let m;
  while ((m = re.exec(src))) {
    if (!cond.test(m[1])) continue;
    let depth = 1, i = re.lastIndex; while (i < src.length && depth) { const c = src[i++]; if (c === "{") depth++; else if (c === "}") depth--; }
    out.push(src.slice(re.lastIndex, i - 1));
  }
  return out;
}
const MD = /min-width:\s*(48rem|768px)|width\s*>=\s*(48rem|768px)/;
const DOCK = /min-width:\s*(1360px|85rem)|width\s*>=\s*(1360px|85rem)/;
const WIDE = /min-width:\s*(1700px|106\.25rem)|width\s*>=\s*(1700px|106\.25rem)/;
const inBlock = (cond, re) => mediaBlocks(css, cond).some((b) => re.test(b));
NEED.push(
  ["an @media (min-width: 48rem) block containing md:flex-row", () => inBlock(MD, /\.md\\:flex-row/)],
  ["an @media (min-width: 48rem) block containing md:hidden", () => inBlock(MD, /\.md\\:hidden/)],
  ["a max-md:hidden rule inside a `not all and (min-width: 48rem)` media block", () => mediaBlocks(css, /not all and \(min-width:\s*(48rem|768px)\)|max-width:\s*(47\.99\d*rem|767\.99\d*px)|width\s*<\s*(48rem|768px)/).some((b) => /\.max-md\\:hidden/.test(b))],
  ["an @media (min-width: 1360px) block (docked evidence rail)", () => inBlock(DOCK, /min-\\\[1360px\\\]\\:/)],
);
const missing = NEED.filter(([, re]) => (typeof re === "function" ? !re() : !re.test(css))).map(([n]) => n);

if (missing.length) {
  console.error(`check-css: FAILED. The built CSS (${files.length} file(s), ${css.length} bytes) is missing: ${missing.join(", ")}.\nTailwind generated no utilities: move the project to a short path without spaces or brackets (for example C:\\dev\\tenant-copilot), delete .next and rebuild.`);
  process.exit(1);
}
console.log(`check-css: ok (${NEED.length} utilities present in ${files.length} CSS file(s), ${css.length} bytes)`);
