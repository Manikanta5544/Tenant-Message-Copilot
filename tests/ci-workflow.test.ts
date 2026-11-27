import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const root = path.resolve(__dirname, "..");
const dir = path.join(root, ".github/workflows");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
const files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));

interface Step { name?: string; run?: string; uses?: string; if?: string }
interface Job { "timeout-minutes"?: number; steps?: Step[] }
const load = (f: string) => parse(fs.readFileSync(path.join(dir, f), "utf8"), { strict: true, uniqueKeys: true }) as { jobs?: Record<string, Job> };
const runLines = (j: Job) => (j.steps ?? []).flatMap((s) => (s.run ?? "").split("\n"));

describe("GitHub workflows", () => {
  it("there is at least one workflow", () => expect(files.length).toBeGreaterThan(0));
  for (const f of files) {
    describe(f, () => {
      it("is valid YAML (strict, no duplicate keys) with at least one job", () => {
        const w = load(f);
        expect(Object.keys(w.jobs ?? {}).length).toBeGreaterThan(0);
      });
      it("every job has timeout-minutes > 0", () => {
        for (const [name, j] of Object.entries(load(f).jobs ?? {})) expect(j["timeout-minutes"], `${f}: job ${name}`).toBeGreaterThan(0);
      });
      it("every `npm run X` names a script in package.json", () => {
        for (const j of Object.values(load(f).jobs ?? {})) for (const l of runLines(j)) for (const m of l.matchAll(/npm run ([\w:.-]+)/g)) expect(pkg.scripts[m[1]!], `${f}: npm run ${m[1]}`).toBeTruthy();
      });
      it("every `node scripts/...` or `node e2e/...` file exists", () => {
        for (const j of Object.values(load(f).jobs ?? {})) for (const l of runLines(j)) for (const m of l.matchAll(/node ((?:scripts|e2e)\/[\w./-]+)/g)) expect(fs.existsSync(path.join(root, m[1]!)), `${f}: ${m[1]}`).toBe(true);
      });
      it("downloads no tool on the fly with npx (only `npx playwright install`)", () => {
        for (const j of Object.values(load(f).jobs ?? {})) for (const l of runLines(j)) for (const m of l.matchAll(/npx\s+(?:-\w+\s+)*([\w@/.-]+)\s*(\w*)/g)) {
          const ok = m[1] === "playwright" && m[2] === "install";
          expect(ok, `${f}: "${l.trim()}"`).toBe(true);
        }
      });
    });
  }
});

describe("ci.yml hardening", () => {
  const raw = fs.readFileSync(path.join(dir, "ci.yml"), "utf8");
  const w = parse(raw) as { permissions?: Record<string, string>; concurrency?: { "cancel-in-progress"?: boolean }; jobs: Record<string, Job & { if?: string; steps: (Step & { if?: string })[] }> };
  const uses = [...raw.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]!);
  it("every action is pinned to a full commit SHA (no floating tags)", () => {
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u, u).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  });
  it("checkout and setup-node are on a major that runs on Node 24 (v7), Node comes only from .nvmrc", () => {
    expect(raw).toMatch(/actions\/checkout@[0-9a-f]{40} # v7/);
    expect(raw).toMatch(/actions\/setup-node@[0-9a-f]{40} # v7/);
    expect(raw).not.toMatch(/node-version:\s*["']?\d/);
    expect(raw).toContain("node-version-file: .nvmrc");
  });
  it("read-only token, cancel-in-progress concurrency, npm ci", () => {
    expect(w.permissions).toEqual({ contents: "read" });
    expect(w.concurrency?.["cancel-in-progress"]).toBe(true);
    expect(raw).not.toMatch(/npm install\b/);
  });
  it("no job control or bash-only server handling (nohup, trailing &) so Windows behaves like Linux", () => {
    expect(raw).not.toMatch(/nohup/);
    for (const l of raw.split("\n")) expect(l, l).not.toMatch(/\s&\s*$/);
  });
  it("verify runs e2e in production mode, asserts the mode line, and runs the axe check", () => {
    const run = w.jobs.verify!.steps.map((s) => s.run ?? "").join("\n");
    expect(raw).toContain('E2E_PRODUCTION: "1"');
    expect(run).toContain("grep -q '^mode: production' e2e.log");
    expect(run).toContain("npm run e2e:a11y");
  });
  it("verify and windows-layout upload the server log on failure", () => {
    for (const j of ["verify", "windows-layout"]) {
      const st = w.jobs[j]!.steps.find((s) => s.uses?.includes("upload-artifact"));
      expect(st?.if, j).toBe("failure()");
    }
  });
  it("live-eval and verify-neon run only on workflow_dispatch", () => {
    for (const j of ["live-eval", "verify-neon"]) expect(w.jobs[j]!.if, j).toBe("github.event_name == 'workflow_dispatch'");
  });
  it("the required jobs exist: audit, verify, windows-layout", () => {
    for (const j of ["audit", "verify", "windows-layout"]) expect(w.jobs[j]).toBeDefined();
  });
  it("Dependabot watches github-actions and npm; .gitattributes forces LF", () => {
    const d = fs.readFileSync(path.join(root, ".github/dependabot.yml"), "utf8");
    expect(d).toMatch(/github-actions/); expect(d).toMatch(/npm/);
    expect(fs.readFileSync(path.join(root, ".gitattributes"), "utf8")).toMatch(/eol=lf/);
  });
});

