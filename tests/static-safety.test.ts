import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { diagramSvg } from "../app/about/diagram";

const root = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
const walk = (d: string): string[] => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : /\.(ts|tsx|mjs)$/.test(e.name) ? [path.join(d, e.name)] : []);

describe("About diagram (set with innerHTML by DiagramMount)", () => {
  const svg = diagramSvg();
  it("is static markup with no script element, event handler or javascript: URL", () => {
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toMatch(/\son\w+\s*=/i);
    expect(svg).not.toMatch(/javascript:/i);
    expect(svg).not.toMatch(/<foreignObject|<iframe|<use[^>]+href\s*=\s*["']https?:/i);
  });
  it("DiagramMount keeps its comment saying the string is static and never user input", () => {
    expect(read("app/components/DiagramMount.tsx")).toMatch(/never user input/);
  });
});

describe("code safety", () => {
  const src = ["app", "core", "db"].flatMap(walk);
  it("no eval, new Function or dangerouslySetInnerHTML outside the nonce'd theme script", () => {
    for (const f of src) {
      const t = read(f).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
      expect(/\beval\s*\(|new Function\s*\(/.test(t), `${f} uses eval or new Function`).toBe(false);
      if (f !== path.join("app", "layout.tsx")) expect(/dangerouslySetInnerHTML/.test(t), `${f} uses dangerouslySetInnerHTML`).toBe(false);
    }
  });
  it("no SQL is built by concatenating values: query text is a literal or a fixed fragment, values go in $n parameters", () => {
    // A template literal passed to query()/execute with a ${...} holding anything but a known fixed fragment would be injection-prone.
    const risky = /\.query(?:<[^>]*>)?\(\s*`[^`]*\$\{(?!\s*(?:RUN_SELECT|USABLE_[A-Z_]+|lit\(|client\.escapeLiteral))[^`]*`/;
    for (const f of ["db", "app", "core"].flatMap(walk)) expect(risky.test(read(f)), `${f} interpolates into SQL`).toBe(false);
  });
});

describe("scope literal quoting (the only interpolated SQL)", () => {
  it("doubles quotes and refuses backslashes and NUL", async () => {
    const { sqlLiteral } = await import("../db/client");
    expect(sqlLiteral("abc")).toBe("'abc'");
    expect(sqlLiteral("o'brien'; DROP TABLE runs; --")).toBe("'o''brien''; DROP TABLE runs; --'");
    expect(() => sqlLiteral("a\\b")).toThrow(); expect(() => sqlLiteral("a\0b")).toThrow();
  });
});
