import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { poolMax } from "../db/client";

describe("pool size", () => {
  it("defaults to 10 and is not a hard-coded constant", () => {
    expect(poolMax()).toBe(10);
    const src = readFileSync("db/client.ts", "utf8");
    expect(src).not.toMatch(/POOL_MAX\s*=\s*\d/);
    expect(src.match(/max: poolMax\(\)/g)?.length).toBe(2);
  });
  it("the cluster launcher exists, is wired in package.json and caps workers", () => {
    expect(readFileSync("scripts/start-cluster.mjs", "utf8")).toMatch(/Math\.min\(want, 8\)/);
    expect(JSON.parse(readFileSync("package.json", "utf8")).scripts["start:cluster"]).toBe("node scripts/start-cluster.mjs");
  });
});
