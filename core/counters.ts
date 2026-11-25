/** In-memory, per-instance counters for /system. They reset on restart and are not shared across instances. */
const hits: Record<string, number[]> = {};
const HOUR = 3_600_000;
export function noteEvent(name: "rate_limited" | "stream_cap" | "model_busy", now = Date.now()) {
  const a = (hits[name] ??= []); a.push(now);
  while (a.length && a[0]! < now - HOUR) a.shift();
}
export function countEvents(name: string, windowMs: number, now = Date.now()): number {
  return (hits[name] ?? []).filter((t) => t >= now - windowMs).length;
}
