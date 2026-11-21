import { z } from "zod";
import { fail } from "@/app/server/http";
import { HttpError, getRun } from "@/db/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    z.string().uuid().parse(id);
    const r = await getRun(id);
    if (!r) throw new HttpError(404, "run not found");
    return Response.json(r);
  } catch (e) { return fail(e); }
}
