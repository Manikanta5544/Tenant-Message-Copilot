import { describe, expect, it } from "vitest";
import { doctor } from "../scripts/doctor";
import { APP_URL, HAS_DB, OWNER_URL } from "./helpers";

const modelsOk = (ids: string[]) => (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url);
  if (u.endsWith("/models")) return new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status: 200 });
  const body = JSON.parse(String(init?.body));
  return body.model === "bad/model" ? new Response("no", { status: 404 }) : new Response(JSON.stringify({ usage: { prompt_tokens: 3, completion_tokens: 1 } }), { status: 200 });
}) as unknown as typeof fetch;

describe("doctor", () => {
  it("fails with a fix hint on an invalid production config (mock) and stops", async () => {
    const r = await doctor({ NODE_ENV: "production", PROVIDER_MODE: "mock" });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ name: "env schema", ok: false });
    expect(r[0]!.hint).toMatch(/\.env/);
  });
  it("reports an unreachable database as a failure with a hint", async () => {
    const r = await doctor({ DATABASE_URL_OWNER: "postgres://x:y@127.0.0.1:1/none", DATABASE_URL_APP: "postgres://x:y@127.0.0.1:1/none", PROVIDER_MODE: "replay" });
    expect(r.filter((c) => !c.ok).map((c) => c.name)).toEqual(["database (owner role)", "database (app role)"]);
    expect(r.every((c) => c.ok || c.hint)).toBe(true);
  });
  it.skipIf(!HAS_DB)("passes the database, role and migration checks on a migrated database", async () => {
    const r = await doctor({ DATABASE_URL_OWNER: OWNER_URL, DATABASE_URL_APP: APP_URL, PROVIDER_MODE: "replay" });
    expect(r.filter((c) => !c.ok)).toEqual([]);
    expect(r.map((c) => c.name)).toEqual(expect.arrayContaining(["database (owner role)", "RLS role is non-bypass", "migrations current"]));
  });
  it.skipIf(!HAS_DB)("--deep runs the S0 audit in replay mode too (it used to return before reaching it)", async () => {
    const base = { DATABASE_URL_OWNER: OWNER_URL, DATABASE_URL_APP: APP_URL, PROVIDER_MODE: "replay" };
    expect((await doctor(base)).some((c) => /S0 audit/.test(c.name))).toBe(false);
    const deep = await doctor(base, { deep: true });
    const s0 = deep.find((c) => /S0 audit/.test(c.name));
    expect(s0, "no S0 audit line").toBeDefined();
    expect(s0!.ok).toBe(true);
  });
  it.skipIf(!HAS_DB)("live: flags a configured model the key does not list, and prints billed round trips", async () => {
    const base = { DATABASE_URL_OWNER: OWNER_URL, DATABASE_URL_APP: APP_URL, PROVIDER_MODE: "live", LLM_API_KEY: "k", LLM_MODEL_TRIAGE: "a/x", LLM_MODEL_DRAFT: "a/y", LLM_MODEL_CHECK: "a/x", LLM_PRICES_JSON: JSON.stringify({ "a/x": { in: 1, out: 1 }, "a/y": { in: 1, out: 1 } }) };
    const good = await doctor(base, { fetch: modelsOk(["a/x", "a/y"]) });
    expect(good.filter((c) => !c.ok)).toEqual([]);
    expect(good.find((c) => c.name === "model round trip: draft")!.detail).toMatch(/BILLED: 3 in \/ 1 out/);
    // A model with no price makes doctor fail: the budget could not be enforced.
    const unpriced = await doctor({ ...base, LLM_PRICES_JSON: undefined }, { fetch: modelsOk(["a/x", "a/y"]) });
    expect(unpriced.find((c) => c.name === "model prices")).toMatchObject({ ok: false });
    expect(unpriced.find((c) => c.name === "model prices")?.detail).toMatch(/no price for model a\/x, a\/y: budget cannot be enforced/);
    const miss = await doctor({ ...base, LLM_MODEL_CHECK: "bad/model" }, { fetch: modelsOk(["a/x", "a/y"]) });
    const f = miss.filter((c) => !c.ok).map((c) => c.name);
    expect(f).toContain("model availability");
    expect(f).toContain("model round trip: check");
  });
});
