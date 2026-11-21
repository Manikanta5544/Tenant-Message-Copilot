import fs from "node:fs";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { ORG_A, ORG_B } from "../db/ids";
import { resolveValue } from "../evals/expectations";
import { CaseFile, type Value } from "../evals/schema";
import { HAS_DB, OWNER_URL } from "./helpers";

const raw = JSON.parse(fs.readFileSync(new URL("../evals/cases/critical.json", import.meta.url), "utf8"));
const parsed = CaseFile.safeParse(raw);

describe("critical golden cases (defined before any prompt exists)", () => {
  it("validate against the case schema", () => {
    expect(parsed.success ? [] : parsed.error.issues.slice(0, 3)).toEqual([]);
  });
  const cases = parsed.success ? parsed.data : [];
  it("has 20 cases: 8 adversarial, 6 partial/duplicate, 6 payment, unique ids", () => {
    expect(cases).toHaveLength(20);
    expect(new Set(cases.map((c) => c.id)).size).toBe(20);
    const n = (cat: string) => cases.filter((c) => c.category === cat).length;
    expect([n("adversarial"), n("partial_duplicate"), n("payment_reconciliation")]).toEqual([8, 6, 6]);
  });
  it("every escalate_only and abstain case requires no facts; every money case requires a balance", () => {
    for (const c of cases) {
      if (c.expect.abstain) expect(c.expect.required_facts, c.id).toEqual([]);
      if (c.category !== "adversarial") expect(c.expect.required_facts.some((f) => f.kind === "balance"), c.id).toBe(true);
    }
  });
  it("covers every required route and language bucket", () => {
    expect(new Set(cases.map((c) => c.expect.route))).toEqual(new Set(["escalate_only", "needs_review"]));
    expect(cases.some((c) => c.expect.language === "Hinglish")).toBe(true);
  });
  it("the Scenario 5 case forbids apartment 302's balance and identity", () => {
    const c = cases.find((x) => x.id === "adv-01")!;
    expect(c.message).toContain("apartment 302");
    expect(c.expect.forbidden.values_paise).toContainEqual({ sql: "balance", unit: "302" });
    expect(c.expect.forbidden.strings).toContain("Sunita");
  });

  it.skipIf(!HAS_DB)("every SQL reference resolves against the seed, and the headline figures are what the spec says", async () => {
    const c = new pg.Client({ connectionString: OWNER_URL });
    await c.connect();
    try {
      const refs: Value[] = cases.flatMap((k) => [...k.expect.required_facts.flatMap((f) => (f.value_paise !== undefined ? [f.value_paise] : [])), ...k.expect.forbidden.values_paise]);
      for (const r of refs) expect(Number.isInteger(await resolveValue(c, r, "2026-11-19", ORG_A)), JSON.stringify(r)).toBe(true);
      expect(await resolveValue(c, { sql: "balance", unit: "101" }, "2026-11-19", ORG_A)).toBe(1200000);
      expect(await resolveValue(c, { sql: "balance", unit: "302" }, "2026-11-19", ORG_A)).toBe(1735000);
      expect(await resolveValue(c, { sql: "balance", unit: "201" }, "2026-11-19", ORG_A)).toBe(1600000);
      expect(await resolveValue(c, { sql: "event_amount", reference: "UPI-A101-5521" }, "2026-11-19", ORG_A)).toBe(800000);
      // Unit 302 exists only in organisation A.
      expect(await resolveValue(c, { sql: "balance", unit: "302" }, "2026-11-19", ORG_B)).toBe(0);
    } finally { await c.end(); }
  });
});
