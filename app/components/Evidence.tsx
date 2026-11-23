"use client";
import { formatInr } from "@/core/money";
import type { BalanceFact, ClaimMatchFact, ClauseFact, Fact, LeaseTermFact, PaymentFact } from "@/core/types";
import { fmtDate, fmtShort } from "../lib/present";
import { runningBalance, type Link } from "../lib/evidence";
import { Table } from "./ui/Table";
import { Dot, type Status } from "./ui/Dot";

const TYPE_LABEL: Record<string, string> = { charge: "Charge", fee: "Fee", payment: "Payment", reversal: "Reversal", adjustment: "Adjustment" };
const PAY: Record<string, { status: Status; label: string }> = {
  settled: { status: "ready", label: "Settled, posted to the ledger" },
  pending: { status: "review", label: "Pending: not a ledger posting yet" },
  failed: { status: "escalate", label: "Failed: no money moved" },
};

/** The body of one piece of evidence. EvidenceRail provides the numbered row around it. */
export default function Evidence({ fact, link, onLine }: { fact: Fact; link?: Link; onLine?: (id: string | null) => void }) {
  return (
    <div className="text-sm">
      {fact.kind === "balance" && <Balance f={fact} link={link} onLine={onLine} />}
      {fact.kind === "payment" && <Payment f={fact} />}
      {fact.kind === "clause" && <Clause f={fact} />}
      {fact.kind === "lease_term" && <Term f={fact} />}
      {fact.kind === "claim_match" && <Claim f={fact} />}
    </div>
  );
}

function Balance({ f, link, onLine }: { f: BalanceFact; link?: Link; onLine?: (id: string | null) => void }) {
  const run = runningBalance(f.lines, f.balance_paise);
  return (
    <div className="space-y-2">
      <p className="text-muted">Derived by code from the ledger as of {fmtDate(f.as_of)}. Positive adds to what the resident owes; negative reduces it.</p>
      <Table caption="Ledger lines with running balance">
        <thead><tr><th scope="col">Date and reference</th><th scope="col">Type</th><th scope="col" className="r">Amount</th>{run && <th scope="col" className="r">Balance</th>}</tr></thead>
        <tbody>{f.lines.map((l, i) => (
          <tr key={l.id} data-line={l.id} data-hot={link?.lineIds.has(l.id) ? "true" : undefined} tabIndex={onLine ? 0 : undefined}
            onMouseEnter={() => onLine?.(l.id)} onMouseLeave={() => onLine?.(null)} onFocus={() => onLine?.(l.id)} onBlur={() => onLine?.(null)}>
            <td title={l.description + (l.external_reference ? ` · ${l.external_reference}` : "")}>
              <span className="block whitespace-nowrap">{fmtShort(l.occurred_on)}</span>
              <span className="block break-all font-mono text-xs text-muted">{l.external_reference ?? l.description}</span>
            </td>
            <td>{TYPE_LABEL[l.entry_type]}</td>
            <td className="r whitespace-nowrap">{formatInr(l.amount_paise)}</td>
            {run && <td className="r whitespace-nowrap text-muted">{formatInr(run[i]!)}</td>}
          </tr>))}</tbody>
        <tfoot><tr data-total data-hot={link?.total ? "true" : undefined}><td colSpan={run ? 3 : 2}>Balance</td><td className="r whitespace-nowrap">{formatInr(f.balance_paise)}</td></tr></tfoot>
      </Table>
      <p className={f.crosscheck.agree ? "text-muted" : "font-semibold text-escalate"}>
        {f.crosscheck.agree ? `Cross-check passed: TypeScript and the SQL view both give ${formatInr(f.crosscheck.ts_paise)}.` : `Cross-check FAILED: TypeScript ${formatInr(f.crosscheck.ts_paise)}, SQL ${formatInr(f.crosscheck.sql_paise)}.`}
      </p>
    </div>
  );
}
function Payment({ f }: { f: PaymentFact }) {
  const st = PAY[f.state]!;
  return (
    <div className="space-y-2">
      <Dot status={st.status} label={st.label} className="font-medium" />
      <dl className="grid grid-cols-[6.5rem_1fr] gap-y-1">
        <dt className="text-muted">Amount</dt><dd className="tnum">{formatInr(f.amount_paise)}</dd>
        <dt className="text-muted">UPI reference</dt><dd className="break-all font-mono text-xs">{f.reference}</dd>
        <dt className="text-muted">Received</dt><dd className="tnum">{fmtDate(f.received_on)}</dd>
        <dt className="text-muted">In the ledger</dt><dd>{f.posted ? "Yes, posted" : "No"}{f.reversed ? ", later reversed by a separate entry" : ""}</dd>
        {f.note && <><dt className="text-muted">Note</dt><dd>{f.note}</dd></>}
      </dl>
      {f.is_duplicate && <p className="text-review">Duplicate of an earlier event with the same reference. Stored, never counted twice.</p>}
    </div>
  );
}
function Clause({ f }: { f: ClauseFact }) {
  const c = f.clause;
  return (
    <div className="space-y-2">
      <p className="tnum text-muted">Clause {c.number}, {c.heading} · version {c.version}{c.amendment_ref ? `, amendment ${c.amendment_ref}` : ", original lease"}</p>
      <blockquote className="border-l-2 border-border-strong pl-3 font-serif text-base leading-relaxed">{c.text}</blockquote>
      <p className="tnum text-muted">Effective {fmtDate(c.effective_from)} to {c.effective_to ? `${fmtDate(c.effective_to)} (not including)` : "now (no end date)"}. Inserted into the draft by code, word for word.</p>
    </div>
  );
}
function Term({ f }: { f: LeaseTermFact }) {
  const v = f.term === "rent" || f.term === "deposit" ? formatInr(f.value) : f.term === "due_day" ? `day ${f.value} of each month` : `${f.value} days`;
  return <p>Lease field <b>{f.term.replace("_", " ")}</b>: <span className="tnum">{v}</span>. Read from the lease record.</p>;
}
function Claim({ f }: { f: ClaimMatchFact }) {
  return (
    <div className="space-y-2">
      <p className="text-muted">What the tenant said they paid, checked against raw payment events (any state), not only the ledger.</p>
      <dl className="grid grid-cols-[6.5rem_1fr] gap-y-1">
        <dt className="text-muted">Claimed amount</dt><dd className="tnum">{f.claimed.amount_paise === null ? "not stated" : formatInr(f.claimed.amount_paise)}</dd>
        <dt className="text-muted">Claimed date</dt><dd className="tnum">{f.claimed.date ? fmtDate(f.claimed.date) : "not stated"}</dd>
        <dt className="text-muted">Result</dt><dd>{f.matched ? <>Matched <span className="font-mono text-xs">{f.matched_reference}</span> ({f.matched_state}{f.matched_posted ? ", posted" : ", not posted"})</> : "No matching payment event"}</dd>
      </dl>
      {f.near_references.length > 0 && <p className="text-muted">Near matches: {f.near_references.map((r) => <span key={r} className="mr-1.5 font-mono text-xs">{r}</span>)}</p>}
    </div>
  );
}
