import { afterEach, describe, expect, it } from "vitest";
import config from "../next.config";

const original = process.env.NODE_ENV;
afterEach(() => {
  if (original === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = original;
});
const cache = (h: { key: string; value: string }[]) => h.filter((x) => x.key.toLowerCase() === "cache-control");

describe("/_next/static cache headers", () => {
  it("production: exactly public, max-age=31536000, immutable (names are content-hashed)", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    const rules = await config.headers!();
    const h = rules.find((r) => r.source === "/_next/static/:path*")!.headers;
    expect(cache(h)).toEqual([{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }]);
    expect(h).toContainEqual({ key: "X-Content-Type-Options", value: "nosniff" });
  });
  it("development: no Cache-Control entry (Next's no-store applies), nosniff stays", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    const rules = await config.headers!();
    const h = rules.find((r) => r.source === "/_next/static/:path*")!.headers;
    expect(cache(h)).toEqual([]);
    expect(h).toContainEqual({ key: "X-Content-Type-Options", value: "nosniff" });
  });
  it("test and unset environments are treated as not production", async () => {
    process.env.NODE_ENV = "test";
    let rules = await config.headers!();
    let h = rules.find((r) => r.source === "/_next/static/:path*")!.headers;
    expect(cache(h)).toEqual([]);

    delete process.env.NODE_ENV;
    rules = await config.headers!();
    h = rules.find((r) => r.source === "/_next/static/:path*")!.headers;
    expect(cache(h)).toEqual([]);
  });
});
