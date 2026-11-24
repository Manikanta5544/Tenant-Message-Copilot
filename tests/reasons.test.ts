import { describe, expect, it } from "vitest";
import { FLAG_LABEL } from "../app/lib/format";
import { FLAG_TEXT, FLOOR_TEXT, INTENT_TEXT, REASON, decisionSentences, escalationKind, isKnownReason, reasonText } from "../core/reasons";
import { FLOOR_CODES, INTENT_ROUTE, computeRoute } from "../core/router";
import { INTENTS } from "../core/policy";
import { loadCases } from "../evals/run";
import { runMessage } from "../evals/harness";
import { MockProvider } from "../core/providers/mock";
import { APP_URL, HAS_DB, OWNER_URL } from "./helpers";

const INTERNAL = /(keyword floor|intent table|needs_review|escalate_only|draft_ready|_|:)/;

describe("reasons.ts: every code the core can emit has a human sentence", () => {
  it("every keyword floor code has a sentence", () => {
    for (const c of FLOOR_CODES) expect(FLOOR_TEXT[c], c).toBeTruthy();
    expect(Object.keys(FLOOR_TEXT).sort()).toEqual([...FLOOR_CODES].sort());
  });
  it("every intent whose route is not draft_ready has a sentence", () => {
    for (const i of INTENTS) if (INTENT_ROUTE[i] !== "draft_ready") expect(INTENT_TEXT[i], i).toBeTruthy();
  });
  it("every fixed reason has a sentence, free of internal codes", () => {
    for (const v of Object.values(REASON)) { expect(isKnownReason(v), v).toBe(true); expect(reasonText(v)).not.toMatch(INTERNAL); }
  });
  it("every flag that has a UI label also has a sentence, and the reverse", () => {
    expect(Object.keys(FLAG_TEXT).sort()).toEqual(Object.keys(FLAG_LABEL).sort());
  });
  it("the router's reasons for any signal combination all map to sentences", () => {
    const routes = ["draft_ready", "needs_review", "escalate_only"] as const;
    for (const intentRoute of routes) for (const verifierRoute of routes) for (const semanticRoute of routes) for (const modelSuggestion of [null, ...routes])
      for (const hasMoneyFact of [false, true]) for (const reviewFloor of [false, true]) for (const forcedEscalation of [false, true]) {
        const { reasons } = computeRoute({ intentRoute, floors: FLOOR_CODES.map((code) => ({ code, route: "escalate_only" as const })), verifierRoute, semanticRoute, modelSuggestion, hasMoneyFact, reviewFloor, forcedEscalation });
        for (const r of reasons) { expect(isKnownReason(r), r).toBe(true); expect(reasonText(r, {})).not.toMatch(INTERNAL); }
      }
  });
  it("the intent table sentence names the intent: payment questions always need a manager's review", () => {
    expect(reasonText("intent table: needs_review", { intent: "payment_question" })).toBe("Payment questions always need a manager's review.");
  });
  it("the decision card gives what / why / next, and escalations name the detected cause", () => {
    const d = decisionSentences({ route: "escalate_only", reasons: ["keyword floor: injection"], intent: "other_resident_data" });
    expect(d.what).toMatch(/No draft/); expect(d.next).toMatch(/Handle this one yourself/); expect(d.why).toMatch(/instructions/);
    expect(escalationKind(["keyword floor: injection"])).toBe("Suspected prompt injection");
    expect(escalationKind(["keyword floor: legal"])).toBe("Legal threat");
    expect(escalationKind(["keyword floor: urgent_hazard"])).toBe("Possible safety hazard");
  });
  it.skipIf(!HAS_DB)("every reason and flag emitted across all 50 eval cases (mock provider) has a sentence", async () => {
    const reasons = new Set<string>(), flags = new Set<string>();
    for (const c of loadCases(2)) {
      const { output } = await runMessage({ appUrl: APP_URL!, ownerUrl: OWNER_URL!, provider: new MockProvider(), unit: c.unit, org: c.org, message: c.message, asOf: "2026-11-19" });
      output.reasons.forEach((x) => reasons.add(x)); output.flags.forEach((f) => flags.add(f));
    }
    expect(reasons.size).toBeGreaterThan(3);
    expect(flags.size).toBeGreaterThan(3);
    for (const x of reasons) expect(isKnownReason(x), x).toBe(true);
    for (const f of flags) expect(FLAG_TEXT[f], f).toBeTruthy();
  }, 120000);
});
