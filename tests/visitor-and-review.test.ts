import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MockProvider } from "../core/providers/mock";
import { closeAllPools } from "../db/client";
import { uid } from "../db/ids";
import { listReviews, recordReview } from "../db/review";
import { HttpError, getRun, listInbox, startRun, visitorHash } from "../db/runs";
import { checkEditedText } from "../core/review";
import { APP_URL, HAS_DB, OWNER_URL } from "./helpers";

process.env.DATABASE_URL_APP = APP_URL;
process.env.DEMO_AS_OF_DATE = "2026-11-19";
process.env.DEMO_DAILY_BUDGET_USD = "50";
const msg = uid("message", 2); // Asha: balance question
const run = (visitor: string | null) => startRun({ messageId: msg, idempotencyKey: randomUUID(), provider: new MockProvider(), visitor });
const rowFor = async (visitor: string | null) => (await listInbox(visitor)).find((r) => r.message_id === msg)!;

describe.skipIf(!HAS_DB)("D3 visitor-scoped demo state", () => {
  afterAll(closeAllPools);
  const A = visitorHash("10.0.0.1"), B = visitorHash("10.0.0.2");

  it("two visitors: one visitor's failed run cannot change another's inbox", async () => {
    const baseline = await run(null);                 // the shared baseline (as `npm run seed` creates)
    expect((await rowFor(A)).run!.id).toBe(baseline.runId);
    expect((await rowFor(B)).run!.id).toBe(baseline.runId);

    const mine = await run(A);                         // A generates again
    expect((await rowFor(A)).run!.id).toBe(mine.runId);
    expect((await rowFor(B)).run!.id).toBe(baseline.runId);

    // A's run fails (owner connection: the function was cut off, say).
    const owner = new pg.Client({ connectionString: OWNER_URL }); await owner.connect();
    await owner.query(`UPDATE runs SET status = 'failed' WHERE id = $1`, [mine.runId]); await owner.end();
    const a = await rowFor(A), b = await rowFor(B), anon = await rowFor(null);
    expect(a.run!.status).toBe("failed");
    expect(b.run!.id).toBe(baseline.runId);
    expect(b.run!.status).toBe("completed");
    expect(b.run!.route).toBe((await getRun(baseline.runId))!.run.route);
    expect(anon.run!.id).toBe(baseline.runId);
  });

  it("a visitor's newer run replaces only their own view; the baseline survives", async () => {
    const first = await run(B); const second = await run(B);
    expect((await rowFor(B)).run!.id).toBe(second.runId);
    expect(first.runId).not.toBe(second.runId);
    const other = visitorHash("10.0.0.3");
    expect((await rowFor(other)).run!.id).not.toBe(second.runId);
  });
});

describe("D4 edit validation (guard)", () => {
  const segs = [{ type: "text", text: "Your balance is " }, { type: "fact", text: "₹12,000" }, { type: "text", text: ". A manager will review." }];
  it("accepts the evidence-rendered values and plain rewording", () => {
    expect(checkEditedText("Thanks for writing. Your balance is ₹12,000. A manager will look at it.", segs).ok).toBe(true);
  });
  it("rejects a new number or amount, with a visible reason", () => {
    const r = checkEditedText("Your balance is ₹12,000 and you owe 500 more.", segs);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/digit|introduces/);
  });
  it("rejects a promise", () => {
    const r = checkEditedText("We will refund the late fee.", segs);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/commitment/);
  });
  it("rejects empty text", () => { expect(checkEditedText("   ", segs).ok).toBe(false); });
});

describe.skipIf(!HAS_DB)("D4 review actions", () => {
  afterAll(closeAllPools);
  const V = visitorHash("10.1.0.1"), W = visitorHash("10.1.0.2");
  const completed = async () => (await run(V)).runId;

  it("records, is idempotent, and persists per visitor", async () => {
    const runId = await completed();
    const key = randomUUID();
    const a = await recordReview({ runId, visitor: V, action: "approved", idempotencyKey: key });
    const b = await recordReview({ runId, visitor: V, action: "approved", idempotencyKey: key });
    expect(a.created).toBe(true); expect(b.created).toBe(false); expect(b.review.id).toBe(a.review.id);
    expect((await listReviews(runId, V)).filter((r) => r.run_id === runId).map((r) => r.action)).toEqual(["approved"]);
    expect(await listReviews(runId, W)).toEqual([]);
  });
  it("history spans every run of the message, per visitor", async () => {
    const r1 = await completed(), r2 = await completed();
    await recordReview({ runId: r1, visitor: V, action: "approved", idempotencyKey: randomUUID() });
    const h = await listReviews(r2, V);
    expect(h.some((x) => x.run_id === r1)).toBe(true);
    expect(await listReviews(r2, visitorHash("10.9.9.9"))).toEqual([]);
  });
  it("an idempotency key cannot be reused for another run", async () => {
    const r1 = await completed(), r2 = await completed(); const key = randomUUID();
    await recordReview({ runId: r1, visitor: V, action: "approved", idempotencyKey: key });
    await expect(recordReview({ runId: r2, visitor: V, action: "approved", idempotencyKey: key })).rejects.toMatchObject({ status: 409 });
  });
  it("an edit that introduces a number is rejected and nothing is stored", async () => {
    const runId = await completed();
    await expect(recordReview({ runId, visitor: V, action: "edited", editedText: "You owe 99 rupees.", idempotencyKey: randomUUID() })).rejects.toMatchObject({ status: 422 });
    expect((await listReviews(runId, V)).filter((r) => r.run_id === runId)).toEqual([]);
    const ok = await recordReview({ runId, visitor: V, action: "edited", editedText: "Thanks, a manager will follow up.", idempotencyKey: randomUUID() });
    expect(ok.review.edited_text).toBe("Thanks, a manager will follow up.");
  });
  it("escalate-only runs and unfinished runs cannot be approved", async () => {
    const esc = (await startRun({ messageId: uid("message", 5), idempotencyKey: randomUUID(), provider: new MockProvider(), visitor: V })).runId;
    await expect(recordReview({ runId: esc, visitor: V, action: "approved", idempotencyKey: randomUUID() })).rejects.toBeInstanceOf(HttpError);
    await expect(recordReview({ runId: randomUUID(), visitor: V, action: "approved", idempotencyKey: randomUUID() })).rejects.toMatchObject({ status: 404 });
  });
  it("the database denies UPDATE and DELETE on review_actions to the runtime role and to the owner", async () => {
    const runId = await completed();
    await recordReview({ runId, visitor: V, action: "approved", idempotencyKey: randomUUID() });
    for (const url of [APP_URL!, OWNER_URL!]) {
      const c = new pg.Client({ connectionString: url }); await c.connect();
      await c.query("SELECT set_config('app.org_id', $1, false), set_config('app.resident_id', $2, false)", [uid("org", 1), uid("resident", 101)]);
      await expect(c.query(`UPDATE review_actions SET action = 'approved'`)).rejects.toThrow(/permission denied|append-only/);
      await expect(c.query(`DELETE FROM review_actions`)).rejects.toThrow(/permission denied|append-only/);
      await expect(c.query(`TRUNCATE review_actions`)).rejects.toThrow(/permission denied|append-only/);
      await c.end();
    }
  });
  it("RLS hides another resident's review actions", async () => {
    const runId = await completed();
    await recordReview({ runId, visitor: V, action: "approved", idempotencyKey: randomUUID() });
    const c = new pg.Client({ connectionString: APP_URL }); await c.connect();
    await c.query("SELECT set_config('app.org_id', $1, false), set_config('app.resident_id', $2, false)", [uid("org", 1), uid("resident", 102)]);
    expect((await c.query(`SELECT * FROM review_actions`)).rowCount).toBe(0);
    await c.end();
  });
});
