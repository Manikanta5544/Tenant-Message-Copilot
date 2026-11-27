// axe-core on the main pages, at desktop and phone width, in both themes. Any violation fails. Needs a running server (BASE_URL).
//   rules: WCAG 2.0 A and AA, WCAG 2.1 AA, and axe's best-practice set
import { chromium } from "playwright";
import fs from "node:fs";
import { createRequire } from "node:module";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PAGES = ["/", "/evals", "/about", "/system"];
const WIDTHS = [1280, 390];
const THEMES = ["light", "dark"];
const axeSource = fs.readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const OPTIONS = { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] } };

const browser = await chromium.launch();
let checks = 0; const failures = [];
for (const theme of THEMES) for (const width of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
  await ctx.addCookies([{ name: "theme", value: theme, url: BASE }]);
  const page = await ctx.newPage();
  for (const path of PAGES) {
    // /system keeps a live connection open, so "networkidle" would never settle there: wait for the page's own heading instead.
    await page.goto(BASE + path, { waitUntil: "load" });
    await page.locator("h1, h2").first().waitFor();
    await page.waitForTimeout(1200);
    // Evaluated over the DevTools protocol, so the page's nonce CSP does not (and must not) have to allow it.
    await page.evaluate(axeSource);
    const result = await page.evaluate((o) => globalThis.axe.run(document, o), OPTIONS);
    checks++;
    const label = `${path} @${width}px ${theme}`;
    if (result.violations.length === 0) console.log(`PASS  ${label}: 0 violations (${result.passes.length} rules passed)`);
    else for (const v of result.violations) {
      const where = v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ");
      failures.push(`${label}: ${v.id} (${v.impact}) x${v.nodes.length}: ${v.help} [${where}]`);
      console.log(`FAIL  ${failures[failures.length - 1]}`);
    }
  }
  await ctx.close();
}
await browser.close();
console.log(failures.length ? `\n${failures.length} violation type(s) across ${checks} page checks` : `\naxe: ${checks} page checks, 0 violations`);
process.exit(failures.length ? 1 : 0);
