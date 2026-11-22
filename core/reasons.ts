// The one place that turns internal route reasons and flags into plain sentences for a property manager.
// Codes are what the core emits (stored on every run); text is what the UI shows. Adding a code without a sentence fails
// tests/reasons.test.ts, so the UI can never show an internal code.
import type { Intent } from "./policy";
import type { FloorCode } from "./router";
import type { Route } from "./types";

/** Fixed reason strings the router and pipeline emit (the keyword-floor, intent-table and model-suggestion reasons are built from codes below). */
export const REASON = {
  verificationFailed: "verification failed",
  semanticUnconfirmed: "semantic check could not confirm the draft",
  moneyFact: "draft contains a money fact",
  flaggedForReview: "items flagged for review",
  templateForced: "provider or budget unavailable: template reply",
  balanceCrosscheck: "balance cross-check failed",
  verificationFailedTwice: "verification failed twice",
  conflictingClauses: "possible conflicting clauses",
  insufficientClauses: "retrieved clauses insufficient",
  evidenceMissing: "evidence missing",
} as const;

const FIXED: Record<string, string> = {
  [REASON.verificationFailed]: "The draft did not pass the automatic checks, so it needs a person.",
  [REASON.semanticUnconfirmed]: "A second model could not confirm that every sentence is supported by the evidence.",
  [REASON.moneyFact]: "The reply states money from the ledger, and money always needs a manager's eyes.",
  [REASON.flaggedForReview]: "Something in the evidence needs a person to look at it (see the flags).",
  [REASON.templateForced]: "The model was not available, so only a safe holding reply is offered.",
  [REASON.balanceCrosscheck]: "Two independent balance calculations disagreed, so no figure is shown. This is logged as an incident.",
  [REASON.verificationFailedTwice]: "The draft failed the checks twice, so none of it is shown.",
  [REASON.conflictingClauses]: "Two lease clauses may conflict, so a person must decide which applies.",
  [REASON.insufficientClauses]: "The lease clauses found do not answer the question fully.",
  [REASON.evidenceMissing]: "The lease and ledger hold no evidence for this question.",
};

export const FLOOR_TEXT: Record<FloorCode, string> = {
  legal: "The message mentions legal action, so a manager has to handle it personally.",
  police: "The message mentions the police, so a manager has to handle it personally.",
  eviction: "The message is about eviction or leaving the flat, which only a manager can discuss.",
  deposit_dispute: "The message disputes the security deposit, which only a manager can settle.",
  injection: "The message tries to give the assistant instructions, so it was not answered automatically.",
  other_resident: "The message asks about another resident's details, which this tool never shares.",
  urgent_hazard: "The message describes a possible safety hazard, so a manager should see it first.",
  waiver: "Fee waivers are a manager's decision.",
};

/** Why each intent has the route it has (the "intent table"). Intents that route to draft_ready have no entry. */
export const INTENT_TEXT: Partial<Record<Intent, string>> = {
  balance_question: "Balance questions always need a manager's review.",
  payment_question: "Payment questions always need a manager's review.",
  fee_waiver_request: "Fee waiver requests always need a manager's decision.",
  general_other: "Messages that fit no standard category always need a manager's review.",
  legal_threat: "Legal threats are always handled by a manager.",
  eviction_concern: "Eviction concerns are always handled by a manager.",
  deposit_dispute: "Deposit disputes are always handled by a manager.",
  other_resident_data: "Requests for other residents' information are never answered here.",
};

export const FLAG_TEXT: Record<string, string> = {
  urgent: "The message looks urgent.",
  claim_unmatched: "The tenant says they paid, but no matching payment was found.",
  pending_payment: "A payment is still pending with the bank.",
  duplicate_payment: "The same payment reference arrived more than once.",
  suspected_injection: "The message looks like an attempt to instruct the assistant.",
  conflicting_clauses: "Lease clauses may conflict.",
  no_evidence: "The lease says nothing about this.",
  semantic_review: "The semantic check could not confirm the draft.",
  verification_failed: "The draft failed the automatic checks twice.",
  critical_incident: "A consistency check failed and was logged as an incident.",
  budget_exhausted: "Today's demo budget is used up.",
  provider_failed: "The model is unavailable.",
  evidence_unavailable: "The evidence could not be loaded.",
};

const MODEL_SUGGEST = (r: string) => `The assistant itself recommended "${r === "escalate_only" ? "handle manually" : "needs review"}".`;

/** Plain sentence for one stored route reason. Unknown codes degrade to a neutral sentence (and are caught by the tests). */
export function reasonText(code: string, ctx: { intent?: string | null } = {}): string {
  if (FIXED[code]) return FIXED[code];
  let m = /^keyword floor: (\w+)$/.exec(code);
  if (m && m[1]! in FLOOR_TEXT) return FLOOR_TEXT[m[1] as FloorCode];
  m = /^intent table: (\w+)$/.exec(code);
  if (m) return (ctx.intent && INTENT_TEXT[ctx.intent as Intent]) || (m[1] === "escalate_only" ? "This kind of message is always handled by a manager." : "This kind of message always needs a manager's review.");
  m = /^model suggested (\w+)$/.exec(code);
  if (m) return MODEL_SUGGEST(m[1]!);
  return "A safety rule asked for a person to look at this.";
}

/** True when the code is one the table knows. Used by tests. */
export function isKnownReason(code: string): boolean {
  return code in FIXED || /^keyword floor: (\w+)$/.test(code) && (/^keyword floor: (\w+)$/.exec(code)![1]! in FLOOR_TEXT)
    || /^intent table: (needs_review|escalate_only)$/.test(code) || /^model suggested (needs_review|escalate_only)$/.test(code);
}

/** The decision card's three sentences: what happened, why, what to do next. */
export function decisionSentences(a: { route: Route | null; reasons: string[]; intent?: string | null; flags?: string[] }): { what: string; why: string; next: string } {
  const route = a.route ?? "needs_review";
  const what = {
    draft_ready: "A draft reply is ready, built only from checked evidence.",
    needs_review: "A draft reply was prepared, but it needs your review before anyone relies on it.",
    escalate_only: "No draft is offered for this message.",
  }[route];
  const next = {
    draft_ready: "Read the draft, check each highlighted value against Evidence used, then approve or edit it.",
    needs_review: "Check every highlighted value against Evidence used, edit anything that looks wrong, then approve.",
    escalate_only: "Handle this one yourself and reply to the tenant personally.",
  }[route];
  const first = a.reasons[0];
  const why = first ? reasonText(first, { intent: a.intent }) : { draft_ready: "Every automatic check passed.", needs_review: "A safety rule asked for a person to look at it.", escalate_only: "A safety rule requires a person to handle it." }[route];
  return { what, why, next };
}

/** For an escalate-only run: the detected reason, in a few words. */
export function escalationKind(reasons: string[], flags: string[] = []): string {
  const has = (c: FloorCode) => reasons.includes(`keyword floor: ${c}`);
  if (has("injection") || flags.includes("suspected_injection")) return "Suspected prompt injection";
  if (has("legal") || has("police")) return "Legal threat";
  if (has("eviction")) return "Eviction concern";
  if (has("deposit_dispute")) return "Deposit dispute";
  if (has("other_resident")) return "Another resident's data requested";
  if (has("urgent_hazard") || flags.includes("urgent")) return "Possible safety hazard";
  if (flags.includes("critical_incident") || reasons.includes(REASON.balanceCrosscheck)) return "Consistency check failed";
  if (flags.includes("provider_failed") || flags.includes("budget_exhausted")) return "Model unavailable";
  return "Safety rule";
}
