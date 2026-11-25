import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MockProvider } from "../core/providers/mock";
import { closeAllPools } from "../db/client";
import { uid } from "../db/ids";
import { createRun, getRun, visitorHash, type TraceRow } from "../db/runs";
import { StreamCaps, runEventStream } from "../app/server/sse";
import { APP_URL, HAS_DB } from "./helpers";

process.env.DATABASE_URL_APP = APP_URL;
process.env.DEMO_AS_OF_DATE = "2026-11-19";
process.env.DEMO_DAILY_BUDGET_USD = "50";

const ev = (seq: number): TraceRow => ({ seq, stage: `s${seq}`, model: null, tokens_in: 0, tokens_out: 0, cost_micro_usd: 0, latency_ms: 1, outcome: "ok", payload: {}, created_at: new Date().toISOString() });
async function read(stream: ReadableStream<Uint8Array>) {
  const text = await new Response(stream).text();
  return text.split("\n\n").filter(Boolean).map((b) => { const f: Record<string, string> = {}; for (const l of b.split("\n")) { const i = l.indexOf(":"); if (i > 0) f[l.slice(0, i)] = l.slice(i + 1).trim(); else if (l.startsWith(":")) f.comment = l.slice(1).trim(); } return f; });
}

describe("runEventStream (unit)", () => {
  it("sends retry, each trace event once with its seq as id, then done with the final payload, then closes", async () => {
    const batches = [{ status: "running", age_s: 1, events: [ev(1), ev(2)] }, { status: "running", age_s: 1, events: [ev(3)] }, { status: "completed", age_s: 2, events: [ev(4)] }];
    let i = 0; const seen: number[] = [];
    const frames = await read(runEventStream({ poll: async (n) => { seen.push(n); return batches[i++]!; }, final: async () => ({ run: { status: "completed" } }), signal: new AbortController().signal, pollMs: 1 }));
    expect(frames[0]).toMatchObject({ retry: "2000" });
    expect(frames.filter((f) => f.event === "trace").map((f) => f.id)).toEqual(["1", "2", "3", "4"]);
    expect(frames.at(-1)).toMatchObject({ event: "done" });
    expect(JSON.parse(frames.at(-1)!.data!)).toEqual({ run: { status: "completed" } });
    expect(seen).toEqual([0, 2, 3]); // each poll asks only for rows after the last one sent
  });
  it("resumes after Last-Event-ID", async () => {
    let asked = -1;
    await read(runEventStream({ poll: async (n) => { asked = n; return { status: "completed", age_s: 1, events: [] }; }, final: async () => ({}), signal: new AbortController().signal, afterSeq: 5, pollMs: 1 }));
    expect(asked).toBe(5);
  });
  it("emits a heartbeat comment while quiet and closes at the time limit so the browser can resume", async () => {
    let t = 0;
    const frames = await read(runEventStream({ poll: async () => ({ status: "running", age_s: 1, events: [] }), final: async () => ({}), signal: new AbortController().signal, pollMs: 1, heartbeatMs: 15_000, maxMs: 70_000, now: () => (t += 5000) }));
    expect(frames.some((f) => f.comment === "heartbeat")).toBe(true);
    expect(frames.some((f) => f.event === "done")).toBe(false);
  });
  it("stops when the client aborts", async () => {
    const ac = new AbortController(); let polls = 0;
    const p = read(runEventStream({ poll: async () => { polls++; return { status: "running", age_s: 1, events: [] }; }, final: async () => ({}), signal: ac.signal, pollMs: 5 }));
    await new Promise((r) => setTimeout(r, 40)); ac.abort(); await p;
    const n = polls; await new Promise((r) => setTimeout(r, 40));
    expect(polls).toBeLessThanOrEqual(n + 1);
  });
  it("treats a run stuck running past the stale limit as finished", async () => {
    const frames = await read(runEventStream({ poll: async () => ({ status: "running", age_s: 500, events: [] }), final: async () => ({ stale: true }), signal: new AbortController().signal, pollMs: 1 }));
    expect(frames.at(-1)).toMatchObject({ event: "done" });
  });
});

describe("StreamCaps", () => {
  it("caps per IP and globally, and frees a slot exactly once", () => {
    const c = new StreamCaps(2, 3);
    const a = c.acquire("1.1.1.1")!, b = c.acquire("1.1.1.1")!;
    expect(c.acquire("1.1.1.1")).toBeNull();
    const d = c.acquire("2.2.2.2")!;
    expect(c.acquire("3.3.3.3")).toBeNull(); // global cap 3
    a(); a(); expect(c.open).toBe(2);
    expect(c.acquire("3.3.3.3")).not.toBeNull();
    b(); d();
  });
  it("does not apply the per-IP cap when the address is unknown", () => {
    const c = new StreamCaps(1, 10);
    expect(c.acquire("untrusted", false)).not.toBeNull(); expect(c.acquire("untrusted", false)).not.toBeNull();
  });
});

describe.skipIf(!HAS_DB)("GET /api/runs/:id/events (database)", () => {
  afterAll(closeAllPools);
  it("streams a real run's trace in order and ends with the same payload as GET /api/runs/:id", async () => {
    const { GET } = await import("../app/api/runs/[id]/events/route");
    const h = await createRun({ messageId: uid("message", 1), idempotencyKey: randomUUID(), provider: new MockProvider(), visitor: visitorHash("198.51.100.201") });
    const call = (id: string, headers: Record<string, string> = {}) => GET(new Request(`http://x/api/runs/${id}/events`, { headers }), { params: Promise.resolve({ id }) });
    const res = await call(h.runId);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reading = read(res.body!);
    await h.execute!();
    const frames = await reading;
    const seqs = frames.filter((f) => f.event === "trace").map((f) => Number(f.id));
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const done = JSON.parse(frames.at(-1)!.data!);
    const direct = (await getRun(h.runId))!;
    expect(done.run.status).toBe("completed");
    expect(done.trace.map((t: TraceRow) => t.seq)).toEqual(direct.trace.map((t) => t.seq));
    expect(done.run.route).toBe(direct.run.route);
    // resume: a finished run streams only `done` when asked to continue after the last row
    const again = await read((await call(h.runId, { "last-event-id": "8" })).body!);
    expect(again.filter((f) => f.event === "trace")).toHaveLength(0);
    expect(again.at(-1)).toMatchObject({ event: "done" });
  });
  it("answers 404 for an unknown run and 400 for a malformed id, without opening a stream", async () => {
    const { GET } = await import("../app/api/runs/[id]/events/route");
    const r404 = await GET(new Request("http://x"), { params: Promise.resolve({ id: randomUUID() }) });
    expect(r404.status).toBe(404);
    const r400 = await GET(new Request("http://x"), { params: Promise.resolve({ id: "nope" }) });
    expect([400, 422]).toContain(r400.status);
  });
});

describe.skipIf(!HAS_DB)("conditional GET (ETag / 304)", () => {
  afterAll(closeAllPools);
  it("GET /api/runs/:id and /api/inbox return an ETag and a bodiless 304 for If-None-Match, and a new ETag once the data changes", async () => {
    const { GET: getRunRoute } = await import("../app/api/runs/[id]/route");
    const { GET: getInbox } = await import("../app/api/inbox/route");
    const { startRun } = await import("../db/runs");
    const { runId } = await startRun({ messageId: uid("message", 1), idempotencyKey: randomUUID(), provider: new MockProvider(), visitor: visitorHash("198.51.100.210") });
    const r1 = await getRunRoute(new Request("http://x"), { params: Promise.resolve({ id: runId }) });
    const tag = r1.headers.get("etag")!;
    expect(r1.status).toBe(200); expect(tag).toMatch(/^W\//); expect(r1.headers.get("cache-control")).toContain("no-cache");
    const r2 = await getRunRoute(new Request("http://x", { headers: { "if-none-match": tag } }), { params: Promise.resolve({ id: runId }) });
    expect(r2.status).toBe(304); expect(await r2.text()).toBe("");
    const r3 = await getRunRoute(new Request("http://x", { headers: { "if-none-match": 'W/"other"' } }), { params: Promise.resolve({ id: runId }) });
    expect(r3.status).toBe(200);
    const i1 = await getInbox(new Request("http://x"));
    const itag = i1.headers.get("etag")!;
    expect((await getInbox(new Request("http://x", { headers: { "if-none-match": itag } }))).status).toBe(304);
  });
});

describe.skipIf(!HAS_DB)("/api/system", () => {
  afterAll(closeAllPools);
  it("returns aggregates only (no message text, names or visitor ids), counts a run, and is cached for 5 s", async () => {
    const { GET } = await import("../app/api/system/route");
    const { resetSystemCache } = await import("../db/system");
    const { startRun } = await import("../db/runs");
    resetSystemCache();
    const before = await (await GET(new Request("http://x"))).json();
    await startRun({ messageId: uid("message", 1), idempotencyKey: randomUUID(), provider: new MockProvider(), visitor: visitorHash("198.51.100.220") });
    const cached = await (await GET(new Request("http://x"))).json();
    expect(cached.window.runs_1h).toBe(before.window.runs_1h); // served from the 5 s cache
    resetSystemCache();
    const after = await (await GET(new Request("http://x"))).json();
    expect(after.window.runs_1h).toBe(before.window.runs_1h + 1);
    expect(after.end_to_end_ms.n).toBeGreaterThan(0);
    expect(after.stages_ms.map((x: { stage: string }) => x.stage)).toContain("draft");
    expect(after.budget.cap_micro_usd).toBeGreaterThan(0);
    const text = JSON.stringify(after);
    for (const forbidden of ["198.51.100.220", "Ravi", "tap", "message_text", "visitor_hash", "unit"]) expect(text).not.toContain(forbidden);
  });
});
