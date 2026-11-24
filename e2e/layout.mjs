// Layout matrix: which layout is active at each width, rail vs top bar, no horizontal overflow, evidence docked from 1360 px else a sheet.
// Runs inside e2e/run.mjs and on its own (CI on windows-latest: `node e2e/layout.mjs` against `next start`, no database needed).
import { createRequire } from "node:module";
const noise = (t) => /OTS parsing|Failed to decode downloaded font/.test(t);
const labelLinks = (page) => page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Primary"] ul a')].filter((a) => a.getClientRects().length && getComputedStyle(a).visibility !== "hidden" && a.innerText.trim()).length);

export async function layoutMatrix({ browser, BASE, check, tolerateApiErrors = false }) {
  const flows = process.env.E2E_FLOWS !== "0";
for (const w of [360, 768, 1024, 1280, 1920]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
  const page = await ctx.newPage();
  const bad = [];
  page.on("console", (m) => { const t = m.text(); if (["error", "warning"].includes(m.type()) && !noise(t) && !(tolerateApiErrors && /Failed to load resource/.test(t))) bad.push(t.slice(0, 160)); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  const desktop = w >= 768;
  check((await page.evaluate(() => document.documentElement.dataset.layout)) === (desktop ? "desktop" : "mobile"), `${w}px: data-layout=${desktop ? "desktop" : "mobile"}`);
  const nav = await page.locator('nav[aria-label="Primary"]').boundingBox();
  check(desktop ? nav.width <= 64 && nav.height > 400 : nav.height <= 64 && nav.width >= w - 2, `${w}px: ${desktop ? "56 px left rail" : "top bar"}`);
  check((await labelLinks(page)) === (desktop ? 0 : 3), `${w}px: ${desktop ? "icons only (no labels)" : "labels shown"}`);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${w}px: no horizontal overflow`);
  const shell = await page.locator("main#main").evaluate((el) => el.closest(".h-dvh").getBoundingClientRect().width).catch(() => null);
  if (shell !== null) check(w >= 1700 ? Math.round(shell) <= 1601 : Math.round(shell) >= w - 1, `${w}px: workspace ${w >= 1700 ? "capped at 1600 px and centred" : "uses the full width"}`);
  check(bad.length === 0, `${w}px: no console errors or warnings${bad.length ? " " + JSON.stringify(bad.slice(0, 2)) : ""}`);
  if (flows && desktop) {
    const inbox = await (await fetch(BASE + "/api/inbox")).json();
    const t = inbox.messages.find((m) => m.scenario_label === "Scenario 2");
    if (t && t.run) {
      await page.goto(BASE + `/?m=${t.message_id}`, { waitUntil: "networkidle" }); await page.waitForTimeout(600);
      const docked = await page.locator('aside[aria-label="Evidence"]').isVisible();
      check(docked === (w >= 1360), `${w}px: evidence rail ${w >= 1360 ? "docked" : "is a sheet (button, not docked)"}`);
    }
  }
  await ctx.close();
}
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("layout.mjs")) {
  let chromium;
  try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch { ({ chromium } = createRequire(`${process.env.GLOBAL_NODE_MODULES ?? ""}/x.js`)("playwright")); }
  const fails = []; const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) fails.push(msg); };
  const browser = await chromium.launch();
  await layoutMatrix({ browser, BASE: process.env.BASE_URL ?? "http://localhost:3000", check, tolerateApiErrors: true });
  await browser.close();
  console.log(fails.length ? `\n${fails.length} check(s) failed` : "\nlayout matrix passed");
  process.exit(fails.length ? 1 : 0);
}
