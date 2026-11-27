// Short per-process cache of inbox rows, keyed by VISITOR: the seeded messages are identical for everyone, but a visitor's own custom
// messages and runs are private, so one visitor's entry is never served to another. Any write made by this process clears it (the writer's
// next read is fresh); the TTL bounds staleness for writes made by other instances.
import { TtlCache } from "../core/ttl-cache";
import type { InboxRow } from "./runs";

export const INBOX_TTL_MS = 1500;
export const inboxCache = new TtlCache<InboxRow[]>(INBOX_TTL_MS, 500);
export const inboxKey = (visitor: string | null) => (visitor === null ? "visitor:none" : `visitor:${visitor}`);
/** Visitor-independent parts (residents, missing-baseline count, latest evals): same for everyone, changed by `npm run seed` / `npm run eval`. */
export const sharedCache = new TtlCache<unknown>(5000, 8);
export const clearInboxCache = () => { inboxCache.clear(); sharedCache.clear(); };
