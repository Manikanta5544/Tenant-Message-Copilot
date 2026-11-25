#!/usr/bin/env node
// Reproduces the stale-stylesheet fault against a running DEVELOPMENT server (default Turbopack: `npm run dev`).
// A normal browser profile loads the page, the profile is closed, globals.css gains a marker rule, the same profile opens the page again.
// "marker seen" means the browser used the new stylesheet; "marker NOT seen" means it kept the old one from its HTTP cache.
// Usage: BASE_URL=http://localhost:3000 node scripts/repro-stale-css.mjs        (restores globals.css afterwards)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const CSS = path.join("app", "globals.css");
const original = fs.readFileSync(CSS, "utf8");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "tmc-profile-"));
const marker = `repro-${Date.now()}`;
const has = (ctx) => ctx.pages()[0].evaluate((m) => [...document.styleSheets].some((s) => { try { return [...s.cssRules].some((r) => r.cssText.includes(m)); } catch { return false; } }), marker);
const open = async () => { const ctx = await chromium.launchPersistentContext(profile, { headless: true }); const page = ctx.pages()[0] ?? await ctx.newPage(); await page.goto(BASE + "/", { waitUntil: "networkidle" }); return ctx; };
let result = 2;
try {
  let ctx = await open();
  const first = await ctx.pages()[0].evaluate(() => [...document.styleSheets].map((s) => s.href).filter(Boolean));
  await ctx.close();
  fs.writeFileSync(CSS, `${original}\n.${marker} { outline: 1px solid red; }\n`);
  let served = false;
  for (let i = 0; i < 60 && !served; i++) { await new Promise((r) => setTimeout(r, 500)); const html = await (await fetch(BASE + "/")).text(); for (const u of html.match(/\/_next\/static\/[^"']+\.css/g) ?? []) { if (!served && (await (await fetch(BASE + u)).text()).includes(marker)) { served = true; console.log(`server now serves the marker at ${u}`); } } }
  if (!served) throw new Error("the dev server did not rebuild the stylesheet within 30 s");
  ctx = await open();
  const second = await ctx.pages()[0].evaluate(() => [...document.styleSheets].map((s) => s.href).filter(Boolean));
  const seen = await has(ctx);
  console.log(`first load stylesheets:  ${first.join(", ")}\nsecond load stylesheets: ${second.join(", ")}\nsame URL after the edit: ${JSON.stringify(first) === JSON.stringify(second)}\nmarker ${seen ? "seen (the new stylesheet was used)" : "NOT seen (the browser kept the old stylesheet)"}`);
  await ctx.close();
  result = seen ? 0 : 1;
} finally { fs.writeFileSync(CSS, original); fs.rmSync(profile, { recursive: true, force: true }); }
process.exit(result);
