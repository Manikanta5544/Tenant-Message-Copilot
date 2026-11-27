import { getEnv } from "@/core/env";
// Runtime database access. Every query runs inside a transaction whose first statement sets the
// transaction-local scope (set_config(..., true)), so it works on Neon's transaction pooler.
// Neon hosts use @neondatabase/serverless (Pool over WebSocket); any other host (local Postgres, CI)
// uses node-postgres. The SQL path is identical.
import pg from "pg";
import { createSchemaGuard } from "@/core/schema-version";
import { ConfigMissingError, DbUnavailableError, asDbUnavailable } from "@/core/db-errors";
import { MIGRATIONS } from "./manifest";

export type Queryable = {
  query<R extends pg.QueryResultRow = any>(text: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }>;
};

export type Scope = {
  orgId: string | null;
  residentId?: string | null;
  /** 'inbox' grants read-only, organisation-wide access to the four inbox tables. Server code only. */
  view?: "inbox" | null;
};

type PoolLike = { connect(): Promise<ClientLike>; end(): Promise<void> };
type ClientLike = Queryable & { release(err?: boolean | Error): void };

/** Small on purpose: a serverless or pooled Postgres has few connections to give, and every query here is a short indexed lookup (see docs/PERF.md).
 *  Idle clients are released after 10 s so a quiet instance holds none; a statement that runs over 8 s is cancelled by the server. */
export const poolMax = () => getEnv().DB_POOL_MAX;
export const IDLE_MS = 10_000, STATEMENT_MS = 8_000;
/** Client-side deadline, a little longer than the server's statement_timeout. statement_timeout only works while the server can be reached: on a
 *  half-dead connection (a laptop that slept, a pooler that dropped the socket) a query would otherwise wait for the OS TCP timeout, about two minutes. */
export const QUERY_TIMEOUT_MS = STATEMENT_MS + 2_000;
const waits: number[] = [];
/** How long callers waited for a pooled connection (last 500), for /system and the load test. */
export function poolWaitStats() {
  const w = [...waits].sort((a, b) => a - b);
  return { samples: w.length, p50_ms: w.length ? w[Math.floor(w.length * 0.5)]! : 0, p95_ms: w.length ? w[Math.min(w.length - 1, Math.floor(w.length * 0.95))]! : 0, max_ms: w.length ? w[w.length - 1]! : 0 };
}

const pools = new Map<string, Promise<PoolLike>>();

async function makePool(url: string): Promise<PoolLike> {
  const host = new URL(url).hostname;
  if (host.endsWith(".neon.tech")) {
    const neon = await import("@neondatabase/serverless");
    const ws = (await import("ws")).default;
    neon.neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
    const np = new neon.Pool({ connectionString: url, max: poolMax(), idleTimeoutMillis: IDLE_MS, statement_timeout: STATEMENT_MS, query_timeout: QUERY_TIMEOUT_MS, connectionTimeoutMillis: 5000 });
    np.on("error", (err: Error) => console.error("[db] idle client error", err.name));
    return np as unknown as PoolLike;
  }
  // Fail fast when the host is unreachable (default is to wait forever).
  const pool = new pg.Pool({ connectionString: url, max: poolMax(), idleTimeoutMillis: IDLE_MS, statement_timeout: STATEMENT_MS, query_timeout: QUERY_TIMEOUT_MS, keepAlive: true, keepAliveInitialDelayMillis: 10_000, connectionTimeoutMillis: 5000 });
  // An idle client can error (server restart, Neon scale-to-zero). Unhandled, that event would crash the function instance.
  pool.on("error", (err) => console.error("[db] idle client error", err.name));
  return pool as unknown as PoolLike;
}

export function getPool(url: string): Promise<PoolLike> {
  let p = pools.get(url);
  if (!p) { p = makePool(url); pools.set(url, p); }
  return p;
}

/** Connects a client; a connection or login failure becomes DbUnavailableError (classified, host and port only, no credentials). */
export async function connectClient(url: string): Promise<ClientLike> {
  const t0 = performance.now();
  try { const c = await (await getPool(url)).connect(); waits.push(performance.now() - t0); if (waits.length > 500) waits.shift(); return c; }
  catch (e) {
    const mapped = asDbUnavailable(e, url);
    if (mapped instanceof DbUnavailableError) console.error(JSON.stringify({ level: "error", msg: "database connection failed", kind: mapped.kind, host: mapped.host, port: mapped.port }));
    throw mapped;
  }
}

export async function closeAllPools() {
  for (const p of pools.values()) await (await p).end();
  pools.clear();
}

export function appUrl(): string {
  const u = getEnv().DATABASE_URL_APP;
  if (!u) throw new ConfigMissingError(["DATABASE_URL_APP"]);
  return u;
}

const guards = new Map<string, ReturnType<typeof createSchemaGuard>>();
/** Throws SchemaOutOfDateError when the database is behind the code. Cached per database once it passes. */
export function ensureSchema(url: string): Promise<void> {
  let g = guards.get(url);
  if (!g) {
    g = createSchemaGuard(async () => {
      const c = await connectClient(url);
      try {
        return (await c.query<{ version: string }>("SELECT version FROM schema_migrations")).rows.map((r) => r.version);
      } catch (e) {
        if ((e as { code?: string }).code === "42P01") return []; // no migrations table at all: nothing applied
        throw e;
      } finally { c.release(); }
    }, MIGRATIONS);
    guards.set(url, g);
  }
  return g.ensure();
}
export const resetSchemaGuards = () => guards.clear();

/** Runs fn in one transaction with the scope set as its first statement. Always rolls back on error. */
/** A quoted SQL string literal for the scope values (our own ids and view names). Refuses backslashes and NUL instead of trying to escape them. */
export function sqlLiteral(v: string): string {
  if (/[\\\0]/.test(v)) throw new Error("scope value contains a character that cannot be quoted safely");
  return `'${v.replace(/'/g, "''")}'`;
}

/** The organisation-wide inbox view (no resident) is read-only by row level security: every write policy needs a resident scope. */
export const readOnlyScope = (scope: Scope): boolean => scope.view === "inbox" && !scope.residentId;

export async function withScope<T>(url: string, scope: Scope, fn: (db: Queryable) => Promise<T>): Promise<T> {
  await ensureSchema(url);
  const client = await connectClient(url);
  let broken = false, handedOff = false;
  try {
    // BEGIN and the scope settings travel in ONE round trip (simple-query protocol, values escaped by the driver): one fewer network hop on every request.
    const lit = (v: string | null | undefined) => sqlLiteral(v ?? "");
    await client.query(`BEGIN; SELECT set_config('app.org_id', ${lit(scope.orgId)}, true), set_config('app.resident_id', ${lit(scope.residentId)}, true), set_config('app.view', ${lit(scope.view)}, true)`);
    const out = await fn(client);
    if (readOnlyScope(scope)) {
      // Nothing to make durable, so the caller does not wait for COMMIT (one network round trip, 100 to 250 ms to a remote Neon).
      // The connection goes back to the pool only after COMMIT has finished, so the transaction-local scope can never reach another request.
      handedOff = true;
      client.query("COMMIT").then(() => client.release(), () => client.release(true));
      return out;
    }
    await client.query("COMMIT");
    return out;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { broken = true; /* connection already broken: destroy it, do not return it to the pool */ }
    throw e;
  } finally {
    if (!handedOff) client.release(broken);
  }
}
