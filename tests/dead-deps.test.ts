import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// A dependency nobody imports still ships advisories and install time (drizzle-orm and drizzle-kit were exactly that).
const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
/** Tooling that is run by a script, a config file or the framework, never imported by name. */
const TOOLING = new Set(["tsx", "typescript", "postcss", "@tailwindcss/postcss", "tailwindcss", "react-dom"]);
const skipDir = new Set(["node_modules", ".next", ".git", "docs"]);
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (skipDir.has(e.name) ? [] : walk(path.join(d, e.name))) : /\.(ts|tsx|mjs|js|css)$/.test(e.name) ? [path.join(d, e.name)] : []);
const sources = walk(root).map((f) => fs.readFileSync(f, "utf8")).join("\n");

describe("dependencies", () => {
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const name of Object.keys(all)) {
    if (name.startsWith("@types/") || TOOLING.has(name)) continue;
    it(`${name} is referenced by the code`, () => {
      expect(new RegExp(`["'\`/]${name.replace(/[/.]/g, "\\$&")}(["'\`/])`).test(sources), `${name} is in package.json but nothing imports it`).toBe(true);
    });
  }
  it("devDependencies are pinned exactly where the brief requires it", () => {
    expect(pkg.devDependencies.playwright).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.devDependencies.yaml).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it("drizzle is gone", () => { expect(all["drizzle-orm"]).toBeUndefined(); expect(all["drizzle-kit"]).toBeUndefined(); });
});
