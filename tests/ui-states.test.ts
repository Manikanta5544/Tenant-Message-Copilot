import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RunStatus from "../app/components/RunStatus";
import { Dot } from "../app/components/ui/Dot";
import { Icon } from "../app/components/ui/Icon";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("saved versus live loading state", () => {
  it("a stored run shows only a skeleton: no stepper and no 'saved draft' copy", () => {
    const out = html(h(RunStatus, { state: { status: "loading", live: false }, onGenerate: () => {} }));
    expect(out).not.toMatch(/Read the message|Gather evidence|Decide the route|Progress/);
    expect(out).not.toMatch(/saved draft|Working|Reading the lease/i);
    expect(out).toContain('aria-busy="true"');
  });
  it("a live run shows the progress text and the four steps", () => {
    const out = html(h(RunStatus, { state: { status: "loading", live: true, label: "Working… 1 steps done", steps: ["triage"] }, onGenerate: () => {} }));
    for (const s of ["Read the message", "Gather evidence", "Draft and verify", "Decide the route"]) expect(out).toContain(s);
    expect(out).toContain("Working… 1 steps done");
  });
});

describe("no SVG that an extension could rewrite", () => {
  it("status dots are CSS shapes with the state word for assistive technology", () => {
    for (const status of ["ready", "review", "escalate", "none"] as const) {
      const out = html(h(Dot, { status }));
      expect(out).not.toContain("<svg");
      expect(out).toContain(`data-dot="${status}"`);
      expect(out).toContain("sr-only");
    }
  });
  it("icons are masked boxes, not <svg>", () => {
    const out = html(h(Icon, { name: "check" }));
    expect(out).not.toContain("<svg");
    expect(out).toContain("mask-image");
  });
});
