/** Tiny per-process cache: entries expire after `ttlMs`, the store never holds more than `max` keys (oldest evicted first). The clock is injectable for tests. */
export class TtlCache<T> {
  private m = new Map<string, { at: number; v: T }>();
  constructor(private ttlMs: number, private max = 500, private now: () => number = Date.now) {}
  get(key: string): T | undefined {
    const e = this.m.get(key);
    if (!e) return undefined;
    if (this.now() - e.at >= this.ttlMs) { this.m.delete(key); return undefined; }
    return e.v;
  }
  set(key: string, v: T): void {
    this.m.delete(key);
    this.m.set(key, { at: this.now(), v });
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value as string);
  }
  clear(): void { this.m.clear(); }
  get size(): number { return this.m.size; }
}
