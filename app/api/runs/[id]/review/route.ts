import { z } from "zod";
import { clientKey, fail, readJson } from "@/app/server/http";
import { MAX_EDIT_CHARS } from "@/core/review";
import { recordReview } from "@/db/review";
import { visitorHash } from "@/db/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.strictObject({
  action: z.enum(["approved", "edited", "regenerated"]),
  edited_text: z.string().max(MAX_EDIT_CHARS).optional(),
  idempotency_key: z.string().uuid(),
});

/** Records a reviewer decision about a run (append-only). Repeating an idempotency key returns the first record. Nothing is sent to anyone. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const runId = z.string().uuid().parse((await ctx.params).id);
    const b = await readJson(req, Body);
    const r = await recordReview({ runId, visitor: visitorHash(clientKey(req).ip), action: b.action, editedText: b.edited_text ?? null, idempotencyKey: b.idempotency_key });
    return Response.json({ review: r.review, created: r.created }, { status: r.created ? 201 : 200 });
  } catch (e) { return fail(e); }
}
