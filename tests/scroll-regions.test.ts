import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Table } from "../app/components/ui/Table";

const root = path.resolve(__dirname, "..", "app");
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".tsx") ? [path.join(d, e.name)] : []);

describe("horizontally scrollable regions are keyboard operable (WCAG 2.1.1)", () => {
  it("every element that scrolls sideways has tabIndex 0, role=region and an accessible name", () => {
    const bad: string[] = [];
    let seen = 0;
    for (const f of walk(root)) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/<(\w+)\b[^<>]*?overflow-x-(?:auto|scroll)[^<>]*?>/g)) {
        seen++;
        const tag = m[0];
        if (!(/tabIndex=\{0\}/.test(tag) && /role="region"/.test(tag) && /aria-label=/.test(tag))) bad.push(`${path.relative(root, f)}: ${tag.slice(0, 80)}`);
      }
    }
    expect(seen).toBeGreaterThanOrEqual(5);
    expect(bad).toEqual([]);
  });
  it("Table names its region after its caption", () => {
    const out = renderToStaticMarkup(h(Table, { caption: "Ledger lines", minWidth: 500, children: h("tbody") }));
    expect(out).toMatch(/<div[^>]*role="region"[^>]*aria-label="Ledger lines"[^>]*tabindex="0"|<div[^>]*tabindex="0"[^>]*role="region"[^>]*aria-label="Ledger lines"/);
  });
});
