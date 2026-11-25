#!/usr/bin/env node
// Load test: N concurrent visitors (distinct X-Forwarded-For, so distinct visitor identities; the server must run with TRUST_PROXY=1),
// each doing: inbox, open a stored scenario (and revalidate it), create a mock run, listen to its live stream.
// Usage: BASE_URL=http://localhost:3100 npm run load -- [visitors=50]
// Needs the demo in mock mode with a high enough daily budget (see README "Load test"). Prints a markdown report and exits 1 if a budget is missed.
import { performance } from "node:perf_hooks";
import { readFileSync, readdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const N = Number(process.argv[2] ?? process.env.LOAD_VISITORS ?? 50);
const BUDGET = { inbox: 120, run_get: 80, run_304: 30, create: 150, sse_first: 300 };
const t = { inbox: [], run_get: [], run_304: [], create: [], sse_first: [], sse_done: [] };
const codes = {}; let n429 = 0, total = 0, errors = 0;
const note = (s) => { codes[s] = (codes[s] ?? 0) + 1; total++; if (s === 429) n429++; };
const pct = (a, p) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const timed = async (bucket, fn) => { const t0 = performance.now(); const r = await fn(); if (bucket) t[bucket].push(performance.now() - t0); return r; };

async function sseFirst(url, headers) {
  const t0 = performance.now(); let first = null;
  const res = await fetch(url, { headers: { ...headers, accept: "text/event-stream" } });
  note(res.status);
  if (!res.ok) { await res.text().catch(() => {}); return; }
  const rd = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { done, value } = await rd.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    if (first === null && /event: (trace|done)/.test(buf)) { first = performance.now() - t0; t.sse_first.push(first); }
    if (/event: done/.test(buf)) { t.sse_done.push(performance.now() - t0); break; }
  }
  try { await rd.cancel(); } catch { /* closed */ }
}

async function visitor(i, seeded) {
  const h = { "x-forwarded-for": `10.${(i >> 8) & 255}.${i & 255}.${(i * 7) % 250 + 1}` };
  try {
    const r1 = await timed("inbox", () => fetch(`${BASE}/api/inbox`, { headers: h })); note(r1.status); const inbox = await r1.json();
    const stored = inbox.messages.find((m) => m.run && m.scenario_label) ?? inbox.messages.find((m) => m.run);
    if (stored) {
      const r2 = await timed("run_get", () => fetch(`${BASE}/api/runs/${stored.run.id}`, { headers: h })); note(r2.status);
      const etag = r2.headers.get("etag"); await r2.arrayBuffer();
      if (etag) { const r3 = await timed("run_304", () => fetch(`${BASE}/api/runs/${stored.run.id}`, { headers: { ...h, "if-none-match": etag } })); note(r3.status); await r3.arrayBuffer(); }
    }
    const target = seeded[i % seeded.length];
    const r4 = await timed("create", () => fetch(`${BASE}/api/runs`, { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ message_id: target, idempotency_key: crypto.randomUUID() }) }));
    note(r4.status); const j = await r4.json().catch(() => ({}));
    if (r4.ok && j.run_id) await sseFirst(`${BASE}/api/runs/${j.run_id}/events`, h);
  } catch (e) { errors++; console.error("visitor", i, String(e).slice(0, 120)); }
}

const inbox0 = await (await fetch(`${BASE}/api/inbox`, { headers: { "x-forwarded-for": "10.255.255.1" } })).json();
const seeded = inbox0.messages.map((m) => m.message_id);
// Warm the routes once (a dev server compiles on first hit) so the numbers measure serving, not compiling.
await Promise.all(["/api/inbox", "/api/system"].map((p) => fetch(BASE + p).then((r) => r.arrayBuffer())));
const before = await (await fetch(`${BASE}/api/system`)).json().catch(() => null);
const rss0 = rssMb();
function rssMb() { try { let max = 0; for (const d of readdirSync("/proc")) { if (!/^\d+$/.test(d)) continue; try { const cmd = readFileSync(`/proc/${d}/cmdline`, "utf8"); if (!/next-server|next dev/.test(cmd)) continue; const m = /VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${d}/status`, "utf8")); if (m) max = Math.max(max, Number(m[1]) / 1024); } catch { /* gone */ } } return max || null; } catch { return null; } }

const t0 = performance.now();
await Promise.all(Array.from({ length: N }, (_, i) => visitor(i, seeded)));
const wall = (performance.now() - t0) / 1000;
const after = await (await fetch(`${BASE}/api/system`)).json().catch(() => null);

const rows = [["inbox (GET /api/inbox)", "inbox", BUDGET.inbox], ["stored run (GET /api/runs/:id)", "run_get", BUDGET.run_get], ["stored run revalidated (304)", "run_304", BUDGET.run_304], ["create run (POST /api/runs)", "create", BUDGET.create], ["stream: first event", "sse_first", BUDGET.sse_first]];
let miss = 0; const f = (x) => (Number.isNaN(x) ? "n/a" : x.toFixed(0));
const out = [`Load test: ${N} concurrent visitors against ${BASE}, ${wall.toFixed(1)} s wall.\n`, "| operation | n | p50 ms | p95 ms | p99 ms | budget p95 ms | result |", "|---|---|---|---|---|---|---|"];
for (const [name, k, b] of rows) { const p95 = pct(t[k], 0.95); const ok = !Number.isNaN(p95) && p95 <= b; if (!ok) miss++; out.push(`| ${name} | ${t[k].length} | ${f(pct(t[k], 0.5))} | ${f(p95)} | ${f(pct(t[k], 0.99))} | ${b} | ${ok ? "pass" : "FAIL"} |`); }
out.push(`| stream: until done | ${t.sse_done.length} | ${f(pct(t.sse_done, 0.5))} | ${f(pct(t.sse_done, 0.95))} | ${f(pct(t.sse_done, 0.99))} | none | info |`);
const c5 = Object.entries(codes).filter(([s]) => Number(s) >= 500).reduce((a, [, v]) => a + v, 0);
if (c5 > 0 || errors > 0) miss++;
out.push(`\nResponses: ${total}; status codes ${JSON.stringify(codes)}; 5xx ${c5} (budget 0); client errors ${errors}; 429 rate ${(n429 / Math.max(1, total) * 100).toFixed(1)}%.`);
if (after) out.push(`Pool wait (server): p50 ${after.pool?.wait_p50_ms} ms, p95 ${after.pool?.wait_p95_ms} ms, max ${after.pool?.wait_max_ms} ms (pool size ${after.pool?.max}). Model calls busy: ${after.provider?.busy_1h}. Streams open after: ${after.limits?.streams_open}.`);
const rss1 = rssMb(); if (rss0 !== null) out.push(`Server memory (RSS): ${rss0.toFixed(0)} MB before, ${rss1?.toFixed(0)} MB after.`);
if (process.env.DATABASE_URL_OWNER) {
  const { default: pg } = await import("pg"); const c = new pg.Client({ connectionString: process.env.DATABASE_URL_OWNER }); await c.connect();
  const q = async () => Number((await c.query("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()")).rows[0].count);
  const a = await q(); await new Promise((r) => setTimeout(r, 12_000)); const b = await q(); await c.end();
  out.push(`Postgres connections for this database: ${a} right after, ${b} after 12 s idle (pool idle timeout 10 s).`);
} else out.push("Postgres connections: not measured (set DATABASE_URL_OWNER to include pg_stat_activity).");
console.log(out.join("\n"));
process.exit(miss ? 1 : 0);
