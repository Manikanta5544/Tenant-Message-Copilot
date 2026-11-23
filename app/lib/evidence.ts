import { formatInr } from "@/core/money";
import type { Fact } from "@/core/types";
import type { Seg } from "./types";

/** Footnote numbering: the referenced facts in order of first appearance in the draft. [1] is the first value or quote the reader meets. */
export function footnotes(segs: Seg[], facts: Fact[]): { list: Fact[]; num: Record<string, number> } {
  const list: Fact[] = [], num: Record<string, number> = {};
  for (const s of segs) {
    if (!s.refId || num[s.refId]) continue;
    const f = facts.find((x) => x.id === s.refId); if (!f) continue;
    list.push(f); num[f.id] = list.length;
  }
  return { list, num };
}

export const KIND_LABEL: Record<Fact["kind"], string> = { balance: "Ledger", payment: "Payment", clause: "Lease clause", lease_term: "Lease record", claim_match: "Claim check" };

export function evidenceTitle(f: Fact): string {
  switch (f.kind) {
    case "balance": return `Balance ${formatInr(f.balance_paise)}`;
    case "payment": return `${formatInr(f.amount_paise)} · ${f.state}`;
    case "clause": return `Clause ${f.clause.number} v${f.clause.version}`;
    case "lease_term": return f.term.replace("_", " ");
    case "claim_match": return f.matched ? "Claimed payment found" : "Claimed payment not found";
  }
}

/** Ledger lines with a running balance (integer paise, summed in the order shown). Null when the sum does not equal the derived balance,
 *  so the UI never shows a running column that disagrees with the figure above it. */
export function runningBalance(lines: { amount_paise: number }[], balance: number): number[] | null {
  let acc = 0; const out = lines.map((l) => (acc += l.amount_paise));
  return out.length && out[out.length - 1] === balance ? out : out.length === 0 ? [] : null;
}

/** Two-way linking between footnotes and the ledger. `hot` is a footnote/evidence id under the pointer; `lineHot` is a ledger line under the pointer.
 *  Result: which footnotes and cards to highlight (`ids`), which ledger lines (`lineIds`) and whether the balance total row (`total`). */
export interface Link { ids: Set<string>; lineIds: Set<string>; total: boolean }
export function linkState(facts: Fact[], hot: string | null, lineHot: string | null): Link {
  const ids = new Set<string>(), lineIds = new Set<string>();
  let total = false;
  const balance = facts.find((f) => f.kind === "balance");
  const pay = (ref: string | null | undefined) => (ref ? facts.find((f) => f.kind === "payment" && f.reference === ref) : undefined);
  if (hot) {
    ids.add(hot);
    const f = facts.find((x) => x.id === hot);
    if (f?.kind === "payment" && balance?.kind === "balance") for (const l of balance.lines) if (l.external_reference === f.reference) lineIds.add(l.id);
    if (f?.kind === "balance") total = true;
  }
  if (lineHot && balance?.kind === "balance") {
    const l = balance.lines.find((x) => x.id === lineHot);
    if (l) { lineIds.add(l.id); ids.add(balance.id); const p = pay(l.external_reference); if (p) ids.add(p.id); }
  }
  return { ids, lineIds, total };
}
