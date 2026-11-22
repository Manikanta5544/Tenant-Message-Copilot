// Reviewer decisions (decision D4): append-only rows in review_actions, written under the strict organisation + resident
// scope of the run's resident. Nothing here sends anything to a tenant.
import { randomUUID } from "node:crypto";
import { checkEditedText } from "@/core/review";
import { appUrl, withScope } from "./client";
import { DEMO_ORG_ID } from "./ids";
import { HttpError } from "./runs";

export type ReviewActionKind = "approved" | "edited" | "regenerated";
export interface ReviewRow { id: string; run_id: string; action: ReviewActionKind; edited_text: string | null; created_at: string }

export const MAX_REVIEWS_PER_HOUR = 60;

export async function recordReview(a: { runId: string; visitor: string; action: ReviewActionKind; editedText?: string | null; idempotencyKey: string }): Promise<{ review: ReviewRow; created: boolean }> {
  const url = appUrl();
  const run = await withScope(url, { orgId: DEMO_ORG_ID, view: "inbox" }, async (db) =>
    (await db.query<{ resident_id: string; status: string; route: string | null; segments: { type: string; text: string }[] | null }>(
      `SELECT resident_id, status, route, segments FROM runs WHERE id = $1`, [a.runId])).rows[0]);
  if (!run) throw new HttpError(404, "run not found");

  if (a.action !== "regenerated") {
    if (run.status !== "completed") throw new HttpError(409, "This run has not finished, so it cannot be reviewed yet.");
    if (run.route === "escalate_only") throw new HttpError(409, "Escalate-only messages have no draft to approve. Handle them manually.");
  }
  if (a.action === "edited") {
    const c = checkEditedText(a.editedText ?? "", run.segments ?? []);
    if (!c.ok) throw new HttpError(422, c.reason, { reason: c.reason });
  } else if (a.editedText) {
    throw new HttpError(400, "edited_text is only allowed with action 'edited'");
  }

  const id = randomUUID();
  return withScope(url, { orgId: DEMO_ORG_ID, residentId: run.resident_id }, async (db) => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`review:${a.visitor}`]);
    const ins = await db.query<ReviewRow>(
      `INSERT INTO review_actions (id, organization_id, resident_id, run_id, visitor_hash, action, edited_text, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (organization_id, idempotency_key) DO NOTHING
       RETURNING id, run_id, action, edited_text, created_at`,
      [id, DEMO_ORG_ID, run.resident_id, a.runId, a.visitor, a.action, a.action === "edited" ? a.editedText!.trim() : null, a.idempotencyKey]);
    if (ins.rowCount === 1) {
      const n = Number((await db.query(`SELECT count(*)::int AS n FROM review_actions WHERE visitor_hash = $1 AND created_at > now() - interval '60 minutes'`, [a.visitor])).rows[0]!.n);
      if (n > MAX_REVIEWS_PER_HOUR) throw new HttpError(429, "review limit reached for this demo", { retry_after_s: 600 });
      return { review: toRow(ins.rows[0]!), created: true };
    }
    const ex = await db.query<ReviewRow & { visitor_hash: string }>(`SELECT id, run_id, action, edited_text, created_at, visitor_hash FROM review_actions WHERE idempotency_key = $1`, [a.idempotencyKey]);
    const e = ex.rows[0];
    if (!e || e.run_id !== a.runId || e.visitor_hash !== a.visitor) throw new HttpError(409, "idempotency key already used for a different review");
    return { review: toRow(e), created: false };
  });
}

const toRow = (r: ReviewRow): ReviewRow => ({ id: r.id, run_id: r.run_id, action: r.action, edited_text: r.edited_text, created_at: new Date(r.created_at).toISOString() });

/** This visitor's recorded decisions for the run's message (all of its runs), oldest first. */
export async function listReviews(runId: string, visitor: string): Promise<ReviewRow[]> {
  return withScope(appUrl(), { orgId: DEMO_ORG_ID, view: "inbox" }, async (db) => {
    // review_actions has strict-scope policies only; the inbox view is not enough, so resolve the resident first.
    const r = await db.query<{ resident_id: string }>(`SELECT resident_id FROM runs WHERE id = $1`, [runId]);
    return r.rows[0]?.resident_id ?? null;
  }).then(async (residentId) => {
    if (!residentId) return [];
    return withScope(appUrl(), { orgId: DEMO_ORG_ID, residentId }, async (db) =>
      (await db.query<ReviewRow>(
        `SELECT ra.id, ra.run_id, ra.action, ra.edited_text, ra.created_at FROM review_actions ra
           JOIN runs r ON r.id = ra.run_id
          WHERE r.message_id = (SELECT message_id FROM runs WHERE id = $1) AND ra.visitor_hash = $2
          ORDER BY ra.created_at, ra.id`, [runId, visitor])).rows.map(toRow));
  });
}
