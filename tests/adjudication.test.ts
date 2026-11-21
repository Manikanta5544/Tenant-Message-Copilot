import { afterAll, describe, expect, it } from "vitest";
import { MockProvider } from "../core/providers/mock";
import type { AdjudicationInput, ProviderResult } from "../core/provider";
import { ProviderError } from "../core/provider";
import { closeAllPools } from "../db/client";
import { runMessage } from "../evals/harness";
import { APP_URL, HAS_DB, OWNER_URL } from "./helpers";

type Adj = (i: AdjudicationInput) => ProviderResult<unknown>;
class Judged extends MockProvider {
  constructor(private f: Adj) { super(); }
  async adjudicate(i: AdjudicationInput) { return this.f(i); }
}
const usage = { model: "stub", tokens_in: 1, tokens_out: 1, cost_micro_usd: 0, latency_ms: 1 };
const run = (unit: string, message: string, f: Adj) => runMessage({ appUrl: APP_URL!, ownerUrl: OWNER_URL!, provider: new Judged(f), unit, message, asOf: "2026-11-19" });
const clauseIds = (r: Awaited<ReturnType<typeof run>>) => r.output.bundle.facts.filter((f) => f.kind === "clause").map((f) => f.id);

describe.skipIf(!HAS_DB)("retrieval adjudication", () => {
  afterAll(closeAllPools);

  it("a model that finds no relevant clause forces a holding reply for review", async () => {
    const r = await run("102", "The kitchen tap has been dripping since Monday.", () => ({ value: { relevant_ids: [], conflict: false, sufficient: true }, usage }));
    expect(r.output.route).toBe("needs_review");
    expect(r.output.draft_source).toBe("template");
    expect(r.output.rendered.every((s) => s.type === "text")).toBe(true);
    expect(r.events.some((e) => e.stage === "adjudicate" && e.outcome === "no_relevant_clause")).toBe(true);
  });

  it("conflict=true with two relevant clauses holds for a manager (Vikram)", async () => {
    const r = await run("202", "Can my brother stay with me for 10 nights?", (i) => ({ value: { relevant_ids: i.candidates.map((c) => c.id), conflict: true, sufficient: true }, usage }));
    expect(r.output.flags).toContain("conflicting_clauses");
    expect(r.output.route).toBe("needs_review");
  });

  it("conflict=false removes the false alarm: the same question drafts from the clause the model kept", async () => {
    const r = await run("202", "Can my brother stay with me for 10 nights?", (i) => ({ value: { relevant_ids: [i.candidates[0]!.id], conflict: false, sufficient: true }, usage }));
    expect(r.output.flags).not.toContain("conflicting_clauses");
    expect(clauseIds(r).length).toBe(1);
  });

  it("sufficient=false holds for review", async () => {
    const r = await run("102", "The kitchen tap has been dripping since Monday.", (i) => ({ value: { relevant_ids: i.candidates.map((c) => c.id), conflict: false, sufficient: false }, usage }));
    expect(r.output.flags).toContain("insufficient_evidence");
    expect(r.output.route).toBe("needs_review");
  });

  it("ids the model invents are ignored: it can remove evidence but never add it", async () => {
    const r = await run("102", "The kitchen tap has been dripping since Monday.", (i) => ({ value: { relevant_ids: [...i.candidates.map((c) => c.id), "C99", "F1"], conflict: false, sufficient: true }, usage }));
    const real = r.output.bundle.facts.map((f) => f.id);
    expect(real).not.toContain("C99");
    expect(r.output.route).toBe("draft_ready");
  });

  it("a malformed answer or a provider error fails safe: two different clauses are held for review, one clause proceeds", async () => {
    const bad = await run("202", "Can my brother stay with me for 10 nights?", () => ({ value: { nonsense: true }, usage }));
    expect(bad.output.flags).toContain("conflicting_clauses");
    const down = await run("202", "Can my brother stay with me for 10 nights?", () => { throw new ProviderError("unavailable", "down"); });
    expect(down.output.flags).toContain("conflicting_clauses");
    expect(down.events.some((e) => e.stage === "adjudicate" && String(e.outcome).startsWith("failed"))).toBe(true);
  });

  it("balance questions skip adjudication entirely", async () => {
    const r = await run("101", "What is my outstanding balance?", () => { throw new Error("must not be called"); });
    expect(r.events.some((e) => e.stage === "adjudicate")).toBe(false);
  });
});
