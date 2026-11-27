import pg from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { maxRunsPerIpPerDay, maxRunsPerIpPerHour, secondsToUtcMidnight } from "../core/config";
import { MockProvider } from "../core/providers/mock";
import { closeAllPools } from "../db/client";
import { RES, uid } from "../db/ids";
import { createMessage, createRun, netHash, visitorHash } from "../db/runs";
import { APP_URL, HAS_DB, OWNER_URL } from "./helpers";

process.env.DATABASE_URL_APP = APP_URL;
process.env.DEMO_AS_OF_DATE = "2026-11-19";
process.env.DEMO_DAILY_BUDGET_USD = "50";
const seeded = (n: number) => uid("message", n);
const run = (messageId: string, visitor: string | null, net: string | null = null) => createRun({ messageId, idempotencyKey: randomUUID(), provider: new MockProvider(), visitor, net });
const rnd = () => Math.floor(Math.random() * 250);
const owner = async <T>(fn: (c: pg.Client) => Promise<T>) => { const c = new pg.Client({ connectionString: OWNER_URL }); await c.connect(); try { return await fn(c); } finally { await c.end(); } };
const reason = (o: PromiseSettledResult<unknown>) => (o.status === "rejected" ? (o.reason as { status?: number; extra?: { retry_after_s?: number } }) : null);

describe("limit arithmetic (no database)", () => {
  it("seconds to the next UTC midnight", () => {
    expect(secondsToUtcMidnight(new Date("2026-11-20T23:59:30Z"))).toBe(30);
    expect(secondsToUtcMidnight(new Date("2026-11-20T00:00:00Z"))).toBe(86_400);
    expect(secondsToUtcMidnight(new Date("2026-12-31T12:00:00Z"))).toBe(43_200);
  });
  it("per-network ceilings default to a multiple of the visitor limit and a share of the daily cap", () => {
    expect(maxRunsPerIpPerHour({ RATE_LIMIT_PER_HOUR: "20" })).toBe(60);
    expect(maxRunsPerIpPerHour({ RATE_LIMIT_PER_HOUR: "20", RATE_LIMIT_PER_IP_PER_HOUR: "7" })).toBe(7);
    expect(maxRunsPerIpPerDay({ DEMO_MAX_RUNS_PER_DAY: "400", RATE_LIMIT_PER_DAY: "40" })).toBe(100);
    expect(maxRunsPerIpPerDay({ DEMO_MAX_RUNS_PER_DAY: "150", RATE_LIMIT_PER_DAY: "40" })).toBe(40);
    expect(maxRunsPerIpPerDay({ RATE_LIMIT_PER_IP_PER_DAY: "5" })).toBe(5);
  });
});

describe.skipIf(!HAS_DB)("cross-visitor access to custom messages (S1)", () => {
  afterAll(closeAllPools);
  it("only the owner can run a custom message; a stranger and a null visitor get 404; seeded messages work for everyone", async () => {
    const a = visitorHash(`198.18.0.${rnd()}`), b = visitorHash(`198.18.1.${rnd()}`);
    const id = await createMessage(RES.asha, "Is parking included in my rent?", a);
    await expect(run(id, b)).rejects.toMatchObject({ status: 404 });
    await expect(run(id, null)).rejects.toMatchObject({ status: 404 });
    await expect(run(id, a)).resolves.toMatchObject({ created: true });
    await expect(run(seeded(2), b)).resolves.toMatchObject({ created: true });
    await expect(run(seeded(3), null)).resolves.toMatchObject({ created: true });
  });
});

describe.skipIf(!HAS_DB)("Retry-After is the real wait (S3)", () => {
  afterAll(closeAllPools);
  afterEach(() => { for (const k of ["RATE_LIMIT_PER_HOUR", "RATE_LIMIT_PER_DAY", "RATE_LIMIT_PER_IP_PER_HOUR", "RATE_LIMIT_PER_IP_PER_DAY"]) delete process.env[k]; });
  const backdate = (visitor: string, ago: string) => owner((c) => c.query(`UPDATE runs SET created_at = now() - $2::interval WHERE visitor_hash = $1 AND created_at = (SELECT min(created_at) FROM runs WHERE visitor_hash = $1)`, [visitor, ago]));

  it("hourly: the oldest run is 35 minutes old, so the wait is about 25 minutes (not the old constant 600)", async () => {
    process.env.RATE_LIMIT_PER_HOUR = "2";
    const v = visitorHash(`198.19.0.${rnd()}`);
    await run(seeded(1), v); await run(seeded(2), v);
    await backdate(v, "35 minutes");
    const e = await run(seeded(3), v).catch((x) => x as { status: number; extra: { retry_after_s: number } });
    expect(e).toMatchObject({ status: 429 });
    expect((e as { extra: { retry_after_s: number } }).extra.retry_after_s).toBeGreaterThanOrEqual(1498);
    expect((e as { extra: { retry_after_s: number } }).extra.retry_after_s).toBeLessThanOrEqual(1501);
  });
  it("daily: the oldest run is 20 hours old, so the wait is about 4 hours (not a constant)", async () => {
    process.env.RATE_LIMIT_PER_DAY = "2";
    const v = visitorHash(`198.19.1.${rnd()}`);
    await run(seeded(1), v); await run(seeded(2), v);
    await backdate(v, "20 hours");
    const e = await run(seeded(3), v).catch((x) => x as { status: number; extra: { retry_after_s: number } });
    expect(e).toMatchObject({ status: 429 });
    const s = (e as { extra: { retry_after_s: number } }).extra.retry_after_s;
    expect(s).toBeGreaterThanOrEqual(14_398); expect(s).toBeLessThanOrEqual(14_401);
  });
  it("never more than one day and never less than one second", async () => {
    process.env.RATE_LIMIT_PER_HOUR = "1";
    const v = visitorHash(`198.19.2.${rnd()}`);
    await run(seeded(1), v);
    const e = await run(seeded(2), v).catch((x) => x as { extra: { retry_after_s: number } });
    const s = (e as { extra: { retry_after_s: number } }).extra.retry_after_s;
    expect(s).toBeGreaterThan(3590); expect(s).toBeLessThanOrEqual(3600);
  });
});

describe.skipIf(!HAS_DB)("per-network ceiling (cookie-independent)", () => {
  afterAll(closeAllPools);
  afterEach(() => { delete process.env.RATE_LIMIT_PER_IP_PER_HOUR; delete process.env.RATE_LIMIT_PER_IP_PER_DAY; });

  it("a client that discards its cookie (a new visitor every request) is stopped at exactly the ceiling: 3 allowed, 2 refused with a real Retry-After", async () => {
    process.env.RATE_LIMIT_PER_IP_PER_HOUR = "3";
    const net = netHash(`203.0.113.${rnd()}`);
    const out = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => run(seeded(1 + i), visitorHash(`c:${randomUUID()}`), net)));
    expect(out.filter((o) => o.status === "fulfilled")).toHaveLength(3);
    const refused = out.map(reason).filter(Boolean);
    expect(refused).toHaveLength(2);
    for (const r of refused) { expect(r!.status).toBe(429); expect(r!.extra!.retry_after_s).toBeGreaterThan(3590); expect(r!.extra!.retry_after_s).toBeLessThanOrEqual(3600); }
    expect(await owner(async (c) => (await c.query("SELECT count(*)::int AS n FROM runs WHERE net_hash = $1", [net])).rows[0].n)).toBe(3);
  });
  it("a different network is unaffected by the first one's ceiling", async () => {
    process.env.RATE_LIMIT_PER_IP_PER_HOUR = "1";
    const first = netHash(`203.0.114.${rnd()}`), other = netHash(`203.0.115.${rnd()}`);
    await run(seeded(1), visitorHash(`c:${randomUUID()}`), first);
    await expect(run(seeded(2), visitorHash(`c:${randomUUID()}`), first)).rejects.toMatchObject({ status: 429 });
    await expect(run(seeded(2), visitorHash(`c:${randomUUID()}`), other)).resolves.toMatchObject({ created: true });
  });
  it("one network cannot use more than its share of the day: the daily ceiling refuses run N+1", async () => {
    process.env.RATE_LIMIT_PER_IP_PER_DAY = "2";
    const net = netHash(`203.0.116.${rnd()}`);
    await run(seeded(1), visitorHash(`c:${randomUUID()}`), net); await run(seeded(2), visitorHash(`c:${randomUUID()}`), net);
    await expect(run(seeded(3), visitorHash(`c:${randomUUID()}`), net)).rejects.toMatchObject({ status: 429, message: expect.stringMatching(/network/) });
  });
  it("with no trusted proxy there is no network key, so only the per-visitor limits apply (advisory)", async () => {
    process.env.RATE_LIMIT_PER_IP_PER_HOUR = "1";
    const out = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => run(seeded(1 + i), visitorHash(`c:${randomUUID()}`), null)));
    expect(out.every((o) => o.status === "fulfilled")).toBe(true);
  });
});
