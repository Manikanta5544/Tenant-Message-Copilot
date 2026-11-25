// Reproduces the owner's failure class: the utility (md:) responsive rules are missing from the served CSS, as when a stale cache or an
// extension rewrites the stylesheet. The hand-written skeleton (.rail, .panes, .detail-grid ...) must still give a usable layout, and in
// development StyleProbe must say what is wrong.
const strip = (css, test) => {
  let out = "", i = 0; const re = /@media\s*\((?:min-width:\s*|width\s*>=\s*)(?:768|1024|1360|1536|1700|640)px\)\s*\{/g; let m;
  while ((m = re.exec(css))) {
    let d = 1, j = re.lastIndex; while (j < css.length && d) { const c = css[j++]; if (c === "{") d++; else if (c === "}") d--; }
    const body = css.slice(re.lastIndex, j - 1);
    if (test(body)) { out += css.slice(i, m.index); i = j; re.lastIndex = j; }
  }
  return out + css.slice(i);
};
/** Removes every min-width block that contains a Tailwind responsive utility (selectors like .md\:flex), keeping the plain skeleton blocks. */
export const dropUtilityBreakpoints = (css) => strip(css, (b) => /\.(md|lg|xl|dock|wide)\\:/.test(b) && !/\.rail\s*\{/.test(b));

export async function cssFaultCheck({ browser, BASE, check, dev }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.route(/\.css(\?|$)/, async (route) => {
    const res = await route.fetch(); const body = await res.text();
    await route.fulfill({ response: res, body: dropUtilityBreakpoints(body) });
  });
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "networkidle" }); await page.waitForTimeout(1600);
  const nav = await page.locator('nav[aria-label="Primary"]').boundingBox();
  check(nav.width <= 64 && nav.height > 400, "css fault: the skeleton still renders the 56 px left rail at 1280 px");
  const panes = await page.evaluate(() => { const l = document.querySelector(".pane-list")?.getBoundingClientRect(), d = document.querySelector(".pane-detail")?.getBoundingClientRect(); return l && d ? { l: l.width, d: d.width, gap: d.left - l.right } : null; });
  check(!!panes && panes.l >= 300 && panes.d >= 400, `css fault: list and detail panes sit side by side (list ${Math.round(panes?.l)} px, detail ${Math.round(panes?.d)} px)`);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "css fault: no horizontal overflow");
  if (dev) check(await page.getByTestId("style-probe").count() === 1, "css fault: StyleProbe tells the developer the stylesheet is partial");
  await ctx.close();
}
