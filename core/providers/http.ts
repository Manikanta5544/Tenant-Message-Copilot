// One bounded retry for rate limits and server errors, shared by the HTTP providers.
// Honours Retry-After but never waits longer than maxWaitMs, so a retry cannot blow the step timeout.
export interface RetryOptions { retries?: number; maxWaitMs?: number; sleep?: (ms: number) => Promise<void> }

export const retryAfterMs = (res: Response, fallbackMs: number, maxWaitMs: number): number => {
  const h = res.headers.get("retry-after");
  const secs = h === null ? NaN : Number(h);
  const ms = Number.isFinite(secs) ? secs * 1000 : fallbackMs;
  return Math.min(Math.max(ms, 0), maxWaitMs);
};

export async function fetchWithRetry(f: typeof fetch, url: string, init: () => RequestInit, o: RetryOptions = {}): Promise<{ res: Response; attempts: number }> {
  const retries = o.retries ?? 1, maxWait = o.maxWaitMs ?? 4000;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let attempt = 0;
  for (;;) {
    attempt++;
    const res = await f(url, init());
    if ((res.status === 429 || res.status >= 500) && attempt <= retries) {
      await res.body?.cancel().catch(() => {});
      await sleep(retryAfterMs(res, 800, maxWait));
      continue;
    }
    return { res, attempts: attempt };
  }
}
