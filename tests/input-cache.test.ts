import { describe, expect, it } from "vitest";
import { TtlCache } from "../core/ttl-cache";
import { inboxCache, inboxKey, INBOX_TTL_MS, clearInboxCache } from "../db/inbox-cache";

describe("TtlCache", () => {
  it("expires entries after the ttl using the injected clock", () => {
    let t = 0; const c = new TtlCache<number>(1000, 10, () => t);
    c.set("a", 1); t = 999; expect(c.get("a")).toBe(1); t = 1000; expect(c.get("a")).toBeUndefined();
  });
  it("never holds more than max keys, evicting the oldest", () => {
    const c = new TtlCache<number>(1000, 2); c.set("a", 1); c.set("b", 2); c.set("c", 3);
    expect(c.size).toBe(2); expect(c.get("a")).toBeUndefined(); expect(c.get("c")).toBe(3);
  });
});

describe("inbox cache scope", () => {
  it("is keyed by visitor: A's rows are never returned for B or for no visitor", () => {
    clearInboxCache();
    inboxCache.set(inboxKey("A"), [{ id: "private-A" } as never]);
    expect(inboxCache.get(inboxKey("B"))).toBeUndefined();
    expect(inboxCache.get(inboxKey(null))).toBeUndefined();
    expect(inboxCache.get(inboxKey("A"))).toHaveLength(1);
  });
  it("ttl stays within the 2 s budget and clearing empties the store", () => {
    expect(INBOX_TTL_MS).toBeLessThanOrEqual(2000);
    inboxCache.set(inboxKey("A"), []); clearInboxCache(); expect(inboxCache.size).toBe(0);
  });
});
