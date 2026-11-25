// "Process all unprocessed": at most `concurrency` runs in flight, live per-message progress, cancel, stop at the budget,
// and pause (showing when it resumes) when the server answers 429 with a Retry-After.
export type ItemResult =
  | { kind: "done"; cost_micro_usd: number; route: string | null }
  | { kind: "rate_limited"; retry_after_s: number }
  | { kind: "budget" }
  | { kind: "failed" };
export type ItemStatus = "waiting" | "running" | "done" | "failed";
export interface BatchState {
  status: "running" | "paused" | "cancelling" | "finished" | "cancelled" | "budget";
  items: Record<string, ItemStatus>;
  total: number; done: number; failed: number; routes: Record<string, number>;
  cost_micro_usd: number; started_at: number; ended_at: number | null; resume_at: number | null;
}
export interface BatchEnv { runOne: (id: string) => Promise<ItemResult>; concurrency?: number; signal?: AbortSignal; onUpdate?: (s: BatchState) => void; sleep?: (ms: number) => Promise<void>; now?: () => number }

export async function runBatch(ids: string[], env: BatchEnv): Promise<BatchState> {
  const now = env.now ?? Date.now, sleep = env.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const queue = [...ids];
  const s: BatchState = { status: "running", items: Object.fromEntries(ids.map((i) => [i, "waiting" as ItemStatus])), total: ids.length, done: 0, failed: 0, routes: {}, cost_micro_usd: 0, started_at: now(), ended_at: null, resume_at: null };
  const push = () => env.onUpdate?.({ ...s, items: { ...s.items }, routes: { ...s.routes } });
  let stop: "budget" | null = null;
  let pausedUntil = 0;
  const cancelled = () => !!env.signal?.aborted;
  push();
  const worker = async () => {
    for (;;) {
      if (cancelled() || stop) return;
      if (pausedUntil > now()) { s.status = "paused"; s.resume_at = pausedUntil; push(); await sleep(pausedUntil - now()); continue; }
      if (s.status === "paused") { s.status = "running"; s.resume_at = null; push(); }
      const id = queue.shift(); if (id === undefined) return;
      s.items[id] = "running"; push();
      const r = await env.runOne(id).catch((): ItemResult => ({ kind: "failed" }));
      if (r.kind === "done") { s.items[id] = "done"; s.done++; s.cost_micro_usd += r.cost_micro_usd; if (r.route) s.routes[r.route] = (s.routes[r.route] ?? 0) + 1; }
      else if (r.kind === "failed") { s.items[id] = "failed"; s.failed++; }
      else if (r.kind === "budget") { s.items[id] = "waiting"; queue.unshift(id); stop = "budget"; }
      else { s.items[id] = "waiting"; queue.unshift(id); pausedUntil = Math.max(pausedUntil, now() + Math.max(1, r.retry_after_s) * 1000); }
      push();
    }
  };
  await Promise.all(Array.from({ length: Math.min(env.concurrency ?? 3, Math.max(1, ids.length)) }, worker));
  s.status = stop === "budget" ? "budget" : cancelled() ? "cancelled" : "finished";
  s.resume_at = null; s.ended_at = now(); push();
  return s;
}

/** One line for the summary: counts, time and cost. */
export function summarize(s: BatchState, fmtCost: (micro: number) => string): string {
  const secs = Math.max(0, Math.round(((s.ended_at ?? s.started_at) - s.started_at) / 1000));
  const left = s.total - s.done - s.failed;
  const head = s.status === "budget" ? "Stopped: the daily budget is used up" : s.status === "cancelled" ? "Cancelled" : "Done";
  return `${head}. ${s.done} of ${s.total} processed${s.failed ? `, ${s.failed} failed` : ""}${left > 0 && s.status !== "finished" ? `, ${left} not started` : ""} in ${secs} s, ${fmtCost(s.cost_micro_usd)}.`;
}
