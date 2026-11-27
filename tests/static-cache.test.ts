import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { staticAssetHeaders } from "../core/static-headers";

const original = process.env.NODE_ENV;
afterEach(() => { (process.env as Record<string, string | undefined>).NODE_ENV = original; });
const cache = (h: { key: string; value: string }[]) => h.filter((x) => x.key.toLowerCase() === "cache-control");

describe("/_next/static cache headers", () => {
  it("production: exactly public, max-age=31536000, immutable (names are content-hashed)", () => {
    const h = staticAssetHeaders("production");
    expect(cache(h)).toEqual([{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }]);
    expect(h).toContainEqual({ key: "X-Content-Type-Options", value: "nosniff" });
  });
  it("development: no Cache-Control entry (Next's no-store applies), nosniff stays", () => {
    const h = staticAssetHeaders("development");
    expect(cache(h)).toEqual([]);
    expect(h).toContainEqual({ key: "X-Content-Type-Options", value: "nosniff" });
  });
  it("test and unset environments are treated as not production", () => {
    expect(cache(staticAssetHeaders("test"))).toEqual([]);
    expect(cache(staticAssetHeaders(undefined))).toEqual([]);
  });
});

describe("next.config.ts wiring", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../next.config.ts"), "utf8");
  it("applies staticAssetHeaders to /_next/static/:path* with the current NODE_ENV", () => {
    expect(src).toMatch(/from "\.\/core\/static-headers"/);
    expect(src).toMatch(/source:\s*"\/_next\/static\/:path\*",\s*headers:\s*staticAssetHeaders\(process\.env\.NODE_ENV\)/);
  });
  it("builds with a tsconfig that excludes tests, e2e and scripts, while typecheck covers everything", () => {
    expect(src).toMatch(/tsconfigPath:\s*"tsconfig\.build\.json"/);
    const build = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../tsconfig.build.json"), "utf8")) as { extends: string; exclude: string[] };
    expect(build.extends).toBe("./tsconfig.json");
    for (const d of ["tests", "e2e", "scripts"]) expect(build.exclude).toContain(d);
    const base = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../tsconfig.json"), "utf8")) as { exclude?: string[] };
    expect(base.exclude ?? []).not.toContain("tests");
  });
});
