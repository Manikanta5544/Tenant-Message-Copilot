import { z } from "zod";
import { sanitizeMessage } from "@/core/sanitize";
import { clientKey, fail, readJson } from "@/app/server/http";
import { MAX_MESSAGE_CHARS, createMessage, visitorHash } from "@/db/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The browser picks a seeded resident; the organisation is fixed on the server and the database enforces it.
const Body = z.strictObject({ resident_id: z.string().uuid(), text: z.string().transform(sanitizeMessage).pipe(z.string().trim().min(1).max(MAX_MESSAGE_CHARS)) });

export async function POST(req: Request) {
  try {
    const b = await readJson(req, Body);
    return Response.json({ message_id: await createMessage(b.resident_id, b.text, visitorHash(clientKey(req).ip)) }, { status: 201 });
  } catch (e) { return fail(e, req); }
}
