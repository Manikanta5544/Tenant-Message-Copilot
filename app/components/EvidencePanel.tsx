// "use client";
// import { useEffect, useRef } from "react";
// import { formatInr } from "@/core/money";
// import type { Fact } from "@/core/types";
// import Evidence from "./Evidence";
// import { Card } from "./ui/Card";
// import { Icon } from "./ui/Icon";
// import { cx } from "./ui/cx";

// const ICON: Record<Fact["kind"], string> = { balance: "wallet", payment: "wallet", clause: "file", lease_term: "key", claim_match: "search" };
// const KIND: Record<Fact["kind"], string> = { balance: "Ledger balance", payment: "Payment", clause: "Lease clause", lease_term: "Lease record", claim_match: "Claim check" };

// export function evidenceTitle(f: Fact): string {
//   switch (f.kind) {
//     case "balance": return `Balance ${formatInr(f.balance_paise)}`;
//     case "payment": return `${formatInr(f.amount_paise)} · ${f.state}`;
//     case "clause": return `Clause ${f.clause.number} v${f.clause.version}`;
//     case "lease_term": return f.term.replace("_", " ");
//     case "claim_match": return f.matched ? "Claimed payment found" : "Claimed payment not found";
//   }
// }

// /** Compact evidence cards. Clicking a chip or quote in the letter opens, scrolls to and briefly outlines its card (`flash` changes on every click). */
// export default function EvidencePanel({ facts, open, onToggle, flash }: { facts: Fact[]; open: string | null; onToggle: (id: string | null) => void; flash: { id: string; n: number } | null }) {
//   const refs = useRef<Record<string, HTMLElement | null>>({});
//   useEffect(() => {
//     if (!flash) return;
//     const el = refs.current[flash.id]; if (!el) return;
//     el.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
//     el.classList.remove("ev-flash"); void el.offsetWidth; el.classList.add("ev-flash");
//   }, [flash]);
//   if (facts.length === 0) return null;
//   return (
//     <section aria-label="Evidence used">
//       <h3 className="mb-2 text-lg">Evidence used</h3>
//       <ul className="space-y-2">
//         {facts.map((f) => {
//           const isOpen = open === f.id;
//           const pending = f.kind === "payment" && f.state === "pending";
//           return (
//             <li key={f.id} id={`ev-${f.id}`} ref={(el) => { refs.current[f.id] = el; }} className="scroll-mt-28 rounded-card">
//               <Card className={cx("overflow-hidden", isOpen && "border-accent")}>
//                 <button type="button" onClick={() => onToggle(isOpen ? null : f.id)} aria-expanded={isOpen} aria-controls={`ev-body-${f.id}`}
//                   className="t flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left hover:bg-bg-subtle">
//                   <span className={cx("grid size-8 shrink-0 place-items-center rounded-lg", pending ? "bg-review-bg text-review" : "bg-fact-bg text-fact")}><Icon name={ICON[f.kind]} size={16} /></span>
//                   <span className="min-w-0 flex-1">
//                     <span className="block text-sm text-muted">{KIND[f.kind]} <span className="mono font-semibold text-text">{f.id}</span></span>
//                     <span className="num block truncate text-base font-medium">{evidenceTitle(f)}</span>
//                   </span>
//                   <Icon name="chevron" size={16} className={cx("t text-faint", isOpen && "rotate-180")} />
//                 </button>
//                 {isOpen && <div id={`ev-body-${f.id}`} className="pop border-t border-border p-4"><Evidence fact={f} /></div>}
//               </Card>
//             </li>
//           );
//         })}
//       </ul>
//     </section>
//   );
// }
