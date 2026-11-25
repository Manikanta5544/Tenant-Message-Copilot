// Live run events over Server-Sent Events. The server polls the database (250 ms) instead of LISTEN/NOTIFY, because a pooled
// Postgres (Neon's PgBouncer in transaction mode) cannot hold a LISTEN. The browser sees push; the cost is one small query per
// open stream, bounded by the connection caps below.
import type { TraceRow } from "@/db/runs";

export interface StreamDeps {
  poll: (afterSeq: number) => Promise<{ status: string; age_s: number; events: TraceRow[] } | null>;
  /** The same payload GET /api/runs/:id returns. Sent once, as the final `done` event. */
  final: () => Promise<unknown>;
  signal: AbortSignal;
  afterSeq?: number;
  pollMs?: number; heartbeatMs?: number; maxMs?: number; staleAfterS?: number;
  now?: () => number;
}
const enc = new TextEncoder();
export const frame = (event: string, data: unknown, id?: number) => `${id !== undefined ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** Streams `trace` events as they are stored, then `done`. Closes on a finished run, on abort, or after maxMs (the browser then resumes with Last-Event-ID). */
export function runEventStream(d: StreamDeps): ReadableStream<Uint8Array> {
  const pollMs = d.pollMs ?? 250, heartbeatMs = d.heartbeatMs ?? 15_000, maxMs = d.maxMs ?? 70_000, stale = d.staleAfterS ?? 90;
  const now = d.now ?? Date.now;
  let stopped = false;
  return new ReadableStream<Uint8Array>({
    async start(c) {
      const send = (s: string) => { if (!stopped) c.enqueue(enc.encode(s)); };
      const stop = () => { if (stopped) return; stopped = true; try { c.close(); } catch { /* already closed */ } };
      d.signal.addEventListener("abort", stop, { once: true });
      send("retry: 2000\n\n");
      const t0 = now(); let last = d.afterSeq ?? 0; let lastSend = now();
      try {
        while (!stopped) {
          const r = await d.poll(last);
          if (!r) { send(frame("error", { error: "run not found" })); break; }
          for (const e of r.events) { send(frame("trace", e, e.seq)); last = e.seq; lastSend = now(); }
          if (r.status !== "running" || r.age_s > stale) { send(frame("done", await d.final())); break; }
          if (now() - t0 >= maxMs) break;
          if (now() - lastSend >= heartbeatMs) { send(": heartbeat\n\n"); lastSend = now(); }
          await new Promise((res) => setTimeout(res, pollMs));
        }
      } catch { send(frame("error", { error: "stream interrupted" })); }
      stop();
    },
    cancel() { stopped = true; },
  });
}

/** Connection caps. Per IP is skipped when the client address is unknown (no trusted proxy), where it would cap everyone together. */
export class StreamCaps {
  private perIp = new Map<string, number>(); private total = 0;
  constructor(public maxPerIp: number, public maxGlobal: number) {}
  acquire(ip: string, perIpApplies = true): (() => void) | null {
    if (this.total >= this.maxGlobal) return null;
    if (perIpApplies && (this.perIp.get(ip) ?? 0) >= this.maxPerIp) return null;
    this.total++; if (perIpApplies) this.perIp.set(ip, (this.perIp.get(ip) ?? 0) + 1);
    let done = false;
    return () => { if (done) return; done = true; this.total--; if (perIpApplies) { const n = (this.perIp.get(ip) ?? 1) - 1; if (n <= 0) this.perIp.delete(ip); else this.perIp.set(ip, n); } };
  }
  get open() { return this.total; }
}
export const caps = new StreamCaps(4, 200);
