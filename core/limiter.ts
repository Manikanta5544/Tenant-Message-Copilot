/** Per-instance concurrency limiter for model calls, plus the provider's last-seen rate-limit headroom.
 *  Bounded wait: when no slot frees up in time the caller gets a "busy" error, which the pipeline turns into its normal
 *  honest fallback (template reply, visible reason). It never queues without bound and never throws a 500.
 *  Scope: one process. Across several instances the provider's own 429 is the shared signal; a Postgres token bucket is
 *  only worth adding once more than one instance serves traffic at the same time (see docs/PERF.md). */
export class Semaphore {
  private active = 0;
  private waiters: { grant: () => void; timer: ReturnType<typeof setTimeout> }[] = [];
  private waits: number[] = [];
  private rejected = 0;
  constructor(private max: number, private maxWaitMs: number) {}

  configure(max: number, maxWaitMs: number) { this.max = Math.max(1, max); this.maxWaitMs = Math.max(0, maxWaitMs); }

  /** Resolves with a release function, or rejects with `BusyError` after maxWaitMs. */
  acquire(): Promise<() => void> {
    const t0 = Date.now();
    const release = () => {
      let done = false;
      return () => { if (done) return; done = true; this.active--; this.next(); };
    };
    if (this.active < this.max) { this.active++; this.record(0); return Promise.resolve(release()); }
    return new Promise((resolve, reject) => {
      const w = {
        grant: () => { clearTimeout(w.timer); this.active++; this.record(Date.now() - t0); resolve(release()); },
        timer: setTimeout(() => { this.waiters = this.waiters.filter((x) => x !== w); this.rejected++; reject(new BusyError()); }, this.maxWaitMs),
      };
      this.waiters.push(w);
    });
  }
  private next() { while (this.active < this.max && this.waiters.length) this.waiters.shift()!.grant(); }
  private record(ms: number) { this.waits.push(ms); if (this.waits.length > 200) this.waits.shift(); }

  async run<T>(fn: () => Promise<T>): Promise<T> { const rel = await this.acquire(); try { return await fn(); } finally { rel(); } }

  stats() {
    const w = [...this.waits].sort((a, b) => a - b);
    return { max: this.max, active: this.active, waiting: this.waiters.length, rejected_busy: this.rejected, wait_p95_ms: w.length ? w[Math.min(w.length - 1, Math.floor(w.length * 0.95))]! : 0 };
  }
}
export class BusyError extends Error { constructor() { super("model capacity is busy"); this.name = "BusyError"; } }

export const llmLimiter = new Semaphore(4, 8000);

/** Remaining requests/tokens the provider reported on its last response (Groq: x-ratelimit-remaining-requests, -tokens). */
export interface RateHeadroom { remaining_requests: number | null; remaining_tokens: number | null; limit_requests: number | null; limit_tokens: number | null; reset_requests: string | null; reset_tokens: string | null; at: number }
let headroom: RateHeadroom | null = null;
const num = (v: string | null) => { const n = v === null ? NaN : Number(v); return Number.isFinite(n) ? n : null; };
export function noteRateHeaders(h: Headers, now = Date.now()) {
  const g = (k: string) => h.get(k);
  if (!g("x-ratelimit-remaining-requests") && !g("x-ratelimit-remaining-tokens")) return;
  headroom = { remaining_requests: num(g("x-ratelimit-remaining-requests")), remaining_tokens: num(g("x-ratelimit-remaining-tokens")), limit_requests: num(g("x-ratelimit-limit-requests")), limit_tokens: num(g("x-ratelimit-limit-tokens")), reset_requests: g("x-ratelimit-reset-requests"), reset_tokens: g("x-ratelimit-reset-tokens"), at: now };
}
export const rateHeadroom = (): RateHeadroom | null => headroom;
