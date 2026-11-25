import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { budgetDay } from "../core/config";
import { MockProvider } from "../core/providers/mock";
import { reserveRunSlot } from "../db/budget";
import { closeAllPools, withScope } from "../db/client";
import { ORG_A, RES, uid } from "../db/ids";
import { createMessage, createRun, visitorHash } from "../db/runs";
import { APP_URL, HAS_DB, OWNER_URL } from "./helpers";

process.env.DATABASE_URL_APP = APP_URL;
process.env.DEMO_AS_OF_DATE = "2026-11-19";
process.env.DEMO_DAILY_BUDGET_USD = "50";
const msg = (n: number) => uid("message", n);
// One run per (message, visitor) at a time, so tests that start several runs for one visitor use different messages.
const go = (key = randomUUID(), visitor: string | null = null, n = 1) => createRun({ messageId: msg(n), idempotencyKey: key, provider: new MockProvider(), visitor });

describe("budget day", () => {
  it("is the real UTC date, so it changes from one day to the next", () => {
    expect(budgetDay(new Date("2026-11-20T23:59:59Z"))).toBe("2026-11-20");
    expect(budgetDay(new Date("2026-11-21T00:00:01Z"))).toBe("2026-11-21");
  });
  it("hashes the IP only: a User-Agent cannot change the visitor", () => {
    expect(visitorHash("1.2.3.4")).toBe(visitorHash("1.2.3.4"));
    expect(visitorHash("1.2.3.4")).not.toBe(visitorHash("1.2.3.5"));
  });
});

describe.skipIf(!HAS_DB)("abuse limits (database)", () => {
  afterAll(closeAllPools);

  it("keeps a separate budget row per real date", async () => {
    const slot = (day: string) => withScope(APP_URL!, { orgId: ORG_A }, (db) => reserveRunSlot(db, ORG_A, day, 1_000_000, 5));
    expect(await slot("2031-01-01")).toBe(true);
    expect(await slot("2031-01-02")).toBe(true);
    const c = new pg.Client({ connectionString: OWNER_URL }); await c.connect();
    const r = await c.query("SELECT day::text, runs_used FROM budget_days WHERE day IN ('2031-01-01','2031-01-02') ORDER BY day"); await c.end();
    expect(r.rows.map((x) => x.runs_used)).toEqual([1, 1]);
  });

  it("the daily run cap denies run N+1 atomically under 20 concurrent requests", async () => {
    const day = "2031-02-01";
    const results = await Promise.all(Array.from({ length: 20 }, () => withScope(APP_URL!, { orgId: ORG_A }, (db) => reserveRunSlot(db, ORG_A, day, 1_000_000, 7))));
    expect(results.filter(Boolean).length).toBe(7);
    const c = new pg.Client({ connectionString: OWNER_URL }); await c.connect();
    expect((await c.query("SELECT runs_used FROM budget_days WHERE day = $1", [day])).rows[0].runs_used).toBe(7); await c.end();
  });

  it("the per-visitor hourly run limit holds even when many requests arrive at once, and a rejected run leaves no row", async () => {
    process.env.RATE_LIMIT_PER_HOUR = "3";
    const v = visitorHash(`198.51.100.${Math.floor(Math.random() * 200)}`);
    const out = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => go(randomUUID(), v, 1 + i)));
    delete process.env.RATE_LIMIT_PER_HOUR;
    expect(out.filter((o) => o.status === "fulfilled").length).toBe(3);
    expect(out.filter((o) => o.status === "rejected" && (o.reason as { status?: number }).status === 429).length).toBe(5);
    const c = new pg.Client({ connectionString: OWNER_URL }); await c.connect();
    expect((await c.query("SELECT count(*)::int AS n FROM runs WHERE visitor_hash = $1", [v])).rows[0].n).toBe(3); await c.end();
  });

  it("an idempotent repeat uses no slot and no rate-limit quota", async () => {
    process.env.RATE_LIMIT_PER_HOUR = "1";
    const v = visitorHash(`192.0.2.${Math.floor(Math.random() * 200)}`);
    const key = randomUUID();
    const a = await go(key, v), b = await go(key, v);
    delete process.env.RATE_LIMIT_PER_HOUR;
    expect(a.created).toBe(true); expect(b.created).toBe(false); expect(b.runId).toBe(a.runId);
  });

  it("one visitor cannot use more than their own daily share of runs", async () => {
    process.env.RATE_LIMIT_PER_DAY = "2";
    const v = visitorHash(`100.64.0.${Math.floor(Math.random() * 200)}`);
    await go(randomUUID(), v, 1); await go(randomUUID(), v, 2);
    await expect(go(randomUUID(), v, 3)).rejects.toMatchObject({ status: 429 });
    delete process.env.RATE_LIMIT_PER_DAY;
    // another visitor is unaffected
    await expect(go(randomUUID(), visitorHash("100.64.1.1"))).resolves.toMatchObject({ created: true });
  });

  it("message posting is limited per visitor", async () => {
    process.env.MESSAGE_LIMIT_PER_HOUR = "2";
    const v = visitorHash(`203.0.113.${Math.floor(Math.random() * 200)}`);
    await createMessage(RES.ravi, "one", v); await createMessage(RES.ravi, "two", v);
    await expect(createMessage(RES.ravi, "three", v)).rejects.toMatchObject({ status: 429 });
    delete process.env.MESSAGE_LIMIT_PER_HOUR;
  });
});
