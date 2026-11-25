import { describe, expect, it } from "vitest";
import { outcomeMark } from "../app/components/TraceTable";
import type { TraceRow } from "../app/lib/types";

const row = (seq: number, stage: string, outcome: string, payload: unknown = {}): TraceRow => ({ seq, stage, model: null, tokens_in: 0, tokens_out: 0, cost_micro_usd: 0, latency_ms: 1, outcome, payload, created_at: "" });

describe("trace outcome marks", () => {
  const first = row(6, "draft", "rejected:evidence", { attempt: 1 }), second = row(7, "draft", "accepted", { attempt: 2 });
  const events = [first, second];
  it("shows a caught first attempt in the review colour with the word 'retried', and the second as accepted after retry", () => {
    expect(outcomeMark(first, events)).toEqual({ status: "review", word: "rejected: evidence, retried" });
    expect(outcomeMark(second, events)).toEqual({ status: "ready", word: "accepted after retry" });
  });
  it("a rejection with no second attempt is not called retried", () => {
    expect(outcomeMark(first, [first]).word).toBe("rejected: evidence");
  });
  it("failures are escalate-coloured, ok is ready, and unknown outcomes stay neutral", () => {
    expect(outcomeMark(row(3, "triage", "failed:timeout"), []).status).toBe("escalate");
    expect(outcomeMark(row(3, "triage", "ok"), [])).toEqual({ status: "ready", word: "ok" });
    expect(outcomeMark(row(8, "route", "needs_review"), [])).toEqual({ status: "none", word: "needs review" });
  });
});
