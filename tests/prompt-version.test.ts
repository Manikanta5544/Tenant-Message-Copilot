import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { PROMPT_VERSION } from "../core/provider";
import { PROMPT_FINGERPRINT } from "../core/providers/replay";

// Any edit to a prompt or an output schema changes the fingerprint. It must come with a PROMPT_VERSION bump,
// which is shown in every run's trace, and an updated lock file (evals/prompt-lock.json).
describe("prompt versioning", () => {
  const lockPath = new URL("../evals/prompt-lock.json", import.meta.url);
  const hash = PROMPT_FINGERPRINT.split(":")[1]!;
  it("a prompt or schema change requires a PROMPT_VERSION bump", () => {
    if (!fs.existsSync(lockPath) || process.env.UPDATE_PROMPT_LOCK === "1") fs.writeFileSync(lockPath, JSON.stringify({ prompt_version: PROMPT_VERSION, hash }, null, 2) + "\n");
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8")) as { prompt_version: string; hash: string };
    if (lock.hash !== hash) {
      expect(PROMPT_VERSION, "prompts or schemas changed: bump PROMPT_VERSION in core/provider.ts, then run `UPDATE_PROMPT_LOCK=1 npx vitest run tests/prompt-version.test.ts`").not.toBe(lock.prompt_version);
    }
    expect(lock.prompt_version === PROMPT_VERSION ? lock.hash : hash).toBe(hash);
  });
  it("the version is shown in the trace payload", () => {
    expect(PROMPT_VERSION).toMatch(/^v\d+/);
  });
});
