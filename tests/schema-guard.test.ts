import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { fail } from "../app/server/http";
import { reportBaselines, seedBaselines, countMissingBaselines } from "../db/baselines";
import { appUrl, closeAllPools, ensureSchema } from "../db/client";
import { uid } from "../db/ids";
import { MIGRATIONS } from "../db/manifest";
import { migrate } from "../db/migrate";
import { seed } from "../db/seed";
import { startRun } from "../db/runs";
import { MockProvider } from "../core/providers/mock";
import { ProviderError, type LLMProvider } from "../core/provider";
import { SchemaOutOfDateError, createSchemaGuard, missingMigrations } from "../core/schema-version";
import { logError, safeErrorMessage } from "../core/log";
import { readProblem } from "../app/lib/problem";
import { APP_URL, HAS_DB, OWNER_URL } from "./helpers";

describe("schema version (pure)", () => {
  it("lists exactly the migrations the database lacks", () => {
    expect(missingMigrations(MIGRATIONS.slice(0, 6), MIGRATIONS)).toEqual(["0007_review_actions.sql", "0008_visitor_run_selection.sql", "0009_single_flight.sql"]);
    expect(missingMigrations(MIGRATIONS, MIGRATIONS)).toEqual([]);
  });
  it("a failed check is not cached; a passing one is", async () => {
    let applied: string[] = MIGRATIONS.slice(0, 6);
    const read = vi.fn(async () => applied);
    const g = createSchemaGuard(read, MIGRATIONS);
    await expect(g.ensure()).rejects.toBeInstanceOf(SchemaOutOfDateError);
    applied = [...MIGRATIONS];
    await g.ensure();            // recovers without a restart
    await g.ensure();
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe("fail(): stale schema and unexpected errors", () => {
  it("schema_out_of_date is a 503 with the exact hint, in every environment", async () => {
    const res = fail(new SchemaOutOfDateError(["0007_review_actions.sql"]));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "schema_out_of_date", hint: "Run: npm run migrate && npm run seed", missing: ["0007_review_actions.sql"] });
  });
  it("a raw postgres undefined-table error (42P01) maps to the same 503", async () => {
    const res = fail(Object.assign(new Error('relation "review_actions" does not exist'), { code: "42P01" }));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("schema_out_of_date");
  });
  it("an unexpected error is a 500 with a reference id that matches the log line, and no secrets in the log", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((s: unknown) => { lines.push(String(s)); });
    const res = fail(Object.assign(new Error("boom postgres://u:pw@h/db key gsk_abcdefghijkl Bearer abc.def"), { code: "XX000" }), new Request("http://x/api/runs/1"));
    spy.mockRestore();
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.correlation_id).toMatch(/^[0-9a-f]{8}$/);
    const log = JSON.parse(lines.find((l) => l.includes(body.correlation_id))!);
    expect(log).toMatchObject({ correlation_id: body.correlation_id, route: "/api/runs/1", error_name: "Error", pg_code: "XX000" });
    expect(lines.join("\n")).not.toMatch(/pw@|gsk_abcdefghijkl|abc\.def/);
  });
  it("safeErrorMessage redacts and caps", () => {
    expect(safeErrorMessage(new Error("x".repeat(500))).length).toBe(300);
    expect(safeErrorMessage("postgresql://a:b@c/d")).toBe("postgres://[redacted]");
    const out: string[] = []; logError({ correlation_id: "a", route: "/r", error_name: "E", message: "m" }, (s) => out.push(s));
    expect(JSON.parse(out[0]!)).toMatchObject({ level: "error", correlation_id: "a" });
  });
});

describe("UI: reading an API problem (mocked 503 schema_out_of_date)", () => {
  it("surfaces the hint and the reference id, not just a generic message", async () => {
    const res = new Response(JSON.stringify({ error: "The database schema is out of date.", code: "schema_out_of_date", hint: "Run: npm run migrate && npm run seed" }), { status: 503 });
    expect(await readProblem(res, "fallback")).toEqual({ status: 503, message: "The database schema is out of date.", code: "schema_out_of_date", hint: "Run: npm run migrate && npm run seed", reference: undefined });
    const r2 = await readProblem(new Response(JSON.stringify({ error: "internal error", correlation_id: "abc12345" }), { status: 500 }), "x");
    expect(r2.reference).toBe("abc12345");
    expect((await readProblem(new Response("<html>", { status: 502 }), "fallback")).message).toBe("fallback");
  });
});

// The owner's failure: a database at 0006 with new code. Built on a scratch copy so the shared test database is untouched.
describe.skipIf(!HAS_DB)("upgrade path: DB at 0006 -> new code -> migrate + seed", () => {
  const dbName = `copilot_up_${randomUUID().slice(0, 8)}`;
  const swap = (u: string) => { const x = new URL(u); x.pathname = `/${dbName}`; return x.toString(); };
  let ownerU = "", appU = "", canCreate = true;
  const saved = { app: process.env.DATABASE_URL_APP, owner: process.env.DATABASE_URL_OWNER };

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: OWNER_URL }); await admin.connect();
    try { await admin.query(`CREATE DATABASE ${dbName}`); } catch { canCreate = false; } finally { await admin.end(); }
    if (!canCreate) return;
    ownerU = swap(OWNER_URL!); appU = swap(APP_URL!);
    const c = new pg.Client({ connectionString: ownerU }); await c.connect();
    const dir = path.join(import.meta.dirname, "..", "db", "migrations");
    await c.query("CREATE TABLE schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    for (const f of MIGRATIONS.slice(0, 6)) { await c.query(fs.readFileSync(path.join(dir, f), "utf8")); await c.query("INSERT INTO schema_migrations(version) VALUES ($1)", [f]); }
    await c.query("GRANT SELECT ON schema_migrations TO copilot_app");
    await c.end();
    process.env.DATABASE_URL_APP = appU; process.env.DATABASE_URL_OWNER = ownerU;
    process.env.DEMO_AS_OF_DATE = "2026-11-19"; process.env.DEMO_DAILY_BUDGET_USD = "50";
  });
  afterAll(async () => {
    await closeAllPools();
    process.env.DATABASE_URL_APP = saved.app; process.env.DATABASE_URL_OWNER = saved.owner;
    // Best-effort cleanup: the app role's pooled connections may take a moment to close, and an owner cannot terminate another role's
    // sessions, so retry a plain DROP (not FORCE) instead of failing the suite on teardown.
    const admin = new pg.Client({ connectionString: OWNER_URL }); await admin.connect();
    for (let i = 0; i < 20; i++) {
      try { await admin.query(`DROP DATABASE IF EXISTS ${dbName}`); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
    }
    await admin.end();
  });

  it("schema behind: the inbox and a run read answer 503 with the hint (not an opaque 500)", async (ctx) => {
    if (!canCreate) return ctx.skip();
    await expect(ensureSchema(appUrl())).rejects.toBeInstanceOf(SchemaOutOfDateError);
    const { GET: inbox } = await import("../app/api/inbox/route");
    const r1 = await inbox(new Request("http://x/api/inbox"));
    expect(r1.status).toBe(503);
    expect(await r1.json()).toMatchObject({ code: "schema_out_of_date", hint: "Run: npm run migrate && npm run seed" });
    const { GET: runGet } = await import("../app/api/runs/[id]/route");
    const r2 = await runGet(new Request("http://x/api/runs/x"), { params: Promise.resolve({ id: randomUUID() }) });
    expect(r2.status).toBe(503);
  });

  it("after migrate: the schema guard passes without a restart, and with no baselines the inbox reports setup", async (ctx) => {
    if (!canCreate) return ctx.skip();
    expect((await migrate(ownerU)).sort()).toEqual(["0007_review_actions.sql", "0008_visitor_run_selection.sql", "0009_single_flight.sql"]);
    await seed(ownerU);
    await ensureSchema(appUrl());
    expect(await countMissingBaselines()).toBe(5);
    const { GET: inbox } = await import("../app/api/inbox/route");
    const j = await (await inbox(new Request("http://x/api/inbox"))).json();
    expect(j.setup).toEqual({ baselines_missing: 5, dev: true });
  });

  it("a failing provider: seed creates no baselines, reports each failure and exits non-zero; a fallback run is never kept", async (ctx) => {
    if (!canCreate) return ctx.skip();
    const down: LLMProvider = { ...new MockProvider(),
      classify: async () => { throw new ProviderError("unavailable", "down"); }, draft: async () => { throw new ProviderError("unavailable", "down"); },
      check: async () => { throw new ProviderError("unavailable", "down"); }, adjudicate: async () => { throw new ProviderError("unavailable", "down"); } } as unknown as LLMProvider;
    const lines: string[] = [];
    const r = await seedBaselines(down, (s) => lines.push(s));
    expect(r.created).toBe(0);
    expect(r.failed).toHaveLength(5);
    expect(await countMissingBaselines()).toBe(5);           // fallback runs exist but do not count as baselines
    const out: string[] = [];
    expect(reportBaselines(r, (s) => out.push(s))).toBe(1);
    expect(out.join("\n")).toMatch(/NOT created/i);
  });

  it("re-running seed with a working provider replaces the fallback baselines; then the setup field disappears", async (ctx) => {
    if (!canCreate) return ctx.skip();
    const r = await seedBaselines(new MockProvider());
    expect(r.failed).toEqual([]);
    expect(r.created).toBe(5);
    expect(await countMissingBaselines()).toBe(0);
    expect(reportBaselines(r, () => {})).toBe(0);
    const { GET: inbox } = await import("../app/api/inbox/route");
    const j = await (await inbox(new Request("http://x/api/inbox"))).json();
    expect(j.setup).toBeUndefined();
    expect(j.messages.filter((m: { run: unknown }) => m.run).length).toBeGreaterThanOrEqual(5);
    void uid; void startRun;
  });
});
