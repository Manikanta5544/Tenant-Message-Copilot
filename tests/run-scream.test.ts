import { describe, expect, it } from "vitest";
import { pollDelay, watchRun, type RunPayload } from "../app/lib/run-stream";
import type { TraceRow } from "../app/lib/types";

const row = (seq: number): TraceRow => ({ seq, stage: `s${seq}`, model: null, tokens_in: 0, tokens_out: 0, cost_micro_usd: 0, latency_ms: 1, outcome: "ok", payload: {}, created_at: "" });
const payload = (status: string, n: number): RunPayload => ({ run: { status } as RunPayload["run"], trace: Array.from({ length: n }, (_, i) => row(i + 1)), reviews: [] });

class FakeES {
  static last: FakeES; readyState = 1; closed = false; l: Record<string, ((e: unknown) => void)[]> = {};
  constructor(public url: string) { FakeES.last = this; }
  addEventListener(t: string, fn: (e: unknown) => void) { (this.l[t] ??= []).push(fn); }
  close() { this.closed = true; this.readyState = 2; }
  emit(t: string, data?: unknown) { for (const fn of this.l[t] ?? []) fn({ data: JSON.stringify(data) }); }
}
const noSleep = async () => {};

describe("watchRun", () => {
  it("shows steps from real stream events and finishes with the done payload", () => {
    const seen: number[][] = []; let done: RunPayload | null = null;
    watchRun("r1", { onTrace: (r) => seen.push(r.map((x) => x.seq)), onDone: (p) => { done = p; }, onError: () => { throw new Error("no"); } }, { EventSourceCtor: FakeES as unknown as typeof EventSource });
    const es = FakeES.last;
    expect(es.url).toBe("/api/runs/r1/events");
    es.emit("trace", row(1)); es.emit("trace", row(2)); es.emit("trace", row(2)); // a replay after reconnect is ignored
    es.emit("done", payload("completed", 2));
    expect(seen).toEqual([[1], [1, 2]]);
    expect(done!.run.status).toBe("completed");
    expect(es.closed).toBe(true);
  });
  it("falls back to polling when the stream is refused, and stops at completion", async () => {
    let calls = 0; const seen: number[] = [];
    const fetchFn = (async () => { calls++; return new Response(JSON.stringify(calls < 3 ? payload("running", calls) : payload("completed", 3))); }) as typeof fetch;
    const done = new Promise<RunPayload>((res) => {
      watchRun("r2", { onTrace: (r) => seen.push(r.length), onDone: res, onError: () => res(null as never) }, { EventSourceCtor: FakeES as unknown as typeof EventSource, fetchFn, sleep: noSleep, isHidden: () => false });
      FakeES.last.readyState = 2; FakeES.last.emit("error");
    });
    expect((await done).run.status).toBe("completed");
    expect(calls).toBe(3); expect(seen).toEqual([1, 2]);
  });
  it("polls directly when EventSource does not exist", async () => {
    const fetchFn = (async () => new Response(JSON.stringify(payload("completed", 1)))) as typeof fetch;
    const p = await new Promise<RunPayload>((res) => watchRun("r3", { onTrace: () => {}, onDone: res, onError: () => {} }, { EventSourceCtor: null, fetchFn, sleep: noSleep, isHidden: () => false }));
    expect(p.run.status).toBe("completed");
  });
  it("pauses polling while the tab is hidden and resumes when visible", async () => {
    let hiddenNow = true, calls = 0; let wake: () => void = () => {};
    const fetchFn = (async () => { calls++; return new Response(JSON.stringify(payload("completed", 1))); }) as typeof fetch;
    const done = new Promise<RunPayload>((res) => watchRun("r4", { onTrace: () => {}, onDone: res, onError: () => {} }, { EventSourceCtor: null, fetchFn, sleep: noSleep, isHidden: () => hiddenNow, whenVisible: () => new Promise<void>((r) => { wake = r; }) }));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(0);
    hiddenNow = false; wake(); await done; expect(calls).toBe(1);
  });
  it("reports an error status and can be cancelled", async () => {
    const st = await new Promise<number | null>((res) => watchRun("r5", { onTrace: () => {}, onDone: () => {}, onError: res }, { EventSourceCtor: null, fetchFn: (async () => new Response("{}", { status: 404 })) as typeof fetch, sleep: noSleep, isHidden: () => false }));
    expect(st).toBe(404);
    let called = false;
    const stop = watchRun("r6", { onTrace: () => {}, onDone: () => { called = true; }, onError: () => {} }, { EventSourceCtor: FakeES as unknown as typeof EventSource });
    stop(); FakeES.last.emit("done", payload("completed", 1)); expect(called).toBe(false);
  });
  it("backs off from 1 s to 3 s", () => { expect([pollDelay(0), pollDelay(9), pollDelay(10)]).toEqual([1000, 1000, 3000]); });
});
