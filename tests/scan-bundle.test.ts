import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM script
import { scan } from "../scripts/scan-bundle.mjs";

describe("bundle secret scan", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-"));
  it("is clean for ordinary client code", () => {
    fs.writeFileSync(path.join(dir, "a.js"), "console.log('hello')");
    expect(scan(dir, { LLM_API_KEY: "gsk_secretvalue1234567890abcdef" })).toEqual([]);
  });
  it("catches an env secret value (canary) and key-shaped strings", () => {
    fs.writeFileSync(path.join(dir, "b.js"), 'const k="gsk_secretvalue1234567890abcdef"');
    expect(scan(dir, { LLM_API_KEY: "gsk_secretvalue1234567890abcdef" }).join()).toMatch(/LLM_API_KEY/);
    fs.writeFileSync(path.join(dir, "c.js"), 'x="postgres://user:pw@host/db"');
    expect(scan(dir, {}).join()).toMatch(/postgres/);
  });
});
