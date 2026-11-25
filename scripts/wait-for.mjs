// Usage: node scripts/wait-for.mjs <url> [seconds]
// Polls the URL every 500 ms (2 s per attempt) until it answers 2xx. Exit 0 on success; exit 1 on timeout, printing the last error.
const [url, secs = "60"] = process.argv.slice(2);
if (!url) { console.error("usage: node scripts/wait-for.mjs <url> [seconds]"); process.exit(2); }
const deadline = Date.now() + Number(secs) * 1000;
let last = "no attempt finished";
while (Date.now() < deadline) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (res.ok) { console.log(`${url} answered ${res.status}`); process.exit(0); }
    last = `HTTP ${res.status}`;
  } catch (e) { last = e instanceof Error ? `${e.name}: ${e.message}` : String(e); }
  await new Promise((r) => setTimeout(r, 500));
}
console.error(`timed out after ${secs}s waiting for ${url}; last error: ${last}`);
process.exit(1);
