import { z } from "zod";
import { HttpError } from "@/db/runs";
import { randomUUID } from "node:crypto";
import { EnvError, getEnv, trustsProxy, type Env } from "@/core/env";
import { logError, redactSecrets, safeErrorMessage } from "@/core/log";
import { ConfigMissingError, DbUnavailableError, asDbUnavailable } from "@/core/db-errors";
import { SchemaOutOfDateError, SCHEMA_HINT, isSchemaDriftCode } from "@/core/schema-version";

/** Same-shape JSON errors, sanitised: never a stack, SQL text or provider message. */
export function fail(e: unknown, req?: Request): Response {
  if (e instanceof HttpError) return Response.json({ error: e.message, ...(e.status === 429 ? { code: /daily run limit/.test(e.message) ? "budget_exhausted" : "rate_limited" } : {}), ...(e.extra ?? {}) }, { status: e.status, headers: e.extra?.retry_after_s ? { "retry-after": String(e.extra.retry_after_s) } : undefined });
  if (e instanceof z.ZodError) return Response.json({ error: "invalid request", issues: e.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  if (e instanceof EnvError) {
    // Misconfiguration: log the readable list for the operator, show visitors a plain maintenance message.
    console.error(JSON.stringify({ level: "error", msg: "configuration invalid", problems: e.problems }));
    return Response.json({ error: "The service is in maintenance. Please try again later.", code: "maintenance" }, { status: 503 });
  }
  const pgCode = (e as { code?: unknown } | null)?.code;
  const ref = randomUUID().slice(0, 8);
  // A connection or login failure that reached us unclassified (for example a pool error) is classified here, so no route can leak an opaque 500.
  e = asDbUnavailable(e);
  if (e instanceof ConfigMissingError) {
    console.error(JSON.stringify({ level: "error", msg: "configuration missing", correlation_id: ref, missing: e.missing }));
    return Response.json({ error: "The service is not configured.", code: "config_missing", hint: e.hint, missing: e.missing, correlation_id: ref }, { status: 503 });
  }
  if (e instanceof DbUnavailableError) {
    return Response.json({ error: "The database is not available.", code: e.code, hint: e.hint, host: e.host, port: e.port, correlation_id: ref }, { status: 503 });
  }
  if (e instanceof SchemaOutOfDateError || isSchemaDriftCode(pgCode)) {
    // A stale schema is an operator problem with a known fix: say so, in every environment, with a 503.
    const missing = e instanceof SchemaOutOfDateError ? e.missing : undefined;
    console.error(JSON.stringify({ level: "error", msg: "schema out of date", missing, pg_code: typeof pgCode === "string" ? pgCode : undefined }));
    return Response.json({ error: "The database schema is out of date.", code: "schema_out_of_date", hint: SCHEMA_HINT, correlation_id: ref, ...(missing ? { missing } : {}) }, { status: 503 });
  }
  // Unexpected: log a diagnosable line for the operator and give the client a reference id to quote. No stack or SQL to the client.
  const correlation_id = ref;
  let route = "unknown";
  try { if (req) route = new URL(req.url).pathname; } catch { /* keep unknown */ }
  logError({
    correlation_id, route, error_name: e instanceof Error ? e.name : "error", message: safeErrorMessage(e),
    ...(typeof pgCode === "string" ? { pg_code: pgCode } : {}),
    ...(getEnv().NODE_ENV !== "production" && e instanceof Error && e.stack ? { stack: redactSecrets(e.stack.split("\n").slice(0, 8).join("\n")) } : {}),
  });
  return Response.json({ error: "internal error", correlation_id }, { status: 500 });
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
