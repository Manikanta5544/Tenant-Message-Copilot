import type { ReviewRow, RunView, TraceRow } from "./types";

export type RunPayload = { run: RunView; trace: TraceRow[]; reviews?: ReviewRow[] };
export interface WatchHandlers {
  /** Called with every trace row seen so far, in order, as the pipeline stores them. */
  onTrace: (rows: TraceRow[]) => void;
  /** The finished run, same payload as GET /api/runs/:id. */
  onDone: (p: RunPayload) => void;
  onError: (status: number | null) => void;
}
export interface WatchEnv {
  EventSourceCtor?: typeof EventSource | null;
  fetchFn?: typeof fetch;
  isHidden?: () => boolean;
  /** Resolves when the page becomes visible. */
  whenVisible?: () => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  /** Give up after this long in total (the server marks a run stale after 90 s). */
  maxMs?: number;
}

/** Polling schedule: 1 s for the first ten polls, then 3 s. */
export const pollDelay = (n: number) => (n < 10 ? 1000 : 3000);

/** Watches one run: EventSource first, then plain polling if the stream cannot be used (429 cap, proxy buffering, no EventSource). Returns a cancel function. */
export function watchRun(runId: string, h: WatchHandlers, env: WatchEnv = {}): () => void {
  const ES = env.EventSourceCtor === undefined ? (typeof EventSource !== "undefined" ? EventSource : null) : env.EventSourceCtor;
  const f = env.fetchFn ?? fetch;
  const hidden = env.isHidden ?? (() => typeof document !== "undefined" && document.hidden);
  const whenVisible = env.whenVisible ?? (() => new Promise<void>((res) => { const on = () => { if (!document.hidden) { document.removeEventListener("visibilitychange", on); res(); } }; document.addEventListener("visibilitychange", on); }));
  const sleep = env.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxMs = env.maxMs ?? 100_000;
  let cancelled = false; let es: EventSource | null = null; let finished = false;
  const rows: TraceRow[] = [];
  const t0 = Date.now();
  const finish = (p: RunPayload) => { if (finished || cancelled) return; finished = true; es?.close(); h.onDone(p); };

  async function poll() {
    for (let n = 0; !cancelled && !finished; n++) {
      if (hidden()) await whenVisible();
      if (cancelled) return;
      try {
        const r = await f(`/api/runs/${runId}`);
        if (!r.ok) { if (!cancelled) h.onError(r.status); return; }
        const j = (await r.json()) as RunPayload;
        if (j.run.status !== "running") { finish(j); return; }
        if (j.trace.length > rows.length) { rows.splice(0, rows.length, ...j.trace); h.onTrace([...rows]); }
      } catch { if (!cancelled) h.onError(null); return; }
      if (Date.now() - t0 > maxMs) { if (!cancelled) h.onError(null); return; }
      await sleep(pollDelay(n));
    }
  }

  function stream() {
    if (!ES) { void poll(); return; }
    let gotAny = false;
    es = new ES(`/api/runs/${runId}/events`);
    es.addEventListener("trace", (ev) => {
      gotAny = true;
      const row = JSON.parse((ev as MessageEvent).data) as TraceRow;
      if (!rows.some((x) => x.seq === row.seq)) { rows.push(row); rows.sort((a, b) => a.seq - b.seq); h.onTrace([...rows]); }
    });
    es.addEventListener("done", (ev) => { try { finish(JSON.parse((ev as MessageEvent).data) as RunPayload); } catch { es?.close(); void poll(); } });
    es.addEventListener("error", () => {
      // The browser retries by itself on a dropped connection (and resumes with Last-Event-ID). A closed state means it gave up
      // (for example HTTP 429 from the stream cap): continue with polling, which needs no long-lived connection.
      if (finished || cancelled) return;
      if (es!.readyState === 2 /* CLOSED */ || !gotAny) { es!.close(); es = null; void poll(); }
    });
  }
  stream();
  return () => { cancelled = true; es?.close(); };
}
