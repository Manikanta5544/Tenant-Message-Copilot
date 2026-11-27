import { z } from "zod";
import { createHash } from "node:crypto";
import { clientKey, fail, jsonWithEtag, matchesEtag, notModified } from "@/app/server/http";
import { listReviews } from "@/db/review";
import { HttpError, getRun, runVersion, visitorHash } from "@/db/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    z.string().uuid().parse(id);
    const visitor = visitorHash(clientKey(req).ip);
    // Answer a conditional request from one small query, before the run, its trace and its reviews are loaded and serialised.
    const v = await runVersion(id, visitor);
    if (!v) throw new HttpError(404, "run not found");
    const etag = `W/"${createHash("sha1").update(v.token).digest("base64url").slice(0, 22)}"`;
    if (!v.stale && matchesEtag(req, etag)) return notModified(etag);
    const t0 = performance.now();
    const r = await getRun(id);
    const dbMs = performance.now() - t0;
    if (!r) throw new HttpError(404, "run not found");
    // The run itself is a read-only capability URL over synthetic data (D5). The reviewer history is the caller's own.
    // Server-Timing (D7): database read time and the pipeline's own recorded stage time.
    const pipelineMs = r.trace.reduce((n, t) => n + t.latency_ms, 0);
    return jsonWithEtag(req, { ...r, reviews: await listReviews(id, visitor) }, { "server-timing": `db;dur=${dbMs.toFixed(1)}, pipeline;dur=${pipelineMs}` }, v.stale ? undefined : v.token);
  } catch (e) { return fail(e, req); }
}
