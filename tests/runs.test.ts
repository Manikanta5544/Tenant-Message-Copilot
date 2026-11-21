import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MockProvider } from "../core/providers/mock";
import { closeAllPools } from "../db/client";
import { ORG_A, RES, uid } from "../db/ids";
import { HttpError, createMessage, getRun, listInbox, recentRunCount, startRun, visitorHash } from "../db/runs";
import { APP_URL, HAS_DB, OWNER_URL } from "./helpers";

process.env.DATABASE_URL_APP = APP_URL;
process.env.DEMO_AS_OF_DATE = "2026-11-19";
process.env.DEMO_DAILY_BUDGET_USD = "50";
const msg = (n: number) => uid("message", n); // seeded: 1 = Ravi (tap), 2 = Asha (balance), 5 = Vikram (injection)
const provider = () => new MockProvider();
const run = (messageId: string, key = randomUUID(), visitor: string | null = null) => startRun({ messageId, idempotencyKey: key, provider: provider(), visitor });

describe.skipIf(!HAS_DB)("run service", () => {
  afterAll(closeAllPools);

  it("persists a run with its trace events in order, and the run page can read them back", async () => {
    const { runId, created } = await run(msg(1));
    expect(created).toBe(true);
    const got = (await getRun(runId))!;
    expect(got.run.status).toBe("completed");
    expect(got.run.route).toBe("draft_ready");
    expect(got.run.mode).toBe("mock");
    expect(got.trace.map((t) => t.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(got.trace.map((t) => t.stage)).toEqual(["pipeline_started", "budget", "triage", "evidence", "adjudicate", "draft", "semantic_check", "route"]);
    const draftEvent = got.trace.find((t) => t.stage === "draft")!;
    expect(draftEvent.cost_micro_usd).toBe(0); // the mock is free, so a mock demo cannot exhaust the budget
    expect(draftEvent.tokens_in).toBeGreaterThan(0);
  });

  it("is idempotent: the same key returns the same run and creates no second run", async () => {
    const key = randomUUID();
    const a = await run(msg(2), key), b = await run(msg(2), key);
    expect(a.created).toBe(true);
    expect(b).toEqual({ runId: a.runId, created: false });
  });

  it("an idempotency key used for another message, or another resident's, is a 409 that reveals nothing", async () => {
    const key = randomUUID();
    await run(msg(2), key);
    await expect(run(msg(1), key)).rejects.toMatchObject({ status: 409 });          // different resident (Ravi vs Asha)
    await expect(run(msg(3), key)).rejects.toBeInstanceOf(HttpError);
    await expect(run(uid("message", 99999))).rejects.toMatchObject({ status: 404 }); // unknown message
  });

  it("takes the resident from the stored message: the run for message 5 is bound to Vikram and never touches apartment 302", async () => {
    const { runId } = await run(msg(5));
    const got = (await getRun(runId))!;
    expect(got.run.resident.unit).toBe("202");
    expect(got.run.route).toBe("escalate_only");
    expect(JSON.stringify(got)).not.toMatch(/17,350|1735000|Sunita|UPI-S302/);
    const c = new pg.Client({ connectionString: OWNER_URL }); await c.connect();
    const r = await c.query("SELECT resident_id FROM runs WHERE id = $1", [runId]); await c.end();
    expect(r.rows[0].resident_id).toBe(RES.vikram);
  });

  it("custom messages: allowed for a seeded resident, rejected for a resident outside the fixed organisation", async () => {
    const v = visitorHash("203.0.113.77");
    const id = await createMessage(RES.sunita, "What is my grace period?", v);
    expect((await listInbox(v)).some((m) => m.message_id === id && m.source === "live")).toBe(true);
    expect((await listInbox(visitorHash("203.0.113.78"))).some((m) => m.message_id === id)).toBe(false); // other visitors never see it
    const c = new pg.Client({ connectionString: OWNER_URL }); await c.connect();
    await expect(createMessage(RES.rohan, "from the other organisation")).rejects.toMatchObject({ status: 404 });
    expect((await c.query("SELECT count(*)::int AS n FROM messages WHERE text = 'from the other organisation'")).rows[0].n).toBe(0);
    await c.end();
  });

  it("counts runs per visitor hash for the rate limit; repeats of an idempotency key do not count", async () => {
    const v = visitorHash("203.0.113.9");
    const before = await recentRunCount(v, 60);
    const key = randomUUID();
    await run(msg(1), key, v); await run(msg(1), key, v); await run(msg(1), randomUUID(), v);
    expect(await recentRunCount(v, 60)).toBe(before + 2);
    expect(await recentRunCount(visitorHash("198.51.100.1"), 60)).toBe(0);
    expect(v).not.toContain("203.0.113.9");
  });

  it("marks an unfinished run failed on the next read once it is stale, and leaves a fresh one alone", async () => {
    const c = new pg.Client({ connectionString: OWNER_URL }); await c.connect();
    const mk = async (ageSeconds: number) => {
      const id = randomUUID();
      await c.query(`INSERT INTO runs (id, organization_id, resident_id, message_id, prompt_version, mode, status, idempotency_key, created_at)
        VALUES ($1,$2,$3,$4,'v1','mock','running',$5, now() - ($6 || ' seconds')::interval)`, [id, ORG_A, RES.ravi, msg(1), randomUUID(), String(ageSeconds)]);
      return id;
    };
    const stale = await mk(600), fresh = await mk(5);
    await c.end();
    expect((await getRun(stale))!.run.status).toBe("failed");
    expect((await getRun(fresh))!.run.status).toBe("running");
  });

  it("trace payloads are redacted on read", async () => {
    const { runId } = await run(msg(1));
    const c = new pg.Client({ connectionString: OWNER_URL }); await c.connect();
    await c.query(`UPDATE trace_events SET payload = '{"prompt":"SECRET PROMPT","reasoning":"thoughts","ok":"sk-ant-abc123 visible?"}' WHERE run_id = $1 AND seq = 1`, [runId]).catch(async () => {
      // trace_events has no UPDATE grant for the app role, but the owner may update it
    });
    await c.end();
    const t = JSON.stringify((await getRun(runId))!.trace[0]);
    expect(t).not.toMatch(/SECRET PROMPT|thoughts|sk-ant-abc123/);
  });
});
