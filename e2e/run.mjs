// End-to-end checks against a running server (BASE_URL, default http://localhost:3000):
// security headers on pages and /api/*, nonce CSP with zero violations, no console errors, no horizontal scroll.
// Needs the Chromium build for the pinned Playwright: `npx playwright install chromium`.
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PAGES = (process.env.E2E_PAGES ?? "/,/evals,/about").split(",");
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) fails.push(msg); };
// The mode comes from the server, not from the caller: a development server's CSP allows 'unsafe-eval', a production one never does.
// E2E_PRODUCTION=1 additionally asserts the server really is a production build, so CI cannot silently run the dev-mode checks (or skip the
// production ones) against the wrong server.
const skip = (what, why) => console.log(`SKIP  ${what} (${why})`);
const probeCsp = (await fetch(BASE + "/")).headers.get("content-security-policy") ?? "";
const detected = /unsafe-eval/.test(probeCsp) ? "development" : "production";
const prod = detected === "production";
console.log(`mode: ${detected} (detected from the server's CSP)`);
if (process.env.E2E_PRODUCTION === "1" && !prod) { console.log("FAIL  E2E_PRODUCTION=1 but the server at " + BASE + " is a development server"); process.exit(1); }
if (process.env.E2E_PRODUCTION === "0" && prod) { console.log("FAIL  E2E_PRODUCTION=0 but the server at " + BASE + " is a production build"); process.exit(1); }

// A development server compiles each route on first request (can exceed the 30 s navigation timeout when cold): warm them up first.
for (const path of PAGES) await fetch(BASE + path, { signal: AbortSignal.timeout(120_000) }).catch(() => {});

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
  if (prod) check(/max-age=\d+/.test(h["strict-transport-security"] ?? ""), `${path}: HSTS`); else skip(`${path}: HSTS`, "production only");
  check(prod ? !/unsafe-eval/.test(csp) : true, `${path}: ${prod ? "production CSP has no unsafe-eval" : "(dev) unsafe-eval allowed only outside production"}`);
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
// Browser extensions mutate the DOM before React hydrates: Dark Reader writes attributes on <html>, <body>, every <svg> AND every
// svg child (<circle>, <path>), and adds <style class="darkreader"> to <head>. Simulate all of it, then assert zero console errors,
// zero React warnings and the desktop layout.
const REACT_WARN = /hydrat|did not match|didn't match|script tag/i;
const noise = (t) => /OTS parsing|Failed to decode downloaded font/.test(t);
const labelLinks = (page) => page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Primary"] ul a')].filter((a) => a.getClientRects().length && getComputedStyle(a).visibility !== "hidden" && a.innerText.trim()).length);
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => {
    const touch = () => {
      document.documentElement.setAttribute("data-darkreader-mode", "dynamic");
      document.documentElement.setAttribute("data-darkreader-scheme", "dark");
      document.body?.setAttribute("cz-shortcut-listen", "true");
      document.querySelectorAll("svg, svg *").forEach((v) => { v.setAttribute("data-darkreader-inline-stroke", ""); v.setAttribute("data-darkreader-inline-fill", ""); v.style.setProperty("--darkreader-inline-stroke", "currentColor"); });
      if (document.head && !document.head.querySelector("style.darkreader")) { const st = document.createElement("style"); st.className = "darkreader darkreader--sync"; st.textContent = "/* extension */"; document.head.appendChild(st); }
    };
    new MutationObserver(touch).observe(document, { subtree: true, childList: true });
    document.addEventListener("DOMContentLoaded", touch);
  });
  const page = await ctx.newPage();
  const bad = [];
  page.on("console", (m) => { const t = m.text(); if (["error", "warning"].includes(m.type()) && !noise(t)) bad.push(`${m.type()}: ${t.slice(0, 200)}`); });
  page.on("pageerror", (e) => bad.push(`pageerror: ${e.message}`));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  for (const extra of ["/about", "/evals"]) { await page.goto(BASE + extra, { waitUntil: "networkidle" }); await page.waitForTimeout(500); }
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.goto(BASE + "/about", { waitUntil: "networkidle" }); await page.waitForTimeout(500);
  const injected = await page.evaluate(() => ({ svg: document.querySelectorAll("svg[data-darkreader-inline-stroke]").length, child: document.querySelectorAll("svg *[data-darkreader-inline-stroke]").length }));
  check(injected.svg > 0, `extension attributes were injected on ${injected.svg} <svg> roots and ${injected.child} svg children (/about diagram) before/while hydrating`);
  check(injected.child > 0, "svg children (<path>, <rect>) were mutated too");
  await page.goto(BASE + "/", { waitUntil: "networkidle" }); await page.waitForTimeout(300);
  check(bad.length === 0, `injected extension attributes (html, body, svg, svg children, head style): zero console errors and hydration warnings${bad.length ? " " + JSON.stringify(bad.slice(0, 3)) : ""}`);
  check(!bad.some((t) => REACT_WARN.test(t)), "no React hydration or script-tag warning under injection");
  check((await labelLinks(page)) === 0 && (await page.evaluate(() => document.documentElement.dataset.layout)) === "desktop", "desktop layout under injection: rail icons only, data-layout=desktop");
  await page.waitForTimeout(1200);
  const notice = await page.locator("#ext-notice").count();
  if (prod) check(notice === 0, "production never shows the dark-mode extension notice");
  else check(notice === 1, "development shows the dark-mode extension notice when data-darkreader-* is present");
  await ctx.close();
}
// The opt-out for Dark Reader must be a real <meta> element in the served HTML.
{
  const html = await (await fetch(BASE + "/")).text();
  check(/<meta[^>]+name="darkreader-lock"/.test(html), '<meta name="darkreader-lock"> is present in the served HTML');
}
import { layoutMatrix } from "./layout.mjs";
import { cssFaultCheck } from "./css-fault.mjs";
import { featureChecks } from "./features.mjs";
if (prod) skip("StyleProbe appears for a deliberately broken stylesheet", "dev only: the probe is not shipped in production");
await cssFaultCheck({ browser, BASE, check, dev: !prod });
if (process.env.E2E_FLOWS !== "0") await featureChecks({ browser, BASE, check });
await layoutMatrix({ browser, BASE, check, tolerateApiErrors: process.env.E2E_FLOWS === "0" });
// The error boundary (dev/e2e route only; 404 in production): renders with a reference id and produces no "script tag" warning.
if (!prod) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const bad = [];
  page.on("console", (m) => { const t = m.text(); if (["error", "warning"].includes(m.type()) && !/OTS parsing|Failed to decode downloaded font|deliberate render error|ui error|Failed to load resource/.test(t)) bad.push(`${m.type()}: ${t.slice(0, 200)}`); });
  await page.goto(BASE + "/debug-error", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  check(await page.getByText("Something went wrong").first().isVisible(), "the error boundary renders for an unexpected render error");
  check(await page.getByText(/Reference:/).first().isVisible() && await page.getByRole("button", { name: /copy details/i }).isVisible(), "the error boundary shows a reference id and a Copy details button");
  check(!bad.some((t) => /script tag/i.test(t)), `no "Encountered a script tag" warning when the boundary renders${bad.length ? " " + JSON.stringify(bad.slice(0, 2)) : ""}`);
  await ctx.close();
} else {
  skip("error boundary renders with a reference id (/debug-error)", "dev only");
  const r = await fetch(BASE + "/debug-error"); const r2 = await fetch(BASE + "/setup");
  check(r.status === 404 && r2.status === 404, "/debug-error and /setup are 404 in production");
}
// Product flows: URL-addressable selection, keyboard navigation, review action persisted across reload.
// Needs a server with baseline runs (mock or live mode); skipped with E2E_FLOWS=0.
if (process.env.E2E_FLOWS !== "0") {
  const inbox = await (await fetch(BASE + "/api/inbox")).json();
  const target = inbox.messages.find((m) => m.scenario_label === "Scenario 1") ?? inbox.messages[0];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?m=${target.message_id}`, { waitUntil: "networkidle" });
  check(await page.getByRole("heading", { name: /^(ready|needs review|escalate only)$/i }).first().isVisible(), "/?m=<id> opens that message's status strip");
  check((await page.locator('[data-inbox-row][aria-current="true"]').count()) === 1, "the selected row is marked aria-current");
  const approve = page.getByRole("button", { name: /^approve$/i });
  if (await approve.count()) { await approve.click(); await page.getByText(/· recorded\./).first().waitFor(); }
  await page.reload({ waitUntil: "networkidle" });
  check(await page.getByText(/Approved( with your edits)? by you, \d\d:\d\d · recorded\./).first().isVisible(), "review action persists across reload (recorded)");
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.keyboard.press("j");
  check(await page.evaluate(() => document.activeElement?.hasAttribute("data-inbox-row")), "j moves focus to an inbox row");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  check(/[?&]m=[0-9a-f-]{36}/.test(page.url()), "Enter opens the message and puts its id in the URL");
  const groups = await page.locator("section[aria-label] > h2.label-caps").allTextContents();
  const total = groups.reduce((a, t) => a + Number(t.replace(/\D/g, "")), 0);
  check(total === (await page.locator("[data-inbox-row]").count()), `the group counts (${total}) match the rows listed`);
  check((await page.locator('[data-inbox-row][tabindex="0"]').count()) === 1, "roving tabindex: exactly one row is in the tab order");
  await page.keyboard.press("/");
  check(await page.evaluate(() => document.activeElement?.id === "inbox-search"), "/ focuses the search box");
  await page.keyboard.press("Escape"); await page.locator("body").click({ position: { x: 700, y: 400 } });
  await page.keyboard.press("?");
  check(await page.getByRole("dialog", { name: /keyboard shortcuts/i }).isVisible(), "? opens the shortcuts sheet");
  await page.keyboard.press("Escape");
  check((await page.getByRole("dialog").count()) === 0, "Esc closes the sheet");
  check((await page.locator("h1", { hasText: /^Tenant Message Copilot$/ }).count()) === 1, "the title reads exactly Tenant Message Copilot");
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  check(await page.getByRole("heading", { name: "Today" }).isVisible() && await page.getByText(/Start with Scenario 2/).isVisible(), "empty detail pane shows the overview with the suggested start");
  await page.getByRole("button", { name: /A tenant says they paid/ }).first().click(); await page.waitForTimeout(400);
  check(/[?&]m=/.test(page.url()), "a scenario link in the overview opens that message");
  // Opening a stored run: skeleton only, never the live pipeline stepper (checked as soon as the click lands, before the data arrives if possible).
  const stepperSeen = await page.evaluate(() => new Promise((res) => { let seen = false; const t = setInterval(() => { if (document.body.innerText.includes("Gather evidence") || document.body.innerText.includes("Loading the saved draft")) seen = true; }, 5); setTimeout(() => { clearInterval(t); res(seen); }, 900); }));
  check(!stepperSeen, "opening a stored run never shows the pipeline stepper or 'Loading the saved draft'");
  await page.waitForTimeout(500);
  const sum = page.getByTestId("verification-summary");
  check(await sum.count() === 1 && /checks passed|flagged/.test(await sum.innerText()), "status strip shows the verification summary");
  await sum.click(); await page.waitForTimeout(300);
  check(await page.getByRole("tab", { name: /Verification/ }).getAttribute("aria-selected") === "true", "the summary opens the Verification tab");
  await page.getByRole("tab", { name: /^Draft/ }).click(); await page.waitForTimeout(200);
  // Two-way linking: hovering a footnote highlights its evidence card and the ledger row; hovering a ledger row highlights its footnotes.
  const ref = page.locator("a.ref").first();
  if (await ref.count()) {
    await ref.hover(); await page.waitForTimeout(150);
    check(await page.locator("[data-ev][data-hot=true]").count() >= 1, "hovering a footnote highlights its evidence card");
    await page.mouse.move(2, 2);
  }
  const line = page.locator("tr[data-line]").first();
  if (await line.count() && await line.isVisible()) {
    await line.hover(); await page.waitForTimeout(150);
    check(await page.locator("a.ref[data-hot=true], a.quote[data-hot=true]").count() >= 1, "hovering a ledger row highlights the footnote(s) that cite it");
    await page.mouse.move(2, 2);
  } else console.log("SKIP  ledger rows not visible at this width/state");
  // Edit mode shows an inline diff and the change count.
  if (await page.getByRole("button", { name: /^Edit/ }).count()) {
    await page.getByRole("button", { name: /^Edit/ }).first().click(); await page.waitForTimeout(200);
    const ta = page.getByLabel("Edit draft"); const v = await ta.inputValue();
    await ta.fill(v.replace(/\b(\w+)\b/, "$1 kindly")); await page.waitForTimeout(200);
    check(await page.getByTestId("edit-diff").locator("ins").count() >= 1 && /changed/.test(await page.getByTestId("edit-diff").innerText()), "edit mode shows an inline word diff with a change count");
    await page.getByRole("button", { name: /Discard edit/ }).click();
  }
  if (!prod) { // the Next.js dev badge (bottom-right) must not sit on the footer controls or the composer
    const badge = await page.locator("[data-nextjs-dev-tools-button]").first().boundingBox().catch(() => null);
    if (!badge) console.log("SKIP  dev badge not present");
    else for (const [name, loc] of [["footer", page.locator("footer button, footer a")], ["composer", page.locator("textarea")]]) {
      for (let i = 0; i < await loc.count(); i++) {
        const b = await loc.nth(i).boundingBox(); if (!b) continue;
        const overlap = !(b.x + b.width <= badge.x || badge.x + badge.width <= b.x || b.y + b.height <= badge.y || badge.y + badge.height <= b.y);
        check(!overlap, `dev badge does not cover ${name} control ${i}`);
      }
    }
  }
  await ctx.close();
}
const api = await fetch(BASE + "/api/health");
check((api.headers.get("cache-control") ?? "").includes("no-store"), "/api/health: Cache-Control no-store");
check(!!api.headers.get("content-security-policy") && api.headers.get("x-content-type-options") === "nosniff", "/api/health: security headers");
await browser.close();
console.log(fails.length ? `\n${fails.length} check(s) failed` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
