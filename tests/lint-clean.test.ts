import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// The project linter must pass wherever the tests run. It matches rules on forward-slash paths; on Windows a path built with path.join()
// has backslashes, every exemption (core/env.ts, scripts/, evals/) missed, and `npm run lint` reported 9 false problems.
describe("npm run lint", () => {
  it("finds no problems in the repository on this platform", () => {
    const r = spawnSync(process.execPath, ["scripts/lint.mjs"], { encoding: "utf8" });
    expect(r.stderr + r.stdout).toMatch(/lint: ok/);
    expect(r.status).toBe(0);
  });
});
