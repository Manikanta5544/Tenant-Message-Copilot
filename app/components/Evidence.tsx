"use client";
import { formatInr } from "@/core/money";
import type { BalanceFact, ClaimMatchFact, ClauseFact, Fact, LeaseTermFact, PaymentFact } from "@/core/types";
import { fmtDate } from "../lib/present";
import { Chip } from "./ui/Chip";

const TYPE_LABEL: Record<string, string> = { charge: "Charge", fee: "Fee", payment: "Payment", reversal: "Reversal", adjustment: "Adjustment" };
const STATE: Record<string, { label: string; cls: string }> = {
  settled: { label: "Settled and posted to the ledger", cls: "border-ready-line bg-ready-bg text-ready" },
  pending: { label: "Pending: not a ledger posting yet", cls: "border-dashed border-review-line bg-review-bg text-review" },
  failed: { label: "Failed: no money moved", cls: "border-escalate-line bg-escalate-bg text-escalate" },
};

export function evidenceTitle(f: Fact): string {
  switch (f.kind) {
    case "balance": return `Balance ${formatInr(f.balance_paise)}`;
    case "payment": return `${formatInr(f.amount_paise)} · ${f.state}`;
    case "clause": return `Clause ${f.clause.number} v${f.clause.version}`;
    case "lease_term": return f.term.replace("_", " ");
    case "claim_match": return f.matched ? "Claimed payment found" : "Claimed payment not found";
  }
}

/** The expanded body of one piece of evidence. EvidencePanel provides the card around it. */
export default function Evidence({ fact }: { fact: Fact }) {
  return (
    <div className="text-base">
      {fact.kind === "balance" && <Balance f={fact} />}
      {fact.kind === "payment" && <Payment f={fact} />}
      {fact.kind === "clause" && <Clause f={fact} />}
      {fact.kind === "lease_term" && <Term f={fact} />}
      {fact.kind === "claim_match" && <Claim f={fact} />}
    </div>
  );
}

function Balance({ f }: { f: BalanceFact }) {
  return (
    <div className="space-y-3">
      <p className="text-muted">Derived by code from the ledger as of {fmtDate(f.as_of)}. Positive amounts add to what the resident owes; negative amounts reduce it.</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-left text-sm">
        <thead className="border-b border-border text-xs text-muted"><tr><th className="py-1 pr-3 font-medium">Date</th><th className="pr-3 font-medium">Type</th><th className="pr-3 font-medium">Description</th><th className="pr-3 font-medium">Reference</th><th className="text-right font-medium">Amount</th></tr></thead>
        <tbody>{f.lines.map((l) => (
          <tr key={l.id} className="border-b border-border"><td className="num py-1 pr-3">{fmtDate(l.occurred_on)}</td><td className="pr-3">{TYPE_LABEL[l.entry_type]}</td><td className="pr-3">{l.description}</td><td className="num pr-3 text-muted">{l.external_reference ?? "-"}</td><td className={`num text-right ${l.amount_paise < 0 ? "text-ready" : ""}`}>{formatInr(l.amount_paise)}</td></tr>
        ))}</tbody>
        <tfoot><tr><td colSpan={4} className="pt-2 font-semibold">Balance</td><td className="num pt-2 text-right font-semibold">{formatInr(f.balance_paise)}</td></tr></tfoot>
      </table></div>
      <p className={f.crosscheck.agree ? "text-ready" : "font-semibold text-escalate"}>
        {f.crosscheck.agree ? `Cross-check passed: the TypeScript derivation and the SQL view both give ${formatInr(f.crosscheck.ts_paise)}.` : `Cross-check FAILED: TypeScript ${formatInr(f.crosscheck.ts_paise)}, SQL ${formatInr(f.crosscheck.sql_paise)}.`}
      </p>
    </div>
  );
}
function Payment({ f }: { f: PaymentFact }) {
  const st = STATE[f.state]!;
  return (
    <div className="space-y-3">
      <div className={`inline-block rounded border-2 px-2.5 py-1 font-semibold ${st.cls}`}>{st.label}</div>
      <dl className="grid grid-cols-[9rem_1fr] gap-y-1">
        <dt className="text-muted">Amount</dt><dd className="num">{formatInr(f.amount_paise)}</dd>
        <dt className="text-muted">UPI reference</dt><dd className="num">{f.reference}</dd>
        <dt className="text-muted">Received</dt><dd>{fmtDate(f.received_on)}</dd>
        <dt className="text-muted">In the ledger</dt><dd>{f.posted ? "Yes, posted" : "No"}{f.reversed ? ", later reversed by a separate entry" : ""}</dd>
        {f.note && <><dt className="text-muted">Note</dt><dd>{f.note}</dd></>}
      </dl>
      {f.is_duplicate && <p className="text-review">This is a duplicate of an earlier event with the same reference. It is stored but never counted twice.</p>}
    </div>
  );
}
function Clause({ f }: { f: ClauseFact }) {
  const c = f.clause;
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-[9rem_1fr] gap-y-1">
        <dt className="text-muted">Clause</dt><dd>{c.number}, {c.heading}</dd>
        <dt className="text-muted">Version</dt><dd>{c.version}{c.amendment_ref ? `, amendment ${c.amendment_ref}` : ", original lease"}</dd>
        <dt className="text-muted">In force</dt><dd>{fmtDate(c.effective_from)} to {c.effective_to ? `${fmtDate(c.effective_to)} (not including)` : "now (no end date)"}</dd>
      </dl>
      <blockquote className="rounded-lg border border-border border-l-4 border-l-accent bg-bg-subtle px-4 py-3 font-serif text-base italic leading-relaxed">{c.text}</blockquote>
      <p className="text-muted">Inserted into the draft by code, word for word.</p>
    </div>
  );
}
function Term({ f }: { f: LeaseTermFact }) {
  const v = f.term === "rent" || f.term === "deposit" ? formatInr(f.value) : f.term === "due_day" ? `day ${f.value} of each month` : `${f.value} days`;
  return <p>Lease field <b>{f.term.replace("_", " ")}</b>: <span className="num">{v}</span>. Read from the lease record.</p>;
}
function Claim({ f }: { f: ClaimMatchFact }) {
  return (
    <div className="space-y-2">
      <p className="text-muted">What the tenant said they paid, checked against raw payment events (any state), not only the ledger.</p>
      <dl className="grid grid-cols-[9rem_1fr] gap-y-1">
        <dt className="text-muted">Claimed amount</dt><dd className="num">{f.claimed.amount_paise === null ? "not stated" : formatInr(f.claimed.amount_paise)}</dd>
        <dt className="text-muted">Claimed date</dt><dd>{f.claimed.date ? fmtDate(f.claimed.date) : "not stated"}</dd>
        <dt className="text-muted">Result</dt><dd>{f.matched ? <>Matched <b className="num">{f.matched_reference}</b> ({f.matched_state}{f.matched_posted ? ", posted" : ", not posted"})</> : "No matching payment event"}</dd>
      </dl>
      {f.near_references.length > 0 && <p>Near matches: {f.near_references.map((r) => <Chip key={r}>{r}</Chip>)}</p>}
    </div>
  );
}
