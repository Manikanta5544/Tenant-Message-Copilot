import { FactIds, buildBalanceFact, buildClauseFacts, buildClaimMatch, buildLeaseTermFacts, buildPaymentFacts } from "../core/facts";
import type { ClauseRow, EvidenceBundle, LedgerLine, PaymentEventRow } from "../core/types";

export const RES = "res-101";
export const LEASE = "lease-101";
export const ASOF = "2026-11-19";

export const lines: LedgerLine[] = [
  { id: "l1", entry_type: "charge", amount_paise: 2000000, description: "Rent", occurred_on: "2026-11-01", external_reference: null },
  { id: "l2", entry_type: "payment", amount_paise: -800000, description: "UPI", occurred_on: "2026-11-12", external_reference: "UPI-A101-5521" },
];
export const events: PaymentEventRow[] = [
  { id: "e1", reference: "UPI-A101-5521", amount_paise: 800000, state: "settled", received_on: "2026-11-12", is_duplicate: false, note: null, posted: true, reversed: false },
  { id: "e2", reference: "UPI-A101-PEND", amount_paise: 800000, state: "pending", received_on: "2026-11-18", is_duplicate: false, note: null, posted: false, reversed: false },
  { id: "e3", reference: "UPI-A101-5521", amount_paise: 800000, state: "settled", received_on: "2026-11-12", is_duplicate: true, note: null, posted: false, reversed: false },
  { id: "e4", reference: "UPI-A101-FAIL", amount_paise: 500000, state: "failed", received_on: "2026-11-05", is_duplicate: false, note: null, posted: false, reversed: false },
];
export const clause = (over: Partial<ClauseRow> = {}): ClauseRow => ({
  id: "cl1", number: 4, heading: "Maintenance and repairs", text: "The landlord will acknowledge a maintenance request within 24 hours.",
  version: 1, effective_from: "2026-01-01", effective_to: null, amendment_ref: null, ...over,
});

export function bundle(sqlBalance = 1200000, clauseOver: Partial<ClauseRow> = {}): EvidenceBundle {
  const ids = new FactIds();
  const ctx = { residentId: RES, leaseId: LEASE, asOf: ASOF };
  const facts = [
    buildBalanceFact(ids, ctx, lines, sqlBalance),                       // F1
    ...buildPaymentFacts(ids, ctx, events),                              // F2.. (4 events)
    ...buildLeaseTermFacts(ids, ctx, { id: LEASE, rent_paise: 2000000, due_day: 5, grace_days: 5, deposit_paise: 4000000, late_fee_rule: "" }),
    ...buildClauseFacts(ids, ctx, [clause(clauseOver)]),                 // C1 (only if it applies on asOf)
  ];
  const claim = buildClaimMatch(ids, ctx, events, { amount_paise: 800000, date: "2026-11-12", reference: null });
  return { residentId: RES, leaseId: LEASE, asOf: ASOF, facts: [...facts, claim] };
}
