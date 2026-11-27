import { createHash } from "node:crypto";
import { noteEvent } from "@/core/counters";
import { z } from "zod";
import { HttpError } from "@/db/runs";
import { randomUUID } from "node:crypto";
import { trustedClientIp, readVisitorId } from "@/core/visitor";
import { EnvError, getEnv, isProduction, trustsProxy, type Env } from "@/core/env";
import { logError, redactSecrets, safeErrorMessage } from "@/core/log";
import { ConfigMissingError, DbUnavailableError, asDbUnavailable } from "@/core/db-errors";
import { SchemaOutOfDateError, SCHEMA_HINT, isSchemaDriftCode } from "@/core/schema-version";

/** Same-shape JSON errors, sanitised: never a stack, SQL text or provider message. */
export function fail(e: unknown, req?: Request): Response {
  if (e instanceof HttpError && e.status === 429) {
    noteEvent("rate_limited");
    // Every 429 says when to come back, in the header and the body, so the client can show the reset time.
    const wait = Number(e.extra?.retry_after_s) > 0 ? Number(e.extra?.retry_after_s) : 60;
    return Response.json({ error: e.message, code: /daily run limit/.test(e.message) ? "budget_exhausted" : "rate_limited", ...(e.extra ?? {}), retry_after_s: wait }, { status: 429, headers: { "retry-after": String(wait) } });
  }
  if (e instanceof HttpError) return Response.json({ error: e.message, ...(e.extra ?? {}) }, { status: e.status });
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
    // Setup details (variable names, the fix) are for the developer's own machine; a production visitor gets neither.
    return Response.json({ error: "The service is not configured.", code: "config_missing", ...(isProduction() ? {} : { hint: e.hint, missing: e.missing }), correlation_id: ref }, { status: 503 });
  }
  if (e instanceof DbUnavailableError) {
    // Host and port go to the server log only, with the reference id; in production the body carries neither them nor the setup hint.
    console.error(JSON.stringify({ level: "error", msg: "database unavailable", code: e.code, host: e.host, port: e.port, correlation_id: ref }));
    return Response.json({ error: "The database is not available.", code: e.code, ...(isProduction() ? {} : { hint: e.hint, host: e.host, port: e.port }), correlation_id: ref }, { status: 503 });
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
 * Client identity for rate limits and visitor scoping. Behind a trusted proxy (VERCEL=1 or TRUST_PROXY=1) it is the address the proxy
 * reports (x-vercel-forwarded-for, x-real-ip, else the Nth entry from the RIGHT of x-forwarded-for; TRUSTED_PROXY_HOPS). Otherwise every
 * forwarding header is attacker-controlled and ignored, and the identity is the signed visitor cookie. A request with neither a usable
 * address nor a valid cookie shares one "untrusted" bucket, so rotating headers or sending no cookie never mints identities.
 * The App Router exposes no socket address on Request. Documented in docs/RUNBOOK.md.
 */
export function clientKey(req: Request, env: Pick<Env, "VERCEL" | "TRUST_PROXY"> & Partial<Pick<Env, "TRUSTED_PROXY_HOPS" | "VISITOR_SALT">> = getEnv()): { ip: string; net: string | null } {
  const id = readVisitorId(req.headers.get("cookie"), env.VISITOR_SALT ?? "demo");
  if (trustsProxy(env)) {
    const addr = trustedClientIp(req.headers, env.TRUSTED_PROXY_HOPS ?? 1, env.VERCEL === "1");
    // `ip` is the visitor identity (their own cookie when they keep one, else their address); `net` is the address itself, used for
    // ceilings that a client cannot dodge by discarding cookies.
    if (addr) return { ip: id ? `c:${id}` : addr, net: addr };
  }
  return { ip: id ? `c:${id}` : "untrusted", net: null };
}

/** JSON with a weak ETag over the body, and a bodiless 304 when the caller already holds it (If-None-Match).
 *  `private, no-cache` means the browser must ask every time, so data is never stale; the 304 saves the transfer and the client's parse and render. */
/** True when the request's If-None-Match already names this version. */
export const matchesEtag = (req: Request, etag: string): boolean => (req.headers.get("if-none-match") ?? "").split(",").some((t) => t.trim() === etag || t.trim() === "*");
export const notModified = (etag: string, headers: Record<string, string> = {}): Response => new Response(null, { status: 304, headers: { ...headers, etag, "cache-control": "private, no-cache", vary: "cookie" } });

/** `version` lets a route name the representation by a cheap token (see runVersion) so a 304 is answered before the body is built. */
export function jsonWithEtag(req: Request, body: unknown, headers: Record<string, string> = {}, version?: string): Response {
  const text = JSON.stringify(body);
  const etag = version ? `W/"${createHash("sha1").update(version).digest("base64url").slice(0, 22)}"` : `W/"${createHash("sha1").update(text).digest("base64url").slice(0, 22)}"`;
  const h = { ...headers, etag, "cache-control": "private, no-cache", vary: "cookie" };
  const inm = req.headers.get("if-none-match");
  if (inm && inm.split(",").some((t) => t.trim() === etag || t.trim() === "*")) return new Response(null, { status: 304, headers: h });
  return new Response(text, { status: 200, headers: { ...h, "content-type": "application/json" } });
}
