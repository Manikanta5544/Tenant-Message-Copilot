import { describe, expect, it } from "vitest";
import { runBatch, summarize, type ItemResult } from "../app/lib/batch";

const done = (cost = 1000, route: string | null = "needs_review"): ItemResult => ({ kind: "done", cost_micro_usd: cost, route });
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const ids = (n: number) => Array.from({ length: n }, (_, i) => `m${i}`);

describe("process all unprocessed", () => {
  it("never has more than 3 in flight, processes every message once, and sums cost and routes", async () => {
    let active = 0, peak = 0; const seen: string[] = [];
    const s = await runBatch(ids(10), { runOne: async (id) => { active++; peak = Math.max(peak, active); seen.push(id); await delay(5); active--; return done(500, id === "m0" ? "draft_ready" : "needs_review"); } });
    expect(peak).toBe(3);
    expect(seen.sort()).toEqual(ids(10).sort());
    expect(s).toMatchObject({ status: "finished", done: 10, failed: 0, cost_micro_usd: 5000, routes: { draft_ready: 1, needs_review: 9 } });
  });
  it("reports live progress per message", async () => {
    const states: string[] = [];
    await runBatch(["a", "b"], { concurrency: 1, runOne: async () => done(), onUpdate: (st) => states.push(`${st.items.a}/${st.items.b}`) });
    expect(states).toContain("running/waiting"); expect(states.at(-1)).toBe("done/done");
  });
  it("cancel stops new starts, lets in-flight runs finish, and says how many were not started", async () => {
    const ac = new AbortController(); let started = 0;
    const s = await runBatch(ids(10), { signal: ac.signal, runOne: async () => { started++; if (started === 3) ac.abort(); await delay(5); return done(); } });
    expect(s.status).toBe("cancelled"); expect(s.done).toBe(3); expect(s.total - s.done - s.failed).toBe(7);
    expect(summarize(s, (m) => `$${m}`)).toMatch(/^Cancelled\. 3 of 10 processed, 7 not started in \d+ s/);
  });
  it("stops at the budget and keeps the message that hit it for a later run", async () => {
    let n = 0;
    const s = await runBatch(ids(8), { concurrency: 1, runOne: async () => (++n > 2 ? { kind: "budget" } : done()) });
    expect(s.status).toBe("budget"); expect(s.done).toBe(2);
    expect(Object.values(s.items).filter((x) => x === "waiting")).toHaveLength(6);
    expect(summarize(s, () => "$0")).toContain("daily budget is used up");
  });
  it("pauses on 429, shows when it resumes, then carries on without losing the message", async () => {
    let t = 1_000_000; const slept: number[] = []; let first = true; const seenPause: (number | null)[] = [];
    const s = await runBatch(ids(3), { concurrency: 1, now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; },
      onUpdate: (st) => { if (st.status === "paused") seenPause.push(st.resume_at); },
      runOne: async () => { if (first) { first = false; return { kind: "rate_limited", retry_after_s: 12 }; } return done(); } });
    expect(slept).toEqual([12_000]); expect(seenPause[0]).toBe(1_012_000);
    expect(s).toMatchObject({ status: "finished", done: 3, failed: 0 });
  });
  it("one failure is counted and does not stop the rest", async () => {
    const s = await runBatch(ids(4), { runOne: async (id) => { if (id === "m1") throw new Error("x"); return done(); } });
    expect(s).toMatchObject({ status: "finished", done: 3, failed: 1 });
  });
});
