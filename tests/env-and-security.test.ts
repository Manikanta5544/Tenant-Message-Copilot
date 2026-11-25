import { describe, expect, it } from "vitest";
import { EnvError, parseEnv, trustsProxy } from "@/core/env";
import { buildCsp, newNonce, staticSecurityHeaders } from "@/core/security";

const GOOD_SALT = "a".repeat(40);
const prod = { NODE_ENV: "production", PROVIDER_MODE: "live", LLM_API_KEY: "k", VISITOR_SALT: GOOD_SALT, DATABASE_URL_APP: "postgres://u:p@h/db" };

describe("D1/D6 environment schema", () => {
  it("production rejects PROVIDER_MODE=mock with the documented error", () => {
    expect(() => parseEnv({ ...prod, PROVIDER_MODE: "mock" })).toThrow(/PROVIDER_MODE=mock is not allowed in production \(decision D1\)/);
  });
  it("production defaults to live and then requires a key", () => {
    const { PROVIDER_MODE: _m, LLM_API_KEY: _k, ...rest } = prod;
    expect(() => parseEnv(rest)).toThrow(/PROVIDER_MODE=live but LLM_API_KEY is not set/);
    expect(parseEnv({ ...rest, LLM_API_KEY: "k" }).PROVIDER_MODE).toBe("live");
  });
  it("production requires a 32+ char visitor salt and rejects known weak values", () => {
    expect(() => parseEnv({ ...prod, VISITOR_SALT: "short" })).toThrow(/VISITOR_SALT/);
    expect(() => parseEnv({ ...prod, VISITOR_SALT: "change-me" })).toThrow(/VISITOR_SALT/);
    expect(() => parseEnv({ ...prod, VISITOR_SALT: undefined })).toThrow(/VISITOR_SALT/);
  });
  it("production requires the app database URL", () => {
    expect(() => parseEnv({ ...prod, DATABASE_URL_APP: undefined })).toThrow(/DATABASE_URL_APP/);
  });
  it("reports every problem at once and accepts a valid production config", () => {
    try { parseEnv({ NODE_ENV: "production", PROVIDER_MODE: "mock" }); throw new Error("should fail"); }
    catch (e) { expect(e).toBeInstanceOf(EnvError); expect((e as EnvError).problems.length).toBeGreaterThanOrEqual(3); }
    expect(parseEnv(prod).PROVIDER_MODE).toBe("live");
  });
  it("local dev may use mock explicitly and treats empty strings as unset", () => {
    expect(parseEnv({ NODE_ENV: "development", PROVIDER_MODE: "mock", LLM_API_KEY: "" }).PROVIDER_MODE).toBe("mock");
    expect(parseEnv({ NODE_ENV: "development" }).PROVIDER_MODE).toBe("replay");
  });
  it("validates types and ranges", () => {
    expect(() => parseEnv({ DEMO_AS_OF_DATE: "19/11/2026" })).toThrow(/DEMO_AS_OF_DATE/);
    expect(() => parseEnv({ DEMO_MAX_RUNS_PER_DAY: "-1" })).toThrow(/DEMO_MAX_RUNS_PER_DAY/);
    expect(() => parseEnv({ DEMO_DAILY_BUDGET_USD: "abc" })).toThrow(/DEMO_DAILY_BUDGET_USD/);
    expect(() => parseEnv({ LLM_PRICES_JSON: "{oops" })).toThrow(/LLM_PRICES_JSON/);
  });
});

describe("rate-limit proxy trust (decision on x-forwarded-for)", () => {
  it("trusts forwarded headers only on Vercel or with TRUST_PROXY=1", () => {
    expect(trustsProxy(parseEnv({ VERCEL: "1" }))).toBe(true);
    expect(trustsProxy(parseEnv({ TRUST_PROXY: "1" }))).toBe(true);
    expect(trustsProxy(parseEnv({}))).toBe(false);
    expect(trustsProxy(parseEnv({ VERCEL: "0" }))).toBe(false);
  });
});

describe("D2 security headers", () => {
  const nonce = newNonce();
  const csp = buildCsp(nonce);
  it("nonce CSP without unsafe-inline for scripts", () => {
    expect(nonce.length).toBeGreaterThanOrEqual(16);
    expect(newNonce()).not.toBe(nonce);
    const script = csp.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(script).toContain(`'nonce-${nonce}'`);
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("unsafe-inline");
    expect(script).not.toContain("unsafe-eval");
  });
  it("carries every required directive", () => {
    for (const d of ["default-src 'self'", "style-src 'self' 'unsafe-inline'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "connect-src 'self'"]) expect(csp).toContain(d);
  });
  it("dev adds eval only in development; production sends HSTS", () => {
    expect(buildCsp(nonce, true)).toContain("'unsafe-eval'");
    expect(staticSecurityHeaders(true)["Strict-Transport-Security"]).toMatch(/max-age=\d+/);
    expect(staticSecurityHeaders(false)["Strict-Transport-Security"]).toBeUndefined();
    const h = staticSecurityHeaders(true);
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Permissions-Policy"]).toContain("camera=()");
  });
});

import { clientKey } from "@/app/server/http";
describe("clientKey trust", () => {
  const req = (xff: string) => new Request("http://x/api", { headers: { "x-forwarded-for": xff } });
  it("ignores a spoofed x-forwarded-for when no trusted proxy is configured", () => {
    expect(clientKey(req("1.2.3.4"), { VERCEL: undefined, TRUST_PROXY: false }).ip).toBe("untrusted");
    expect(clientKey(req("9.9.9.9"), { VERCEL: undefined, TRUST_PROXY: false }).ip).toBe("untrusted");
  });
  it("uses the address the trusted proxy appended (the rightmost entry) behind Vercel or TRUST_PROXY=1", () => {
    expect(clientKey(req("1.2.3.4, 10.0.0.1"), { VERCEL: "1", TRUST_PROXY: false }).ip).toBe("10.0.0.1");
    expect(clientKey(req("5.6.7.8"), { VERCEL: undefined, TRUST_PROXY: true }).ip).toBe("5.6.7.8");
  });
});
