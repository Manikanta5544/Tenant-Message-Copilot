import type { FactKind } from "./types";

export const INTENTS = [
  "maintenance_request", "lease_question", "balance_question", "payment_question", "fee_waiver_request",
  "legal_threat", "eviction_concern", "deposit_dispute", "other_resident_data", "general_other",
] as const;
export type Intent = (typeof INTENTS)[number];

export const TOOLS = ["search_lease_clauses", "get_balance_breakdown", "get_payment_history", "match_claimed_payment"] as const;
export type ToolName = (typeof TOOLS)[number];

/** Per-intent tool allowlist. Legal, eviction, deposit and other-resident messages get no tools. */
export const TOOL_ALLOWLIST: Record<Intent, ToolName[]> = {
  maintenance_request: ["search_lease_clauses"],
  lease_question: ["search_lease_clauses"],
  fee_waiver_request: ["search_lease_clauses"],
  general_other: ["search_lease_clauses"],
  balance_question: ["get_balance_breakdown", "get_payment_history", "match_claimed_payment"],
  payment_question: ["get_balance_breakdown", "get_payment_history", "match_claimed_payment"],
  legal_threat: [],
  eviction_concern: [],
  deposit_dispute: [],
  other_resident_data: [],
};

/** Tools code runs even if the model did not propose them (the model may only make a run safer). */
export const MANDATORY_TOOLS: Record<Intent, ToolName[]> = {
  maintenance_request: ["search_lease_clauses"],
  lease_question: ["search_lease_clauses"],
  fee_waiver_request: ["search_lease_clauses"],
  general_other: ["search_lease_clauses"],
  balance_question: ["get_balance_breakdown"],
  payment_question: ["get_balance_breakdown", "get_payment_history"],
  legal_threat: [], eviction_concern: [], deposit_dispute: [], other_resident_data: [],
};

/** Fact kinds a draft must reference when the bundle contains them. */
export const REQUIRED_KINDS: Record<Intent, FactKind[]> = {
  maintenance_request: ["clause"],
  lease_question: ["clause"],
  fee_waiver_request: ["clause"],
  general_other: [],
  balance_question: ["balance"],
  payment_question: ["balance", "payment"],
  legal_threat: [], eviction_concern: [], deposit_dispute: [], other_resident_data: [],
};

export const MAX_TOOL_CALLS = 4;
