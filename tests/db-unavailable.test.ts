import fs from "node:fs";
import net from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigMissingError, DbUnavailableError, asDbUnavailable, classifyDbError, hintFor } from "../core/db-errors";
import { fail } from "../app/server/http";
import { PROBLEM_COPY, copyFor } from "../app/lib/problem-copy";
import { safe, toProblem } from "../app/lib/safe";
import { closeAllPools, resetSchemaGuards } from "../db/client";
import { envFileCheck, failureLines, nodeCheck, runChecks } from "../db/diagnostics";

const sysErr = (code: string, extra: object = {}) => Object.assign(new Error(`connect ${code} 127.0.0.1:5432`), { code, ...extra });
const UUID = "00000000-0000-4000-8000-000000000001";

describe("classifyDbError", () => {
  it("the Windows dual-stack failure: an AggregateError with an empty message and no code is 'unreachable'", () => {
    const r = classifyDbError(new AggregateError([], ""), "postgres://u:secret@localhost:5432/copilot");
    expect(r.kind).toBe("unreachable");
    expect(r.hint).toBe("Postgres is not running at localhost:5432. Start it (docker compose up -d) or point DATABASE_URL_* at a Neon database.");
  });
  it("AggregateError([ECONNREFUSED v4, ECONNREFUSED v6]) is unreachable and names the address that was tried", () => {
    const e = new AggregateError([sysErr("ECONNREFUSED", { address: "::1", port: 5432 }), sysErr("ECONNREFUSED", { address: "127.0.0.1", port: 5432 })], "");
    const r = classifyDbError(e, "postgres://u:p@localhost:5432/x");
    expect(r).toMatchObject({ kind: "unreachable", port: 5432 });
  });
  it("28P01 and 28000 are auth_failed; 3D000 is database_missing", () => {
    expect(classifyDbError(Object.assign(new Error('password authentication failed for user "copilot_app"'), { code: "28P01" })).kind).toBe("auth_failed");
    expect(classifyDbError(Object.assign(new Error("x"), { code: "28000" })).kind).toBe("auth_failed");
    expect(classifyDbError(Object.assign(new Error('database "copilot" does not exist'), { code: "3D000" })).kind).toBe("database_missing");
    expect(hintFor("auth_failed")).toMatch(/run npm run migrate and check APP_ROLE_PASSWORD matches DATABASE_URL_APP/);
  });
  it("sees through error.cause wrappers and nested aggregates", () => {
    const inner = sysErr("ETIMEDOUT");
    expect(classifyDbError(new Error("wrapped", { cause: new Error("again", { cause: inner }) })).kind).toBe("unreachable");
    expect(classifyDbError(new AggregateError([new AggregateError([sysErr("ENOTFOUND")], "")], "")).kind).toBe("unreachable");
  });
  it("classifies pool exhaustion and TLS; a plain Error is unknown", () => {
    expect(classifyDbError(Object.assign(new Error("remaining connection slots are reserved"), { code: "53300" })).kind).toBe("pool_exhausted");
    expect(classifyDbError(new Error("self-signed certificate in certificate chain"), undefined).kind).toBe("tls");
    expect(classifyDbError(new Error("boom")).kind).toBe("unknown");
  });
  it("never includes a user, password or full URL in the result", () => {
    const r = JSON.stringify(classifyDbError(new AggregateError([], ""), "postgres://copilot_app:hunter2@db.example.com:6543/copilot"));
    expect(r).not.toMatch(/hunter2|copilot_app|postgres:\/\//);
    expect(r).toMatch(/db\.example\.com:6543/);
  });
  it("asDbUnavailable converts connection failures and leaves other errors alone", () => {
    expect(asDbUnavailable(sysErr("ECONNREFUSED"))).toBeInstanceOf(DbUnavailableError);
    const other = new Error("syntax error");
    expect(asDbUnavailable(other)).toBe(other);
  });
});

describe("fail() answers 503 with a code and a hint, never an opaque 500", () => {
  it("database_unreachable", async () => {
    const r = fail(new DbUnavailableError("unreachable", classifyDbError(new AggregateError([], ""), "postgres://u:p@127.0.0.1:5432/x")));
    const b = await r.json();
    expect(r.status).toBe(503);
    expect(b).toMatchObject({ code: "database_unreachable", host: "127.0.0.1", port: 5432 });
    expect(b.hint).toMatch(/not running at 127\.0\.0\.1:5432/);
    expect(b.correlation_id).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.stringify(b)).not.toMatch(/stack|postgres:\/\//);
  });
  it("database_auth_failed and database_missing", async () => {
    expect((await fail(Object.assign(new Error("x"), { code: "28P01" })).json()).code).toBe("database_auth_failed");
    expect((await fail(Object.assign(new Error("x"), { code: "3D000" })).json()).code).toBe("database_missing");
  });
  it("an unclassified raw ECONNREFUSED that reaches fail() is still mapped", async () => {
    const r = fail(sysErr("ECONNREFUSED"));
    expect(r.status).toBe(503);
    expect((await r.json()).code).toBe("database_unreachable");
  });
  it("config_missing names the variable and no values", async () => {
    const r = fail(new ConfigMissingError(["DATABASE_URL_APP"]));
    const b = await r.json();
    expect(r.status).toBe(503);
    expect(b).toMatchObject({ code: "config_missing", missing: ["DATABASE_URL_APP"] });
    expect(b.hint).toBe("Create .env from .env.example and set DATABASE_URL_OWNER, DATABASE_URL_APP, APP_ROLE_PASSWORD");
  });
  it("429 responses carry a code the UI has copy for", async () => {
    const { HttpError } = await import("../db/runs");
    expect((await fail(new HttpError(429, "rate limit reached for this demo", { retry_after_s: 600 })).json()).code).toBe("rate_limited");
    expect((await fail(new HttpError(429, "the demo's daily run limit is reached; try again tomorrow (UTC)", { retry_after_s: 3600 })).json()).code).toBe("budget_exhausted");
  });
});

describe("every code the API can return has user-facing copy", () => {
  it("covers each code literal emitted by fail(), DbUnavailableError and the 429 mapping", () => {
    const src = ["app/server/http.ts", "core/db-errors.ts", "app/lib/safe.ts"].map((f) => fs.readFileSync(f, "utf8")).join("\n");
    const codes = new Set([...src.matchAll(/code: ?"([a-z_]+)"/g), ...src.matchAll(/"(database_[a-z_]+|rate_limited|budget_exhausted)"/g)].map((m) => m[1]!));
    for (const c of ["config_missing", "schema_out_of_date", "maintenance", "database_unreachable", "database_auth_failed", "database_missing", "database_error", "rate_limited", "budget_exhausted", "provider_unavailable", "unexpected"]) codes.add(c);
    for (const c of codes) { expect(PROBLEM_COPY[c], `copy for ${c}`).toBeTruthy(); const p = PROBLEM_COPY[c]!; expect(p.title && p.what && p.todo).toBeTruthy(); }
    expect(copyFor("nonsense").title).toBe("Something went wrong");
  });
});

describe("every DB route answers 503 (not 500) when Postgres is down or unconfigured", () => {
  const saved = { app: process.env.DATABASE_URL_APP, mode: process.env.PROVIDER_MODE, as: process.env.DEMO_AS_OF_DATE };
  let closedPort = 0;
  beforeEach(async () => {
    // A port that is certainly closed: bind, read the number, release.
    closedPort = await new Promise<number>((res) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); });
    process.env.PROVIDER_MODE = "mock"; process.env.DEMO_AS_OF_DATE = "2026-11-19";
    resetSchemaGuards(); await closeAllPools();
  });
  afterEach(async () => {
    process.env.DATABASE_URL_APP = saved.app; process.env.PROVIDER_MODE = saved.mode; process.env.DEMO_AS_OF_DATE = saved.as;
    if (saved.app === undefined) delete process.env.DATABASE_URL_APP;
    resetSchemaGuards(); await closeAllPools(); vi.restoreAllMocks();
  });

  const post = (path: string, body: object) => new Request(`http://x${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const calls: [string, () => Promise<Response>][] = [
    ["GET /api/inbox", async () => (await import("../app/api/inbox/route")).GET(new Request("http://x/api/inbox"))],
    ["POST /api/messages", async () => (await import("../app/api/messages/route")).POST(post("/api/messages", { resident_id: UUID, text: "hello" }))],
    ["POST /api/runs", async () => (await import("../app/api/runs/route")).POST(post("/api/runs", { message_id: UUID, idempotency_key: UUID }))],
    ["GET /api/runs/:id", async () => (await import("../app/api/runs/[id]/route")).GET(new Request("http://x/api/runs/" + UUID), { params: Promise.resolve({ id: UUID }) })],
    ["POST /api/runs/:id/review", async () => (await import("../app/api/runs/[id]/review/route")).POST(post("/api/runs/x/review", { action: "approved", idempotency_key: UUID }), { params: Promise.resolve({ id: UUID }) })],
  ];

  for (const [name, call] of calls) {
    it(`${name}: database unreachable -> 503 database_unreachable with a hint`, async () => {
      process.env.DATABASE_URL_APP = `postgres://copilot_app:secretpw@127.0.0.1:${closedPort}/copilot`;
      vi.spyOn(console, "error").mockImplementation(() => {});
      const r = await call();
      const b = await r.json();
      expect(r.status).toBe(503);
      expect(b).toMatchObject({ code: "database_unreachable", port: closedPort });
      expect(b.hint).toContain(`127.0.0.1:${closedPort}`);
      expect(JSON.stringify(b)).not.toMatch(/secretpw|copilot_app|postgres:\/\//);
    });
    it(`${name}: DATABASE_URL_APP unset -> 503 config_missing naming the variable, no values`, async () => {
      delete process.env.DATABASE_URL_APP;
      vi.spyOn(console, "error").mockImplementation(() => {});
      const r = await call();
      const b = await r.json();
      expect(r.status).toBe(503);
      expect(b).toMatchObject({ code: "config_missing", missing: ["DATABASE_URL_APP"] });
    });
  }

  it("the /evals server page renders its own error panel instead of throwing to the error boundary", async () => {
    process.env.DATABASE_URL_APP = `postgres://copilot_app:x@127.0.0.1:${closedPort}/copilot`;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { default: EvalsPage } = await import("../app/evals/page");
    const tree = await EvalsPage();                       // must resolve, never reject
    const found: Record<string, unknown>[] = [];
    const walk = (n: unknown) => { if (!n || typeof n !== "object") return; if (Array.isArray(n)) return n.forEach(walk); const el = n as { type?: unknown; props?: Record<string, unknown> }; if (typeof el.type === "function" && (el.type as { name?: string }).name === "ProblemPanel") found.push(el.props!); walk(el.props?.children); };
    walk(tree);
    expect(found).toHaveLength(1);
    expect(found[0]!.problem).toMatchObject({ code: "database_unreachable" });
  });

  it("safe() never throws and returns a problem with a reference", async () => {
    const r = await safe(async () => { throw new AggregateError([], ""); });
    expect(r).toMatchObject({ ok: false, problem: { code: "database_unreachable" } });
    expect(toProblem(new ConfigMissingError(["X"])).code).toBe("config_missing");
    expect((await safe(async () => 5))).toEqual({ ok: true, data: 5 });
  });
});

describe("/setup", () => {
  it("does not exist in production (404) and renders in development", async () => {
    // Import first: React picks its dev or production JSX runtime when it is first loaded, so loading it with NODE_ENV=production would
    // break every later test in this worker that renders a page (jsxDEV is not a function), depending on test order.
    const { default: Setup } = await import("../app/setup/page");
    const prev = process.env.NODE_ENV;
    try {
      (process.env as Record<string, string>).NODE_ENV = "production";
      await expect(Setup()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    } finally { (process.env as Record<string, string>).NODE_ENV = prev!; }
  });
});

describe("diagnostics", () => {
  it("names a .env.txt left by Windows Notepad and gives the rename command for both shells", () => {
    const dir = fs.mkdtempSync("/tmp/diag-"); fs.writeFileSync(`${dir}/.env.txt`, "x"); fs.writeFileSync(`${dir}/.env.example`, "x");
    const c = envFileCheck(dir);
    expect(c.status).toBe("fail");
    expect(c.detail).toMatch(/\.env\.txt.*Notepad/);
    expect(c.fix!.powershell).toBe('Rename-Item ".env.txt" .env');
    fs.rmSync(dir, { recursive: true });
  });
  it("a missing .env with only .env.example says to copy it", () => {
    const dir = fs.mkdtempSync("/tmp/diag-"); fs.writeFileSync(`${dir}/.env.example`, "x");
    expect(envFileCheck(dir).fix!.powershell).toMatch(/Copy-Item \.env\.example \.env/);
    fs.rmSync(dir, { recursive: true });
  });
  it("Node older than 22 is a failure with a fix", () => { expect(nodeCheck("20.11.0").status).toBe("fail"); expect(nodeCheck("22.1.0").status).toBe("ok"); });
  it("with nothing configured every variable is 'not set' and no value is ever printed", async () => {
    const checks = await runChecks({}, { cwd: "/nonexistent" });
    expect(checks.filter((c) => c.id.startsWith("var-")).every((c) => c.status === "fail" && c.detail === "not set")).toBe(true);
    expect(failureLines(checks).join("\n")).toMatch(/DATABASE_URL_APP: not set/);
  });
  it("an unreachable host is reported with host:port and the start command", async () => {
    const checks = await runChecks({ DATABASE_URL_OWNER: "postgres://u:topsecret@127.0.0.1:1/x", DATABASE_URL_APP: "postgres://a:topsecret@127.0.0.1:1/x", APP_ROLE_PASSWORD: "p" }, { cwd: "/nonexistent" });
    const db = checks.find((c) => c.id === "db")!;
    expect(db.status).toBe("fail");
    expect(db.detail).toMatch(/127\.0\.0\.1:1/);
    expect(db.fix!.bash).toBe("docker compose up -d");
    expect(JSON.stringify(checks)).not.toContain("topsecret");
    expect(checks.find((c) => c.id === "migrations")!.status).toBe("skipped");
  });
});
