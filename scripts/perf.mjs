#!/usr/bin/env node
// Front-end budgets, measured in a real Chromium against a PRODUCTION server (npm run build && npm start, or any deployed URL).
//   JS on first load of /   ≤ 170 KB gzip      LCP ≤ 1.5 s      CLS ≤ 0.02      TBT ≤ 150 ms (long tasks over 50 ms, load to idle)
//   selection → draft shown ≤ 250 ms           search keystroke → paint ≤ 50 ms
// Usage: BASE_URL=http://localhost:3000 npm run perf        (Chromium comes from the pinned Playwright: npx playwright install chromium)
import { chromium } from "playwright";
import { gzipSync } from "node:zlib";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const RUNS = Number(process.env.PERF_RUNS ?? 5);
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

const browser = await chromium.launch();
const results = { js: [], lcp: [], cls: [], tbt: [], sel: [], search: [] };
for (let i = 0; i < RUNS; i++) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  let jsBytes = 0;
  page.on("response", async (r) => { if ((r.headers()["content-type"] ?? "").includes("javascript")) { try { jsBytes += gzipSync(await r.body()).length; } catch { /* aborted */ } } });
  await page.addInitScript(() => {
    window.__p = { lcp: 0, cls: 0, tasks: [] };
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__p.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__p.cls += e.value; }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__p.tasks.push([e.startTime, e.duration]); }).observe({ type: "longtask", buffered: true });
  });
  // "load" rather than "networkidle": the detail view is prefetched 4 s after load, when idle, and is not part of first load.
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.waitForSelector("[data-inbox-row]");
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => { const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0; return { ...window.__p, fcp }; });
  const enc = await page.evaluate(() => performance.getEntriesByType("resource").filter((e) => e.initiatorType === "script" || /\.js(\?|$)/.test(e.name)).reduce((a, e) => a + (e.encodedBodySize || e.transferSize || 0), 0));
  results.js.push(Math.max(jsBytes, enc) / 1024); results.lcp.push(m.lcp); results.cls.push(m.cls);
  results.tbt.push(m.tasks.filter(([s]) => s >= m.fcp).reduce((a, [, d]) => a + Math.max(0, d - 50), 0));
  // Selection to draft: click a stored scenario row, measure until the draft text is in the document.
  const rows = page.locator("[data-inbox-row]");
  const idx = await page.evaluate(() => [...document.querySelectorAll("[data-inbox-row]")].findIndex((r) => r.textContent.includes("Scenario")));
  const t0 = Date.now();
  await rows.nth(Math.max(0, idx)).click();
  await page.waitForSelector(".letter, [data-testid=escalation]", { timeout: 5000 }).catch(() => {});
  results.sel.push(Date.now() - t0);
  // Search keystroke to paint: type one character, wait for two animation frames.
  await page.keyboard.press("Escape").catch(() => {});
  const box = page.getByRole("searchbox").or(page.getByPlaceholder(/search/i)).first();
  if (await box.count()) {
    await box.click();
    const dt = await page.evaluate(async () => {
      const el = document.activeElement; const t = performance.now();
      el.value = "rent"; el.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return performance.now() - t;
    });
    results.search.push(dt);
  }
  await ctx.close();
}
await browser.close();
const rows = [
  ["JS on first load (gzip KB)", med(results.js), 170], ["LCP (ms)", med(results.lcp), 1500], ["CLS", med(results.cls), 0.02],
  ["TBT (ms)", med(results.tbt), 150], ["selection to draft shown (ms)", med(results.sel), 250], ["search keystroke to paint (ms)", results.search.length ? med(results.search) : NaN, 50],
];
let miss = 0;
console.log(`Front-end performance, ${RUNS} cold loads (median), ${BASE}, Chromium 1280x800, no throttling.\n\n| metric | measured | budget | result |\n|---|---|---|---|`);
for (const [n, v, b] of rows) { const ok = !Number.isNaN(v) && v <= b; if (!ok) miss++; console.log(`| ${n} | ${Number.isNaN(v) ? "not measured" : (n === "CLS" ? v.toFixed(3) : v.toFixed(0))} | ≤ ${b} | ${ok ? "pass" : "FAIL"} |`); }
process.exit(miss ? 1 : 0);
