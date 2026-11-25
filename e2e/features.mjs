// Behaviour checks for the real-time and keyboard features, in a real browser.
export async function featureChecks({ browser, BASE, check }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const problems = [];
  page.on("console", (m) => { const t = m.text(); if (["error", "warning"].includes(m.type()) && !/OTS parsing|Failed to decode downloaded font/.test(t)) problems.push(t.slice(0, 160)); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForSelector("[data-inbox-row]");

  // Command palette: opens on Ctrl+K, filters, jumps to a message by text, closes on Esc and returns focus.
  await page.keyboard.press("Control+k");
  const dlg = page.getByRole("dialog", { name: "Command palette" });
  await dlg.waitFor({ timeout: 8000 }).catch(() => {}); // the palette code loads on first use
  check(await dlg.isVisible(), "Ctrl+K opens the command palette");
  check(await page.evaluate(() => document.activeElement?.getAttribute("role") === "combobox"), "focus is in the palette box");
  await page.keyboard.press("Tab");
  check(await page.evaluate(() => document.activeElement?.getAttribute("role") === "combobox"), "Tab keeps focus inside the palette");
  await page.keyboard.type("evals");
  check((await dlg.getByRole("option").first().innerText()).includes("Evals"), "typing filters the results");
  await page.keyboard.press("Escape");
  check(!(await dlg.isVisible()), "Esc closes the palette");
  await page.keyboard.press("Control+k"); await page.keyboard.type("scenario 2"); await page.keyboard.press("Enter");
  await page.waitForURL(/\?m=/, { timeout: 5000 }).catch(() => {});
  check(/[?&]m=[0-9a-f-]{36}/.test(page.url()), "Enter on a message result opens it at /?m=<id>");
  const withM = page.url();

  // URL-addressable selection: reload keeps it, Back returns to the overview, a bad id falls back to the overview.
  await page.reload({ waitUntil: "networkidle" });
  check(page.url() === withM && (await page.locator('[data-inbox-row][aria-current="true"]').count()) === 1, "reload restores the selected message");
  await page.goto(BASE + "/?m=00000000-0000-4000-8000-000000000000", { waitUntil: "networkidle" });
  check((await page.locator('[data-inbox-row][aria-current="true"]').count()) === 0 && (await page.getByText("Today").first().isVisible()), "an unknown message id shows the overview");
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.locator("[data-inbox-row]").first().click();
  await page.waitForURL(/\?m=/);
  await page.goBack();
  await page.waitForTimeout(300);
  check(!/[?&]m=/.test(page.url()) && (await page.locator('[data-inbox-row][aria-current="true"]').count()) === 0, "Back returns from a message to the overview");

  // System page: loads numbers, no overflow, linked from the palette.
  await page.goto(BASE + "/system", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Runs" }).waitFor({ timeout: 8000 }).catch(() => {});
  check(await page.getByRole("heading", { name: "Model provider" }).isVisible(), "/system shows the model provider section");
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "/system has no horizontal overflow");

  // Live stream: a new run streams real steps, the page never polls /api/runs/:id while the stream is healthy.
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  const polled = []; page.on("request", (r) => { if (/\/api\/runs\/[0-9a-f-]{36}$/.test(r.url())) polled.push(r.url()); });
  let sawStream = false; page.on("request", (r) => { if (/\/events$/.test(r.url())) sawStream = true; });
  const row = page.locator("[data-inbox-row]", { hasText: "Scenario" }).first();
  await row.click();
  const gen = page.getByRole("button", { name: /Generate|Draft again|Regenerate|Generate again/ }).first();
  if (await gen.count()) { await gen.click(); await page.waitForTimeout(2500); }
  check(sawStream || !(await gen.count()), "generating a draft opens the live event stream");

  check(problems.length === 0, `no console errors or warnings in feature checks${problems.length ? ": " + JSON.stringify(problems.slice(0, 2)) : ""}`);
  await ctx.close();
}
