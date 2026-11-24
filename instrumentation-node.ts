// Node-only startup banner (imported by instrumentation.ts; kept in its own file so the edge bundle never sees pg). In development it prints one boxed, unmissable block of actionable lines
// when setup is incomplete, so the developer sees the problem immediately (not only in the predev output that scrolls away).
// It never throws and never blocks startup.
export async function banner() {
  try {
    const { runChecks, failureLines } = await import("./db/diagnostics");
    const lines = failureLines(await runChecks(process.env));
    if (!lines.length) return;
    const wrap = (s: string) => s.match(/.{1,100}(\s|$)/g)?.map((x) => x.trimEnd()) ?? [s];
    const body = lines.flatMap((l) => ["- " + wrap(l)[0], ...wrap(l).slice(1).map((x) => "  " + x)]);
    const w = Math.max(60, ...body.map((l) => l.length));
    const bar = "+" + "-".repeat(w + 2) + "+";
    const row = (s: string) => `| ${s.padEnd(w)} |`;
    console.warn(["", bar, row("TENANT MESSAGE COPILOT: SETUP INCOMPLETE (the app will start, but parts will not work)"), bar, ...body.map(row), bar, row("Open http://localhost:3000/setup for a live checklist with the exact commands."), bar, ""].join("\n"));
  } catch { /* diagnostics must never stop the server */ }
}
