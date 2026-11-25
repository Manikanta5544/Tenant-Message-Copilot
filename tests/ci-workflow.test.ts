import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const root = path.resolve(__dirname, "..");
const dir = path.join(root, ".github/workflows");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
const files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));

interface Step { name?: string; run?: string; uses?: string }
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
