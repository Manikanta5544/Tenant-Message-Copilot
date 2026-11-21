import { listInbox, listResidents, visitorHash } from "@/db/runs";
import { clientKey } from "@/app/server/http";
import { fail } from "@/app/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try { return Response.json({ messages: await listInbox(visitorHash(clientKey(req).ip)), residents: await listResidents() }); } catch (e) { return fail(e); }
}
