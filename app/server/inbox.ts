import { countMissingBaselines } from "@/db/baselines";
import { inboxCache, inboxKey, sharedCache as shared } from "@/db/inbox-cache";
import { latestEvalRuns, listInbox, listResidents } from "@/db/runs";

/** The caller's inbox rows, from the per-visitor cache when fresh. The key is the visitor, so private rows never cross visitors. */
export async function cachedInbox(visitor: string | null) {
  const k = inboxKey(visitor), hit = inboxCache.get(k);
  if (hit) return hit;
  const rows = await listInbox(visitor);
  inboxCache.set(k, rows);
  return rows;
}

async function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = shared.get(key) as T | undefined;
  if (hit !== undefined) return hit;
  const v = await load();
  shared.set(key, v);
  return v;
}
export const cachedResidents = () => once("residents", listResidents);
export const cachedMissingBaselines = () => once("missing", countMissingBaselines);
export const cachedEvalRuns = () => once("evals", () => latestEvalRuns(10).catch(() => []));
