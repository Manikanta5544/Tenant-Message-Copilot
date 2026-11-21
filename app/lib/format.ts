import type { Seg } from "./types";
export const plainText = (segs: Seg[]) => segs.map((s) => s.text).join("");
export const usd = (micro: number) => (micro / 1e6).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 4 });
export const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`;
};
export const INTENT_LABEL: Record<string, string> = {
  maintenance_request: "Maintenance", lease_question: "Lease question", balance_question: "Balance", payment_question: "Payment", fee_waiver_request: "Fee waiver",
  legal_threat: "Legal threat", eviction_concern: "Eviction", deposit_dispute: "Deposit dispute", other_resident_data: "Other resident's data", general_other: "Other",
};
export const ROUTE_LABEL: Record<string, string> = { draft_ready: "Draft ready", needs_review: "Needs review", escalate_only: "Escalate only" };
export const LAYER_LABEL: Record<string, string> = { schema: "Schema", evidence: "Evidence", exactness: "Exactness", policy: "Policy", semantic: "Semantic check", abstention: "Abstention" };
export const FLAG_LABEL: Record<string, string> = {
  urgent: "Urgent", claim_unmatched: "Claimed payment not found", pending_payment: "Pending payment", duplicate_payment: "Duplicate reference", suspected_injection: "Suspected injection",
  conflicting_clauses: "Clauses may conflict", no_evidence: "Lease is silent", semantic_review: "Semantic check could not confirm", verification_failed: "Verification failed twice",
  critical_incident: "Critical incident", budget_exhausted: "Budget exhausted", provider_failed: "Model unavailable", evidence_unavailable: "Evidence unavailable",
};
