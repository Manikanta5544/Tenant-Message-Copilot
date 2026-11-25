// Development server only. Proves that when the browser holds an old stylesheet, StyleProbe names the cause and the reset button repairs it.
//   (A) the first CSS response is replaced by a copy without the layout skeleton (what a stale cache hands out); later requests are real.
//   (B) a service worker from "an earlier project" answers every stylesheet request with that stripped copy.
// Usage: BASE_URL=http://localhost:3000 npm run e2e:stale     (npm run dev must be running; production builds never show the probe)
import { chromium } from "playwright";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
let pass = 0, total = 0;
const check = (ok, msg) => { total++; if (ok) pass++; console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };
const strip = (css) => css.replace(/\n\.shell \{[\s\S]*?(?=@supports not selector)/, "\n");
const railDirection = (page) => page.evaluate(() => { const r = document.querySelector(".rail"); return r ? getComputedStyle(r).flexDirection : "none"; });

const browser = await chromium.launch();
try {
  // (A) stale cache
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    let served = false;
    await ctx.route(/\/_next\/static\/.*\.css(\?|$)/, async (route) => {
      const res = await route.fetch(); const body = await res.text();
      if (!served && body.includes("\n.shell {")) { served = true; return route.fulfill({ response: res, body: strip(body) }); }
      return route.fulfill({ response: res, body });
    });
    const page = await ctx.newPage();
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    const probe = page.getByTestId("style-probe");
    await probe.waitFor({ timeout: 8000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelector('[data-testid="style-probe"] [data-cause]')?.getAttribute("data-cause") !== "pending", null, { timeout: 8000 }).catch(() => {});
    const cause = await probe.locator("[data-cause]").getAttribute("data-cause").catch(() => "none");
    check(cause === "stale-cache", `A: probe names a stale stylesheet (cause=${cause})`);
    await page.getByRole("button", { name: "Reset site data and reload" }).click();
    await page.waitForLoadState("networkidle"); await page.waitForTimeout(1500);
    const dir = await railDirection(page);
    check(dir === "column" && (await probe.count()) === 0, `A: after reset the rail is flex-direction ${dir} and the probe is gone`);
    await ctx.close();
  }
  // (B) service worker
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "allow" });
    const swSource = `const strip = (css) => css.replace(/\\n\\.shell \\{[\\s\\S]*?(?=@supports not selector)/, "\\n");
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => { if (/\\.css(\\?|$)/.test(e.request.url)) e.respondWith(fetch(e.request).then(async (r) => new Response(strip(await r.text()), { headers: { "content-type": "text/css" } }))); });`;
    await ctx.route("**/old-sw.js", (route) => route.fulfill({ status: 200, contentType: "text/javascript", headers: { "Service-Worker-Allowed": "/" }, body: swSource }));
    const page = await ctx.newPage();
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.evaluate(async () => { await navigator.serviceWorker.register("/old-sw.js", { scope: "/" }); await navigator.serviceWorker.ready; });
    await page.reload({ waitUntil: "networkidle" });
    const probe = page.getByTestId("style-probe");
    await probe.waitFor({ timeout: 8000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelector('[data-testid="style-probe"] [data-cause]')?.getAttribute("data-cause") !== "pending", null, { timeout: 8000 }).catch(() => {});
    const cause = await probe.locator("[data-cause]").getAttribute("data-cause").catch(() => "none");
    check(cause === "service-worker", `B: probe names the service worker (cause=${cause})`);
    await page.getByRole("button", { name: "Reset site data and reload" }).click();
    await page.waitForLoadState("networkidle"); await page.waitForTimeout(1500);
    const regs = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
    const dir = await railDirection(page);
    check(regs === 0 && dir === "column" && (await probe.count()) === 0, `B: after reset ${regs} registrations, rail ${dir}, probe gone`);
    await ctx.close();
  }
} finally { await browser.close(); }
console.log(`${pass}/${total} checks passed`);
process.exit(pass === total ? 0 : 1);
