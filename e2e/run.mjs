// End-to-end checks against a running server (BASE_URL, default http://localhost:3000):
// security headers on pages and /api/*, nonce CSP with zero violations, no console errors, no horizontal scroll.
// Needs Playwright (`npx playwright install chromium`); it is not a dependency of the app.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = createRequire(`${process.env.GLOBAL_NODE_MODULES ?? ""}/x.js`)("playwright")); }

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PAGES = (process.env.E2E_PAGES ?? "/,/evals,/about").split(",");
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) fails.push(msg); };
const prod = process.env.E2E_PRODUCTION === "1";

const browser = await chromium.launch();
for (const path of PAGES) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const problems = [];
  page.on("console", (m) => { const t = m.text(); if (["error", "warning"].includes(m.type()) && !/OTS parsing|Failed to decode downloaded font/.test(t)) problems.push(`${m.type()}: ${t}`); });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  await page.addInitScript(() => { window.__csp = []; document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
  const res = await page.goto(BASE + path, { waitUntil: "networkidle" });
  const h = res.headers();
  check(res.status() === 200, `${path}: 200`);
  const csp = h["content-security-policy"] ?? "";
  check(/script-src [^;]*'nonce-[^']+'/.test(csp) && !/script-src[^;]*unsafe-inline/.test(csp), `${path}: nonce CSP, no unsafe-inline for scripts`);
  for (const d of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "connect-src 'self'"]) check(csp.includes(d), `${path}: CSP has ${d}`);
  check(h["x-content-type-options"] === "nosniff", `${path}: X-Content-Type-Options`);
  check(h["referrer-policy"] === "strict-origin-when-cross-origin", `${path}: Referrer-Policy`);
  check(/camera=\(\)/.test(h["permissions-policy"] ?? ""), `${path}: Permissions-Policy`);
  check(!h["x-powered-by"], `${path}: no X-Powered-By`);
  if (prod) check(/max-age=\d+/.test(h["strict-transport-security"] ?? ""), `${path}: HSTS`);
  await page.waitForTimeout(800);
  const viol = await page.evaluate(() => window.__csp);
  check(viol.length === 0, `${path}: zero CSP violations${viol.length ? " " + JSON.stringify(viol) : ""}`);
  check(problems.length === 0, `${path}: no console errors or warnings${problems.length ? " " + JSON.stringify(problems.slice(0, 3)) : ""}`);
  for (const w of [360, 1920]) {
    await page.setViewportSize({ width: w, height: 800 });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(over <= 0, `${path}: no horizontal scroll at ${w}px`);
  }
  await ctx.close();
}
// Product flows: URL-addressable selection, keyboard navigation, review action persisted across reload.
// Needs a server with baseline runs (mock or live mode); skipped with E2E_FLOWS=0.
if (process.env.E2E_FLOWS !== "0") {
  const inbox = await (await fetch(BASE + "/api/inbox")).json();
  const target = inbox.messages.find((m) => m.scenario_label === "Scenario 1") ?? inbox.messages[0];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?m=${target.message_id}`, { waitUntil: "networkidle" });
  check(await page.getByRole("heading", { name: /draft ready|needs review|escalate only/i }).first().isVisible(), "/?m=<id> opens that message's decision card");
  check((await page.locator('[data-inbox-row][aria-current="true"]').count()) === 1, "the selected row is marked aria-current");
  const approve = page.getByRole("button", { name: /approve draft/i });
  if (await approve.count()) { await approve.click(); await page.getByText(/recorded\)/).first().waitFor(); }
  await page.reload({ waitUntil: "networkidle" });
  check(await page.getByText(/Approved by you at \d\d:\d\d \(recorded\)/).first().isVisible(), "review action persists across reload (recorded)");
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.keyboard.press("j");
  check(await page.evaluate(() => document.activeElement?.hasAttribute("data-inbox-row")), "j moves focus to an inbox row");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  check(/[?&]m=[0-9a-f-]{36}/.test(page.url()), "Enter opens the message and puts its id in the URL");
  const counts = await page.locator('[role=group][aria-label="Filter messages"] button').allTextContents();
  const all = Number(counts[0].replace(/\D/g, ""));
  check(all === (await page.locator("[data-inbox-row]").count()), `the All count (${all}) matches the rows listed`);
  await ctx.close();
}
const api = await fetch(BASE + "/api/health");
check((api.headers.get("cache-control") ?? "").includes("no-store"), "/api/health: Cache-Control no-store");
check(!!api.headers.get("content-security-policy") && api.headers.get("x-content-type-options") === "nosniff", "/api/health: security headers");
await browser.close();
console.log(fails.length ? `\n${fails.length} check(s) failed` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
