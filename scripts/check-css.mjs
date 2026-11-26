// Run after `next build`: fail if the emitted CSS is missing layout-critical utilities or responsive rules.
import fs from "node:fs";
import path from "node:path";

const dir = path.join(".next", "static");
const files = [];
function walk(directory) {
  for (const entry of fs.existsSync(directory) ? fs.readdirSync(directory, { withFileTypes: true }) : []) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (file.endsWith(".css")) files.push(file);
  }
}
walk(dir);

if (!files.length) {
  console.error(`check-css: no CSS found under ${dir}. Run "npm run build" first.`);
  process.exit(1);
}

const css = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");
function mediaBlocks(source, condition) {
  const blocks = [];
  const mediaQuery = /@media([^{]*)\{/g;
  let match;
  while ((match = mediaQuery.exec(source))) {
    if (!condition.test(match[1])) continue;
    let depth = 1;
    let index = mediaQuery.lastIndex;
    while (index < source.length && depth) {
      const character = source[index++];
      if (character === "{") depth++;
      else if (character === "}") depth--;
    }
    blocks.push(source.slice(mediaQuery.lastIndex, index - 1));
  }
  return blocks;
}

const md = /min-width:\s*(48rem|768px)|width\s*>=\s*(48rem|768px)/;
const dock = /min-width:\s*(1360px|85rem)|width\s*>=\s*(1360px|85rem)/;
const wide = /min-width:\s*(1700px|106\.25rem)|width\s*>=\s*(1700px|106\.25rem)/;
const inBlock = (condition, rule) => mediaBlocks(css, condition).some((block) => rule.test(block));
const required = [
  [".min-h-dvh", /\.min-h-dvh\b/],
  [".sr-only", /\.sr-only\b/],
  [".grid", /\.grid\{|\.grid,|\.grid\s*\{/],
  [".flex", /\.flex\{|\.flex,|\.flex\s*\{/],
  [".hidden", /\.hidden\{|\.hidden,|\.hidden\s*\{/],
  [".bg-accent", /\.bg-accent\b/],
  ["the desktop responsive utility", () => inBlock(md, /\.md\\:hidden/)],
  ["the mobile max-md utility", () => mediaBlocks(css, /not all and \(min-width:\s*(48rem|768px)\)|max-width:\s*(47\.99\d*rem|767\.99\d*px)|width\s*<\s*(48rem|768px)/).some((block) => /\.max-md\\:hidden/.test(block))],
  ["the 56px desktop navigation rail", () => inBlock(md, /\.rail\{[^}]*width:56px/)],
  ["the list pane widths at 768px, 1024px and 1360px", () => inBlock(md, /\.pane-list\{[^}]*width:300px/) && inBlock(/min-width:\s*1024px/, /\.pane-list\{[^}]*width:320px/) && inBlock(dock, /\.pane-list\{[^}]*width:380px/)],
  ["the docked evidence rail at 1360px", () => inBlock(dock, /\.detail-grid\{[^}]*grid-template-columns/) && inBlock(dock, /\.evidence-dock\{[^}]*sticky/)],
  ["the wide layout cap at 1700px", () => inBlock(wide, /\.shell\{[^}]*max-width:1600px/)],
  ["the mobile single-pane rules", () => inBlock(/max-width:\s*767\.98px/, /data-pane=.?detail.?\]>\.pane-list[^}]*display:none/) && inBlock(/max-width:\s*767\.98px/, /data-pane=.?list.?\]>\.pane-detail[^}]*display:none/)],
  ["pixel-based min-width breakpoints", () => !/@media\s*\([^)]*min-width:\s*[0-9.]+rem/.test(css) && !/@media\s*\(width\s*>=\s*[0-9.]+rem/.test(css)],
  ["thin scrollbars without arrow buttons", () => /@supports not selector\(::-webkit-scrollbar\)\s*\{\s*\*\s*\{[^}]*scrollbar-width:\s*thin/.test(css) && /::-webkit-scrollbar-button\{[^}]*display:none/.test(css) && !/(^|\})\*\{[^}]*scrollbar-width/.test(css)],
];

const missing = required.filter(([, check]) => (typeof check === "function" ? !check() : !check.test(css))).map(([name]) => name);
if (missing.length) {
  console.error(`check-css: FAILED. The built CSS (${files.length} file(s), ${css.length} bytes) is missing: ${missing.join(", ")}.\nTailwind generated no utilities: move the project to a short path without spaces or brackets (for example C:\\dev\\tenant-copilot), delete .next and rebuild.`);
  process.exit(1);
}

console.log(`check-css: ok (${required.length} checks passed in ${files.length} CSS file(s), ${css.length} bytes)`);
