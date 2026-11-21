// Runtime database access. Every query runs inside a transaction whose first statement sets the
// transaction-local scope (set_config(..., true)), so it works on Neon's transaction pooler.
// Neon hosts use @neondatabase/serverless (Pool over WebSocket); any other host (local Postgres, CI)
// uses node-postgres. The SQL path is identical.
import pg from "pg";

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

const pools = new Map<string, Promise<PoolLike>>();

async function makePool(url: string): Promise<PoolLike> {
  const host = new URL(url).hostname;
  if (host.endsWith(".neon.tech")) {
    const neon = await import("@neondatabase/serverless");
    const ws = (await import("ws")).default;
    neon.neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
    const np = new neon.Pool({ connectionString: url, max: 5 });
    np.on("error", (err: Error) => console.error("[db] idle client error", err.name));
    return np as unknown as PoolLike;
  }
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  // An idle client can error (server restart, Neon scale-to-zero). Unhandled, that event would crash the function instance.
  pool.on("error", (err) => console.error("[db] idle client error", err.name));
  return pool as unknown as PoolLike;
}

export function getPool(url: string): Promise<PoolLike> {
  let p = pools.get(url);
  if (!p) { p = makePool(url); pools.set(url, p); }
  return p;
}

export async function closeAllPools() {
  for (const p of pools.values()) await (await p).end();
  pools.clear();
}

export function appUrl(): string {
  const u = process.env.DATABASE_URL_APP;
  if (!u) throw new Error("DATABASE_URL_APP is not set");
  return u;
}

/** Runs fn in one transaction with the scope set as its first statement. Always rolls back on error. */
export async function withScope<T>(url: string, scope: Scope, fn: (db: Queryable) => Promise<T>): Promise<T> {
  const client = await (await getPool(url)).connect();
  let broken = false;
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('app.org_id', $1, true), set_config('app.resident_id', $2, true), set_config('app.view', $3, true)",
      [scope.orgId ?? "", scope.residentId ?? "", scope.view ?? ""],
    );
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { broken = true; /* connection already broken: destroy it, do not return it to the pool */ }
    throw e;
  } finally {
    client.release(broken);
  }
}
