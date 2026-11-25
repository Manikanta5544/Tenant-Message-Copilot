import { describe, expect, it } from "vitest";
import { clientKey, fail } from "@/app/server/http";
import { HttpError } from "@/db/runs";
import { VISITOR_COOKIE, mintVisitorCookie, readVisitorId, trustedClientIp } from "@/core/visitor";
import { staticSecurityHeaders } from "@/core/security";

const SALT = "s".repeat(40);
const open = { VERCEL: undefined, TRUST_PROXY: false, TRUSTED_PROXY_HOPS: 1, VISITOR_SALT: SALT };
const proxied = { VERCEL: undefined, TRUST_PROXY: true, TRUSTED_PROXY_HOPS: 1, VISITOR_SALT: SALT };
const req = (h: Record<string, string>) => new Request("http://x/api", { headers: h });
const cookie = (v: string) => ({ cookie: `${VISITOR_COOKIE}=${v}` });

describe("visitor cookie", () => {
  it("two visitors with their own cookies do not share a bucket", () => {
    const a = clientKey(req(cookie(mintVisitorCookie(SALT))), open).ip, b = clientKey(req(cookie(mintVisitorCookie(SALT))), open).ip;
    expect(a).not.toBe(b);
    expect(a).toMatch(/^c:/);
  });
  it("the same cookie is the same visitor", () => {
    const c = mintVisitorCookie(SALT);
    expect(clientKey(req(cookie(c)), open).ip).toBe(clientKey(req(cookie(c)), open).ip);
  });
  it("rotating x-forwarded-for without a trusted proxy does not mint buckets", () => {
    const keys = new Set([1, 2, 3, 4, 5].map((i) => clientKey(req({ "x-forwarded-for": `9.9.9.${i}`, "x-real-ip": `8.8.8.${i}` }), open).ip));
    expect([...keys]).toEqual(["untrusted"]);
  });
  it("a forged, truncated or wrongly signed cookie falls back to the shared bucket", () => {
    const good = mintVisitorCookie(SALT), id = good.split(".")[0]!;
    for (const bad of [`${id}.AAAAAAAAAAAAAAAAAAAAAA`, id, "x.y", mintVisitorCookie("other-secret-other-secret-other-secret")]) expect(clientKey(req(cookie(bad)), open).ip).toBe("untrusted");
    expect(readVisitorId(null, SALT)).toBeNull();
  });
});

describe("trusted proxy address", () => {
  it("uses the rightmost entry, not the client-supplied left one", () => {
    expect(clientKey(req({ "x-forwarded-for": "6.6.6.6, 1.2.3.4" }), proxied).ip).toBe("1.2.3.4");
  });
  it("counts TRUSTED_PROXY_HOPS from the right", () => {
    expect(clientKey(req({ "x-forwarded-for": "6.6.6.6, 1.2.3.4, 10.0.0.1" }), { ...proxied, TRUSTED_PROXY_HOPS: 2 }).ip).toBe("1.2.3.4");
  });
  it("prefers x-vercel-forwarded-for on Vercel, then x-real-ip", () => {
    expect(clientKey(req({ "x-vercel-forwarded-for": "2.2.2.2", "x-forwarded-for": "6.6.6.6, 1.2.3.4" }), { ...proxied, VERCEL: "1" }).ip).toBe("2.2.2.2");
    expect(clientKey(req({ "x-real-ip": "3.3.3.3", "x-forwarded-for": "6.6.6.6, 1.2.3.4" }), proxied).ip).toBe("3.3.3.3");
  });
  it("x-vercel-forwarded-for is ignored off Vercel", () => {
    expect(trustedClientIp(new Headers({ "x-vercel-forwarded-for": "2.2.2.2" }), 1, false)).toBeNull();
  });
  it("an invalid address falls back to the visitor cookie, then to the shared bucket", () => {
    const c = mintVisitorCookie(SALT);
    expect(clientKey(req({ "x-forwarded-for": "not-an-ip", ...cookie(c) }), proxied).ip).toMatch(/^c:/);
    expect(clientKey(req({ "x-forwarded-for": "not-an-ip" }), proxied).ip).toBe("untrusted");
    expect(clientKey(req({ "x-forwarded-for": "1.2.3.4, <script>" }), proxied).ip).toBe("untrusted");
  });
});

describe("429 responses", () => {
  it("always carry Retry-After and retry_after_s, with the same problem body", async () => {
    for (const e of [new HttpError(429, "rate limit reached for this demo", { retry_after_s: 600 }), new HttpError(429, "budget gone")]) {
      const r = fail(e);
      const b = await r.json() as { code: string; retry_after_s: number; error: string };
      expect(r.status).toBe(429);
      expect(Number(r.headers.get("retry-after"))).toBe(b.retry_after_s);
      expect(b.retry_after_s).toBeGreaterThan(0);
      expect(b.code).toBe("rate_limited");
    }
  });
});

describe("HSTS", () => {
  it("is max-age 2 years with includeSubDomains, and preload only when opted in", () => {
    expect(staticSecurityHeaders(true)["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains");
    expect(staticSecurityHeaders(true, true)["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains; preload");
    expect(staticSecurityHeaders(false, true)["Strict-Transport-Security"]).toBeUndefined();
  });
});
