import { z } from "zod";
import { HttpError } from "@/db/runs";
import { EnvError, getEnv, trustsProxy, type Env } from "@/core/env";

/** Same-shape JSON errors, sanitised: never a stack, SQL text or provider message. */
export function fail(e: unknown): Response {
  if (e instanceof HttpError) return Response.json({ error: e.message, ...(e.extra ?? {}) }, { status: e.status, headers: e.extra?.retry_after_s ? { "retry-after": String(e.extra.retry_after_s) } : undefined });
  if (e instanceof z.ZodError) return Response.json({ error: "invalid request", issues: e.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  if (e instanceof EnvError) {
    // Misconfiguration: log the readable list for the operator, show visitors a plain maintenance message.
    console.error(JSON.stringify({ level: "error", msg: "configuration invalid", problems: e.problems }));
    return Response.json({ error: "The service is in maintenance. Please try again later.", code: "maintenance" }, { status: 503 });
  }
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

/**
 * Client identity for rate limits. x-forwarded-for is trusted only behind Vercel (VERCEL=1) or when the operator
 * sets TRUST_PROXY=1; anywhere else the header is attacker-controlled, so it is ignored. The App Router exposes
 * no socket address on Request, so untrusted traffic shares one conservative bucket ("untrusted") rather than
 * letting a client mint unlimited identities by rotating the header. Documented in docs/RUNBOOK.md.
 */
export function clientKey(req: Request, env: Pick<Env, "VERCEL" | "TRUST_PROXY"> = getEnv()) {
  if (!trustsProxy(env)) return { ip: "untrusted" };
  return { ip: (req.headers.get("x-forwarded-for") ?? "").split(",")[0]!.trim() || "local" };
}
