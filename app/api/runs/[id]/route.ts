import { z } from "zod";
import { clientKey, fail } from "@/app/server/http";
import { listReviews } from "@/db/review";
import { HttpError, getRun, visitorHash } from "@/db/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    z.string().uuid().parse(id);
    const t0 = performance.now();
    const r = await getRun(id);
    const dbMs = performance.now() - t0;
    if (!r) throw new HttpError(404, "run not found");
    // The run itself is a read-only capability URL over synthetic data (D5). The reviewer history is the caller's own.
    const body = Response.json({ ...r, reviews: await listReviews(id, visitorHash(clientKey(req).ip)) });
    // Server-Timing (D7): database read time and the pipeline's own recorded stage time.
    const pipelineMs = r.trace.reduce((n, t) => n + t.latency_ms, 0);
    body.headers.set("Server-Timing", `db;dur=${dbMs.toFixed(1)}, pipeline;dur=${pipelineMs}`);
    return body;
  } catch (e) { return fail(e); }
}
