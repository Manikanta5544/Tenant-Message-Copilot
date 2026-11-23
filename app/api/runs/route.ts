import { after } from "next/server";
import { z } from "zod";
import { createProvider } from "@/app/server/provider";
import { clientKey, fail, readJson } from "@/app/server/http";
import { createRun, visitorHash } from "@/db/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.strictObject({ message_id: z.string().uuid(), idempotency_key: z.string().uuid() });

/** Returns the run id at once; the pipeline finishes after the response and the UI polls GET /api/runs/:id for the live trace. */
export async function POST(req: Request) {
  try {
    const b = await readJson(req, Body);
    const visitor = visitorHash(clientKey(req).ip);
    // Limits are enforced atomically inside createRun. A repeated idempotency key creates no run and uses no quota.
    const h = await createRun({ messageId: b.message_id, idempotencyKey: b.idempotency_key, provider: createProvider(), visitor });
    if (h.execute) { const go = h.execute; after(() => go().catch((e) => console.error("[run] failed", e instanceof Error ? e.name : "error"))); }
    return Response.json({ run_id: h.runId, created: h.created }, { status: h.created ? 202 : 200 });
  } catch (e) { return fail(e, req); }
}
