import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MockProvider } from "../core/providers/mock";
import { PROMPT_FINGERPRINT, keyFor } from "../core/providers/replay";
import { closeAllPools, getPool } from "../db/client";
import { ORG_A, RES } from "../db/ids";
import { startRun } from "../db/runs";
import { APP_URL, HAS_DB } from "./helpers";

describe("replay key", () => {
  it("includes a fingerprint of the prompts and schemas, not only the version label", () => {
    expect(PROMPT_FINGERPRINT).toMatch(/^v\d+:[0-9a-f]{12}$/);
    expect(keyFor("draft", { a: 1 })).toBe(keyFor("draft", { a: 1 }));
    expect(keyFor("draft", { a: 1 })).not.toBe(keyFor("check", { a: 1 }));
  });
});

describe.skipIf(!HAS_DB)("single-statement trace insert still obeys row level security", () => {
  afterAll(closeAllPools);
  it("rejects a trace event whose resident is not the scoped resident", async () => {
    process.env.DATABASE_URL_APP = APP_URL;
    const { runId } = await startRun({ messageId: (await import("../db/ids")).uid("message", 1), idempotencyKey: randomUUID(), provider: new MockProvider(), visitor: null });
    const c = await (await getPool(APP_URL!)).connect();
    const sql = `WITH s AS (SELECT set_config('app.org_id', $1, true), set_config('app.resident_id', $2, true), set_config('app.view', '', true))
      INSERT INTO trace_events (id, organization_id, resident_id, run_id, seq, stage, outcome, payload) SELECT $3,$4,$5,$6,999,'x','x','{}' FROM s`;
    try {
      await expect(c.query(sql, [ORG_A, RES.asha, randomUUID(), ORG_A, RES.ravi, runId])).rejects.toThrow(/row-level security/i);
    } finally { c.release(); }
  });
});
