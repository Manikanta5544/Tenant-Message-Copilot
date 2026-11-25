import type { EvidenceStore, IsoDate } from "./types";

/** Evidence reads warmed while the triage call is in flight.
 *
 *  Triage decides which tools run, so the tool plan cannot start earlier. What can start earlier is the database I/O: every tool reads
 *  the same few rows (lease, ledger snapshot, payment events), so those reads are issued at once and the real tool run then finds them
 *  in memory. The tool run, its order, the fact ids and every verifier input are untouched, so the output is byte-identical to a run
 *  without prefetch (tests/prefetch.test.ts proves that over every golden case). A failed read is replayed to the caller exactly as
 *  a direct call would have failed; a read nobody asks for is dropped without noise. */
export function memoStore(inner: EvidenceStore): EvidenceStore & { warm(asOf: IsoDate): Promise<void>; hits: number } {
  const cache = new Map<string, Promise<unknown>>();
  let hits = 0;
  const once = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const have = cache.get(key);
    if (have) { hits++; return have as Promise<T>; }
    const p = fn(); p.catch(() => {}); cache.set(key, p); return p;
  };
  const m = {
    getLease: (asOf: IsoDate) => once(`lease|${asOf}`, () => inner.getLease(asOf)),
    getLedger: (id: string, asOf: IsoDate) => once(`ledger|${id}|${asOf}`, () => inner.getLedger(id, asOf)),
    getSqlBalance: (id: string, asOf: IsoDate) => once(`sql|${id}|${asOf}`, () => inner.getSqlBalance(id, asOf)),
    getBalanceSnapshot: (id: string, asOf: IsoDate) => once(`snap|${id}|${asOf}`, () => inner.getBalanceSnapshot(id, asOf)),
    getPaymentEvents: (id: string, asOf: IsoDate) => once(`pay|${id}|${asOf}`, () => inner.getPaymentEvents(id, asOf)),
    searchClauses: (id: string, q: string[], asOf: IsoDate) => inner.searchClauses(id, q, asOf), // depends on the model's queries: never warmed
    async warm(asOf: IsoDate) {
      const lease = await m.getLease(asOf);
      if (!lease) return;
      await Promise.allSettled([m.getBalanceSnapshot(lease.id, asOf), m.getPaymentEvents(lease.id, asOf)]);
    },
    get hits() { return hits; },
  };
  return m;
}
