import { z } from "zod";
import { noteEvent } from "@/core/counters";
import { getEnv } from "@/core/env";
import { clientKey, fail } from "@/app/server/http";
import { caps, runEventStream } from "@/app/server/sse";
import { listReviews } from "@/db/review";
import { HttpError, getRun, pollRun, visitorHash } from "@/db/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // aligned with /api/runs; the stream closes at 70 s on a long-lived host and the browser resumes

/** GET /api/runs/:id/events — live trace events for one run, scoped exactly like GET /api/runs/:id. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    z.string().uuid().parse(id);
    const env = getEnv();
    caps.maxPerIp = env.SSE_MAX_PER_IP; caps.maxGlobal = env.SSE_MAX_GLOBAL;
    const { ip } = clientKey(req);
    const release = caps.acquire(ip, ip !== "untrusted");
    if (!release) noteEvent("stream_cap");
    if (!release) return Response.json({ error: "too many live streams; the page falls back to polling", code: "stream_cap" }, { status: 429, headers: { "retry-after": "5" } });
    if (!(await pollRun(id, 2_147_483_647).catch((e) => { release(); throw e; }))) { release(); throw new HttpError(404, "run not found"); }
    const url = new URL(req.url);
    const afterSeq = Math.max(0, Number(req.headers.get("last-event-id") ?? url.searchParams.get("after") ?? 0) || 0);
    const visitor = visitorHash(ip);
    const stream = runEventStream({
      poll: (n) => pollRun(id, n),
      final: async () => { const r = await getRun(id); return r ? { ...r, reviews: await listReviews(id, visitor) } : null; },
      signal: req.signal, afterSeq,
    });
    // Release the slot when the stream ends for any reason.
    const reader = stream.getReader();
    const out = new ReadableStream<Uint8Array>({
      async pull(c) { const { done, value } = await reader.read(); if (done) { release(); c.close(); } else c.enqueue(value); },
      cancel() { release(); return reader.cancel(); },
    });
    return new Response(out, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
  } catch (e) { return fail(e, req); }
}
