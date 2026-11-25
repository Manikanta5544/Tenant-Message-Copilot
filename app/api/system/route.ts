import { fail } from "@/app/server/http";
import { cachedSystemStats } from "@/db/system";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only aggregates (no PII). Cached 5 s server-side. */
export async function GET(req: Request) {
  try { return Response.json(await cachedSystemStats(), { headers: { "cache-control": "no-store" } }); } catch (e) { return fail(e, req); }
}
