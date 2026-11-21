// Shared types for the pure core. No Next.js, no database imports.
export type Language = "English" | "Hinglish" | "Hindi" | "Telugu";
export const LANGUAGES: Language[] = ["English", "Hinglish", "Hindi", "Telugu"];

export type EntryType = "charge" | "fee" | "payment" | "reversal" | "adjustment";
export type EventState = "pending" | "settled" | "failed";
export type Route = "draft_ready" | "needs_review" | "escalate_only";
export type FactKind = "balance" | "payment" | "lease_term" | "clause" | "claim_match";

/** Dates are ISO strings (YYYY-MM-DD); money is integer paise. */
export type IsoDate = string;

export interface LedgerLine {
  id: string;
  entry_type: EntryType;
  /** Signed paise: positive increases what the resident owes, negative reduces it. */
  amount_paise: number;
  description: string;
  occurred_on: IsoDate;
  external_reference: string | null;
}

export interface PaymentEventRow {
  id: string;
  reference: string;
  amount_paise: number;
  state: EventState;
  received_on: IsoDate;
  is_duplicate: boolean;
  note: string | null;
  /** A settled, non-duplicate event that has a ledger posting. */
  posted: boolean;
  /** The posting has been reversed by a later reversal entry. */
  reversed: boolean;
}

export interface LeaseRow {
  id: string;
  rent_paise: number;
  due_day: number;
  grace_days: number;
  deposit_paise: number;
  late_fee_rule: string;
}

export interface ClauseRow {
  id: string;
  number: number;
  heading: string;
  text: string;
  version: number;
  effective_from: IsoDate;
  effective_to: IsoDate | null;
  amendment_ref: string | null;
  /** Full-text rank from retrieval (not part of the lease text). */
  rank?: number;
}

interface FactBase { id: string; residentId: string; leaseId: string }

export interface BalanceFact extends FactBase {
  kind: "balance";
  as_of: IsoDate;
  balance_paise: number;
  breakdown: { charges_paise: number; fees_paise: number; payments_paise: number; reversals_paise: number; adjustments_paise: number };
  lines: LedgerLine[];
  /** Computed twice: in TypeScript from ledger rows and in SQL from the lease_balance view. */
  crosscheck: { ts_paise: number; sql_paise: number; agree: boolean };
}
export interface PaymentFact extends FactBase {
  kind: "payment";
  reference: string;
  amount_paise: number;
  state: EventState;
  received_on: IsoDate;
  is_duplicate: boolean;
  posted: boolean;
  reversed: boolean;
  note: string | null;
}
export interface LeaseTermFact extends FactBase {
  kind: "lease_term";
  term: "rent" | "due_day" | "grace_days" | "deposit";
  value: number;
}
export interface ClauseFact extends FactBase {
  kind: "clause";
  clause: ClauseRow;
}
export interface ClaimMatchFact extends FactBase {
  kind: "claim_match";
  matched: boolean;
  claimed: { amount_paise: number | null; date: IsoDate | null; reference: string | null };
  matched_reference: string | null;
  matched_state: EventState | null;
  matched_posted: boolean | null;
  near_references: string[];
}
export type Fact = BalanceFact | PaymentFact | LeaseTermFact | ClauseFact | ClaimMatchFact;

export interface EvidenceBundle {
  residentId: string;
  leaseId: string | null;
  asOf: IsoDate;
  facts: Fact[];
}

/** Everything the application needs from storage, already bound to the run's organisation and resident. */
export interface EvidenceStore {
  getLease(asOf: IsoDate): Promise<LeaseRow | null>;
  getLedger(leaseId: string, asOf: IsoDate): Promise<LedgerLine[]>;
  getSqlBalance(leaseId: string, asOf: IsoDate): Promise<number>;
  /** Ledger lines and the SQL view balance from one statement (one snapshot). */
  getBalanceSnapshot(leaseId: string, asOf: IsoDate): Promise<{ lines: LedgerLine[]; sql_balance_paise: number }>;
  getPaymentEvents(leaseId: string, asOf: IsoDate): Promise<PaymentEventRow[]>;
  searchClauses(leaseId: string, queries: string[], asOf: IsoDate): Promise<ClauseRow[]>;
}
