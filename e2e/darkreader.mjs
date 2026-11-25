// Optional, NOT in CI: loads the real Dark Reader extension (unpacked) into a persistent Chromium profile and asserts the app still renders the
// desktop layout with zero console errors and zero React warnings.
//   1. Download Dark Reader's Chromium build and unzip it (a folder containing manifest.json).
//   2. PowerShell:  $env:DARKREADER_DIR="C:\ext\darkreader"; $env:BASE_URL="http://localhost:3000"; npm run e2e:darkreader
//      bash:        DARKREADER_DIR=/path/to/darkreader BASE_URL=http://localhost:3000 npm run e2e:darkreader
// Extensions need a headed (or new-headless) persistent context, so this launches a visible Chromium window.
import { chromium } from "playwright";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
const dir = process.env.DARKREADER_DIR;
if (!dir || !fs.existsSync(path.join(dir, "manifest.json"))) { console.error("Set DARKREADER_DIR to the unpacked Dark Reader folder (it must contain manifest.json). See the header of e2e/darkreader.mjs."); process.exit(2); }
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "dr-")), { headless: false, viewport: { width: 1920, height: 1000 }, args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`] });
const page = await ctx.newPage(); const bad = [];
page.on("console", (m) => { const t = m.text(); if (["error", "warning"].includes(m.type()) && !/OTS parsing|Failed to decode downloaded font/.test(t)) bad.push(t.slice(0, 200)); });
await page.goto(BASE + "/", { waitUntil: "networkidle" }); await page.waitForTimeout(2500);
const labels = await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Primary"] ul a')].filter((a) => a.getClientRects().length && a.innerText.trim()).length);
const layout = await page.evaluate(() => document.documentElement.dataset.layout);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
const locked = await page.evaluate(() => !document.querySelector("style.darkreader"));
console.log(`layout=${layout} labelLinksVisible=${labels} horizontalOverflow=${overflow} darkReaderStyleInjected=${!locked} consoleProblems=${bad.length}`);
for (const b of bad) console.log("  " + b);
await ctx.close();
process.exit(layout === "desktop" && labels === 0 && !overflow && bad.length === 0 ? 0 : 1);
