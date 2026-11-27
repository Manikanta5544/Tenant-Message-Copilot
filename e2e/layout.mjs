// Layout matrix: which layout is active at each width, rail vs top bar, no horizontal overflow, evidence docked from 1360 px else a sheet.
// Runs inside e2e/run.mjs and on its own (CI on windows-latest: `node e2e/layout.mjs` against `next start`, no database needed).
import { chromium } from "playwright";
const noise = (t) => /OTS parsing|Failed to decode downloaded font/.test(t);
const labelLinks = (page) => page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Primary"] ul a')].filter((a) => a.getClientRects().length && getComputedStyle(a).visibility !== "hidden" && a.innerText.trim()).length);

export const WIDTHS = [320, 360, 390, 768, 1024, 1100, 1280, 1366, 1536, 1920];
const EXT = () => {
  const touch = () => {
    document.documentElement.setAttribute("data-darkreader-mode", "dynamic");
    document.body?.setAttribute("cz-shortcut-listen", "true");
    document.querySelectorAll("svg, svg *").forEach((v) => v.setAttribute("data-darkreader-inline-stroke", ""));
    if (document.head && !document.head.querySelector("style.darkreader")) { const st = document.createElement("style"); st.className = "darkreader"; st.textContent = "/* extension */"; document.head.appendChild(st); }
  };
  new MutationObserver(touch).observe(document, { subtree: true, childList: true });
  document.addEventListener("DOMContentLoaded", touch);
};

/** Layout matrix: every width, device pixel ratio 1 and 2, root font 16 and 24 px, with extension attributes injected.
 *  Per cell: data-layout, rail or top bar, one pane at a time on phones, no horizontal overflow, no console error or warning.
 *  A px breakpoint means the enlarged root font must NOT change which layout is active. */
export async function layoutMatrix({ browser, BASE, check, tolerateApiErrors = false, quick = process.env.E2E_QUICK === "1" }) {
  const flows = process.env.E2E_FLOWS !== "0";
  const widths = quick ? [360, 768, 1280, 1920] : WIDTHS;
  let sel = null;
  if (flows) { try { const inbox = await (await fetch(BASE + "/api/inbox")).json(); sel = inbox.messages.find((m) => m.scenario_label === "Scenario 2" && m.run); } catch { /* no API */ } }
  const bad = [];
  for (const w of widths) for (const dsf of quick ? [1] : [1, 2]) for (const font of quick ? [16] : [16, 24]) {
    const tag = `${w}px dpr${dsf} font${font}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: dsf });
    await ctx.addInitScript(EXT);
    const page = await ctx.newPage();
    const probs = [];
    page.on("console", (m) => { const t = m.text(); if (["error", "warning"].includes(m.type()) && !noise(t) && !(tolerateApiErrors && /Failed to load resource/.test(t))) probs.push(t.slice(0, 160)); });
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    if (font !== 16) await page.addStyleTag({ content: `html{font-size:${font}px !important}` });
    await page.waitForTimeout(250);
    const desktop = w >= 768;
    const ok = [];
    ok.push([(await page.evaluate(() => document.documentElement.dataset.layout)) === (desktop ? "desktop" : "mobile"), "data-layout"]);
    const nav = await page.locator('nav[aria-label="Primary"]').boundingBox();
    ok.push([desktop ? nav.width <= 64 && nav.height > 400 : nav.height <= 80 * (font / 16) && nav.width >= w - 2, desktop ? "56 px rail" : "top bar"]);
    ok.push([(await labelLinks(page)) === 0, "no text links in the bar (icons on desktop, a menu button on phones)"]);
    ok.push([await page.getByRole("button", { name: "Open menu" }).isVisible() === !desktop, desktop ? "no menu button on desktop" : "menu button on phones"]);
    ok.push([desktop || (await page.getByTestId("section-title").innerText()) === "Inbox", desktop ? "rail" : "top bar names the section"]);
    ok.push([await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no horizontal overflow on /"]);
    const panes = await page.evaluate(() => { const v = (s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }; return { list: v(".pane-list"), detail: v(".pane-detail") }; });
    ok.push([desktop ? panes.list && panes.detail : panes.list && !panes.detail, desktop ? "list and detail side by side" : "phone shows the list only"]);
    const shell = await page.evaluate(() => document.querySelector(".shell")?.getBoundingClientRect().width ?? 0);
    ok.push([w >= 1700 ? Math.round(shell) <= 1601 : Math.round(shell) >= w - 1, w >= 1700 ? "capped at 1600 px" : "full width"]);
    if (sel) {
      await page.goto(BASE + `/?m=${sel.message_id}`, { waitUntil: "networkidle" });
      if (font !== 16) await page.addStyleTag({ content: `html{font-size:${font}px !important}` });
      // Wait for the condition, not a fixed time: against a remote database (Neon) the detail and the evidence rail arrive hundreds of ms later.
      await page.locator(w >= 1360 ? ".evidence-dock" : ".pane-detail").first().waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(100);
      const d = await page.evaluate(() => { const v = (s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }; return { list: v(".pane-list"), detail: v(".pane-detail"), dock: v(".evidence-dock") }; });
      ok.push([desktop ? d.list && d.detail : d.detail && !d.list, desktop ? "detail opens beside the list" : "phone shows the detail only"]);
      ok.push([d.dock === (w >= 1360), w >= 1360 ? "evidence rail docked" : "evidence is a sheet (button), not docked"]);
      ok.push([await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no horizontal overflow on a message"]);
    }
    for (const [pth] of quick ? [] : [["/evals"], ["/about"]]) {
      await page.goto(BASE + pth, { waitUntil: "networkidle" });
      if (font !== 16) await page.addStyleTag({ content: `html{font-size:${font}px !important}` });
      await page.waitForTimeout(200);
      ok.push([await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no horizontal overflow on ${pth}`]);
    }
    const failed = ok.filter(([k]) => !k).map(([, n]) => n);
    check(failed.length === 0 && probs.length === 0, `${tag}: ${ok.length} layout checks${failed.length ? " FAILED: " + failed.join("; ") : ""}${probs.length ? " console: " + JSON.stringify(probs.slice(0, 2)) : ""}`);
    await ctx.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("layout.mjs")) {
  const fails = []; const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) fails.push(msg); };
  const browser = await chromium.launch();
  await layoutMatrix({ browser, BASE: process.env.BASE_URL ?? "http://localhost:3000", check, tolerateApiErrors: true });
  await browser.close();
  console.log(fails.length ? `\n${fails.length} check(s) failed` : "\nlayout matrix passed");
  process.exit(fails.length ? 1 : 0);
}
