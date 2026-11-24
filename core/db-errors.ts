// Classifies connection and login failures so the app can answer with an actionable message instead of an opaque 500.
// On Windows, Node resolves "localhost" to both ::1 and 127.0.0.1; when both refuse, pg throws an AggregateError whose own
// message is empty and which has no .code, so the real reason sits inside .errors[]. This unwraps that and any `cause` chain.
// Never returns a user name, password or full URL: host and port only.

export type DbErrorKind = "unreachable" | "auth_failed" | "database_missing" | "pool_exhausted" | "tls" | "unknown";
export interface DbErrorInfo { kind: DbErrorKind; hint: string; host?: string; port?: number }

const UNREACHABLE = new Set(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "ECONNRESET", "EAI_AGAIN"]);

type Err = { code?: unknown; message?: unknown; errors?: unknown; cause?: unknown; address?: unknown; port?: unknown; hostname?: unknown; name?: unknown };

/** Every error reachable from e through AggregateError.errors[] and .cause, depth-limited. */
export function unwrapErrors(e: unknown, depth = 4): Err[] {
  const out: Err[] = [];
  const walk = (x: unknown, d: number) => {
    if (!x || typeof x !== "object" || d < 0 || out.length > 32) return;
    const err = x as Err; out.push(err);
    if (Array.isArray(err.errors)) for (const c of err.errors) walk(c, d - 1);
    if (err.cause) walk(err.cause, d - 1);
  };
  walk(e, depth);
  return out;
}

export function hostPortOf(url: string | undefined): { host?: string; port?: number } {
  if (!url) return {};
  try { const u = new URL(url); return { host: u.hostname, port: u.port ? Number(u.port) : 5432 }; } catch { return {}; }
}

const where = (host?: string, port?: number) => (host ? `${host}${port ? `:${port}` : ""}` : "the configured host");

export function hintFor(kind: DbErrorKind, host?: string, port?: number): string {
  switch (kind) {
    case "unreachable": return `Postgres is not running at ${where(host, port)}. Start it (docker compose up -d) or point DATABASE_URL_* at a Neon database.`;
    case "auth_failed": return "The app role cannot log in: run npm run migrate and check APP_ROLE_PASSWORD matches DATABASE_URL_APP. On Neon, DATABASE_URL_OWNER is the direct URL and DATABASE_URL_APP is the pooled URL of the copilot_app role.";
    case "database_missing": return `The database named in the URL does not exist on ${where(host, port)}. Create it (createdb copilot) or fix the database name in DATABASE_URL_*.`;
    case "pool_exhausted": return "The database has no free connections. Wait a moment and retry; on Neon use the pooled URL for DATABASE_URL_APP.";
    case "tls": return "The TLS connection to the database failed. For Neon keep ?sslmode=require in the URL; for local Postgres remove sslmode.";
    default: return "The database connection failed. Run npm run doctor for details.";
  }
}

/** `url` is only used to name host and port in the hint; it is never returned. */
export function classifyDbError(e: unknown, url?: string): DbErrorInfo {
  const chain = unwrapErrors(e);
  const codes = chain.map((x) => (typeof x.code === "string" ? x.code : "")).filter(Boolean);
  const text = chain.map((x) => (typeof x.message === "string" ? x.message : "")).join(" ");
  // Prefer the address in the error (what Node actually tried) over the URL; both are host:port only.
  const sock = chain.find((x) => typeof x.port === "number");
  const fromUrl = hostPortOf(url);
  const host = (typeof sock?.address === "string" && sock.address) || (typeof sock?.hostname === "string" && sock.hostname) || fromUrl.host;
  const port = typeof sock?.port === "number" ? sock.port : fromUrl.port;
  const kind: DbErrorKind =
    codes.some((c) => c === "28P01" || c === "28000") ? "auth_failed"
    : codes.includes("3D000") ? "database_missing"
    : codes.some((c) => c === "53300" || c === "53400") || /too many (clients|connections)|remaining connection slots|timeout exceeded when trying to connect/i.test(text) ? "pool_exhausted"
    : codes.some((c) => UNREACHABLE.has(c)) || /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH/.test(text) ? "unreachable"
    : codes.some((c) => /^(ERR_SSL|SELF_SIGNED|DEPTH_ZERO|UNABLE_TO_VERIFY|CERT_)/.test(c)) || /\bssl\b|tls|certificate/i.test(text) ? "tls"
    // An AggregateError with no codes and no message at all is the dual-stack localhost failure: nothing could connect.
    : chain.some((x) => Array.isArray(x.errors)) && !text.trim() && chain.length === 1 ? "unreachable"
    : "unknown";
  return { kind, hint: hintFor(kind, host, port), host, port };
}

export class DbUnavailableError extends Error {
  readonly host?: string; readonly port?: number; readonly hint: string;
  constructor(public kind: Exclude<DbErrorKind, "unknown" | "tls" | "pool_exhausted"> | "unknown" | "tls" | "pool_exhausted", info: DbErrorInfo) {
    super(`Database ${kind}${info.host ? ` at ${info.host}${info.port ? `:${info.port}` : ""}` : ""}`);
    this.name = "DbUnavailableError"; this.host = info.host; this.port = info.port; this.hint = info.hint;
  }
  /** API code for the 503 body. */
  get code(): "database_unreachable" | "database_auth_failed" | "database_missing" | "database_error" {
    return this.kind === "unreachable" ? "database_unreachable" : this.kind === "auth_failed" ? "database_auth_failed" : this.kind === "database_missing" ? "database_missing" : "database_error";
  }
}

/** Converts a connection-level failure into DbUnavailableError; anything else is returned unchanged. */
export function asDbUnavailable(e: unknown, url?: string): unknown {
  if (e instanceof DbUnavailableError) return e;
  const info = classifyDbError(e, url);
  return info.kind === "unknown" ? e : new DbUnavailableError(info.kind, info);
}

/** A required environment variable is missing. Names only, never values. */
export class ConfigMissingError extends Error {
  readonly hint = "Create .env from .env.example and set DATABASE_URL_OWNER, DATABASE_URL_APP, APP_ROLE_PASSWORD";
  constructor(public missing: string[]) { super(`Missing configuration: ${missing.join(", ")}`); this.name = "ConfigMissingError"; }
}
