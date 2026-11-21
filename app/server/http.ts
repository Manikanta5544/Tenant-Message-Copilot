import { z } from "zod";
import { HttpError } from "@/db/runs";

/** Same-shape JSON errors, sanitised: never a stack, SQL text or provider message. */
export function fail(e: unknown): Response {
  if (e instanceof HttpError) return Response.json({ error: e.message, ...(e.extra ?? {}) }, { status: e.status, headers: e.extra?.retry_after_s ? { "retry-after": String(e.extra.retry_after_s) } : undefined });
  if (e instanceof z.ZodError) return Response.json({ error: "invalid request", issues: e.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  console.error("[api] unhandled", e instanceof Error ? e.name : "error");
  return Response.json({ error: "internal error" }, { status: 500 });
}

const MAX_BODY = 4096;
export async function readJson<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, "request too large");
  let raw: unknown;
  try { raw = JSON.parse(text || "{}"); } catch { throw new HttpError(400, "body must be JSON"); }
  return schema.parse(raw);
}

/** Vercel overwrites x-forwarded-for with the real client IP; the User-Agent is deliberately not used (the caller controls it). */
export const clientKey = (req: Request) => ({ ip: (req.headers.get("x-forwarded-for") ?? "").split(",")[0]!.trim() || "local" });
