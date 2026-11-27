import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { FIXTURE_FILE } from "../evals/run";

// Without a recording, `npm run eval:replay` must say NOT RUN and exit 0: never a fake pass, never a CI failure.
describe.skipIf(fs.existsSync(FIXTURE_FILE))("eval:replay with no recording", () => {
  it("prints NOT RUN and exits 0", () => {
    const r = spawnSync("npx", ["tsx", "evals/run.ts", "--mode", "replay"], { encoding: "utf8", env: { ...process.env, DATABASE_URL_APP: process.env.TEST_DATABASE_URL_APP ?? "postgres://x:x@127.0.0.1:1/x", DATABASE_URL_OWNER: process.env.TEST_DATABASE_URL_OWNER ?? "postgres://x:x@127.0.0.1:1/x" }, shell: process.platform === "win32" });
    expect(r.stdout).toMatch(/^NOT RUN: replay found no recording/m);
    expect(r.status).toBe(0);
  });
});
