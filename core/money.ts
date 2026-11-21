import type { EntryType, IsoDate, LedgerLine } from "./types";

export function assertPaise(n: number, what = "amount"): number {
  if (!Number.isSafeInteger(n)) throw new Error(`${what} must be an integer number of paise, got ${n}`);
  return n;
}

export const rupeesToPaise = (rupees: number): number => Math.round(rupees * 100);

/** Indian digit grouping, e.g. 1735000 paise -> ₹17,350 ; 1735050 -> ₹17,350.50. Negative -> -₹500. */
export function formatInr(paise: number): string {
  assertPaise(paise);
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const rem = abs % 100;
  const grouped = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(rupees);
  return `${neg ? "-" : ""}₹${grouped}${rem ? "." + String(rem).padStart(2, "0") : ""}`;
}

const SIGN_OK: Record<EntryType, (n: number) => boolean> = {
  charge: (n) => n > 0,
  fee: (n) => n > 0,
  payment: (n) => n < 0,
  reversal: (n) => n > 0,
  adjustment: (n) => n !== 0,
};

export interface BalanceBreakdown {
  balance_paise: number;
  charges_paise: number;
  fees_paise: number;
  payments_paise: number;
  reversals_paise: number;
  adjustments_paise: number;
}

/** Derives a lease balance from ledger lines on or before asOf. Pure; never reads the clock. */
export function deriveBalance(lines: LedgerLine[], asOf: IsoDate): BalanceBreakdown {
  const out: BalanceBreakdown = { balance_paise: 0, charges_paise: 0, fees_paise: 0, payments_paise: 0, reversals_paise: 0, adjustments_paise: 0 };
  for (const l of lines) {
    assertPaise(l.amount_paise, `ledger line ${l.id}`);
    if (!SIGN_OK[l.entry_type](l.amount_paise)) throw new Error(`ledger line ${l.id}: invalid sign for ${l.entry_type}`);
    if (l.occurred_on > asOf) continue;
    out.balance_paise += l.amount_paise;
    if (l.entry_type === "charge") out.charges_paise += l.amount_paise;
    else if (l.entry_type === "fee") out.fees_paise += l.amount_paise;
    else if (l.entry_type === "payment") out.payments_paise += l.amount_paise;
    else if (l.entry_type === "reversal") out.reversals_paise += l.amount_paise;
    else out.adjustments_paise += l.amount_paise;
  }
  return out;
}

/** Last day of a YYYY-MM period as ISO date. */
export function endOfPeriod(period: string): IsoDate {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) throw new Error("period must be YYYY-MM");
  const y = Number(m[1]), mo = Number(m[2]);
  if (mo < 1 || mo > 12) throw new Error("period month out of range");
  const d = new Date(Date.UTC(y, mo, 0));
  return d.toISOString().slice(0, 10);
}
export const startOfPeriod = (period: string): IsoDate => `${period}-01`;
export const minDate = (a: IsoDate, b: IsoDate): IsoDate => (a < b ? a : b);
