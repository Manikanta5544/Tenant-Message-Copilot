import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigMissingError, DbUnavailableError } from "../core/db-errors";
import { fail } from "../app/server/http";
import { safe, toProblem } from "../app/lib/safe";

const setEnv = (v: string) => { (process.env as Record<string, string | undefined>).NODE_ENV = v; };
const original = process.env.NODE_ENV;
afterEach(() => { setEnv(original ?? "test"); vi.restoreAllMocks(); });
const dbDown = () => new DbUnavailableError("unreachable", { kind: "unreachable", host: "db.internal.example", port: 6543, hint: "Postgres is not running at db.internal.example:6543. Start it (docker compose up -d)." });

describe("production never discloses the database host, port or setup hint (S2)", () => {
  it("API 503 body in production: no host, port, hint or variable names; the reference id is there", async () => {
    setEnv("production");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = fail(dbDown());
    const text = await r.text();
    expect(r.status).toBe(503);
    expect(text).not.toMatch(/db\.internal\.example|6543|docker compose|Postgres is not running/);
    const b = JSON.parse(text) as Record<string, unknown>;
    expect(b).toMatchObject({ code: "database_unreachable" }); expect(b.correlation_id).toBeTruthy();
    for (const k of ["host", "port", "hint"]) expect(b).not.toHaveProperty(k);
    // ...and the operator still gets them, in the server log only.
    const logged = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toMatch(/db\.internal\.example/); expect(logged).toMatch(/6543/);
  });
  it("API 503 for missing configuration in production names no variable", async () => {
    setEnv("production");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const b = await fail(new ConfigMissingError(["DATABASE_URL_APP"])).json() as Record<string, unknown>;
    expect(JSON.stringify(b)).not.toMatch(/DATABASE_URL_APP/);
    expect(b).not.toHaveProperty("missing"); expect(b).not.toHaveProperty("hint");
  });
  it("toProblem in production carries only code and reference", () => {
    setEnv("production");
    const p = toProblem(dbDown(), "abc123");
    expect(p).toEqual({ code: "database_unreachable", reference: "abc123" });
    expect(toProblem(new ConfigMissingError(["X"]), "r")).toEqual({ code: "config_missing", reference: "r" });
  });
  it("safe() logs the host and port server-side while returning the redacted problem", async () => {
    setEnv("production");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await safe(async () => { throw dbDown(); });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/db\.internal\.example|6543/);
    expect(log.mock.calls.map((c) => String(c[0])).join("")).toMatch(/db\.internal\.example.*6543|6543.*db\.internal\.example/);
  });
  it("development keeps the helpful detail on the developer's own machine", async () => {
    setEnv("development");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const b = await fail(dbDown()).json() as Record<string, unknown>;
    expect(b).toMatchObject({ host: "db.internal.example", port: 6543 }); expect(String(b.hint)).toMatch(/Start it/);
    expect(toProblem(dbDown(), "r")).toMatchObject({ host: "db.internal.example", port: 6543 });
  });
});
