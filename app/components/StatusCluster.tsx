// "use client";
// import { useEffect, useRef, useState } from "react";
// import type { StatusView } from "../lib/types";
// import { Chip, type Tone } from "./ui/Chip";
// import { Icon } from "./ui/Icon";
// import { cx } from "./ui/cx";

// const MODE: Record<string, { tone: Tone; label: string; hint: string }> = {
//   live: { tone: "ready", label: "Live", hint: "Responses come from a live model" },
//   replay: { tone: "fact", label: "Replay", hint: "Replaying recorded real model responses" },
//   mock: { tone: "review", label: "Mock", hint: "Deterministic mock provider, not a real model" },
// };

// /** One compact cluster: Demo · Synthetic data · Live/Mock. Details (date, models, limits) open in a popover; on phones it is the only status control. */
// export default function StatusCluster({ s, err }: { s: StatusView | null; err: boolean }) {
//   const [open, setOpen] = useState(false);
//   const box = useRef<HTMLDivElement>(null);
//   useEffect(() => {
//     if (!open) return;
//     const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
//     const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
//     document.addEventListener("mousedown", down); document.addEventListener("keydown", key);
//     return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
//   }, [open]);

//   const mode = s ? MODE[s.provider_mode]! : null;
//   const unavailable = s?.models ? [...new Set(Object.values(s.models).filter((m) => m.available === false).map((m) => m.model))] : [];
//   const providerProblem = s?.provider_mode === "live" && s.provider !== "reachable" && s.provider !== "model_unavailable" ? s.provider.replace("_", " ") : null;
//   const runsLeft = s && s.budget.runs_used !== null ? s.budget.runs_cap - s.budget.runs_used : null;
//   const lowRuns = runsLeft !== null && s ? runsLeft > 0 && runsLeft <= Math.ceil(s.budget.runs_cap * 0.1) : false;
//   const noRuns = runsLeft !== null && runsLeft <= 0;
//   const budgetOut = s?.budget.remaining_micro_usd !== null && s?.budget.remaining_micro_usd !== undefined && s.budget.remaining_micro_usd <= 0;
//   const attention = unavailable.length > 0 || !!providerProblem || noRuns || budgetOut || lowRuns || !!s?.mock_with_key;

//   return (
//     <>
//       <div ref={box} className="relative">
//         <button type="button" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}
//           className="t flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-surface px-2 sm:gap-2 sm:px-2.5 text-sm hover:bg-bg-subtle sm:min-h-9">
//           <span className="font-medium text-text">Demo</span><span className="text-faint" aria-hidden>·</span>
//           <span className="hidden text-muted sm:inline">Synthetic data</span><span className="hidden text-faint sm:inline" aria-hidden>·</span>
//           {mode ? <Chip tone={mode.tone} title={mode.hint}>{mode.label}</Chip> : <span className="text-faint">{err ? "Status unavailable" : "Checking…"}</span>}
//           {attention && <span className="size-2 rounded-full bg-review" aria-label="Needs attention" />}
//           <Icon name="chevron" size={14} className={cx("t text-faint", open && "rotate-180")} />
//         </button>
//         {open && (
//           <div role="dialog" aria-label="Environment details" className="pop absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-card border border-border bg-raised p-4 text-sm shadow-e2">
//             <p className="font-semibold">Demo environment</p>
//             <p className="mt-0.5 text-muted">Every resident, lease and payment is synthetic. Nothing is ever sent to a tenant.</p>
//             {s ? (
//               <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5">
//                 <dt className="text-muted">Model mode</dt><dd className="font-medium">{mode!.label}{s.provider_backend ? ` · ${s.provider_backend}` : ""}</dd>
//                 <dt className="text-muted">Demo date</dt><dd className="num font-medium">{s.as_of}</dd>
//                 {s.models && Object.entries(s.models).map(([role, m]) => (
//                   <div key={role} className="contents"><dt className="text-muted capitalize">{role}</dt><dd className="mono break-all text-xs">{m.model} <span className={m.available === false ? "text-escalate" : m.available ? "text-ready" : "text-faint"}>{m.available === false ? "unavailable" : m.available ? "available" : "unchecked"}</span></dd></div>
//                 ))}
//                 <dt className="text-muted">Runs today</dt><dd className="num">{s.budget.runs_used ?? "?"} of {s.budget.runs_cap}</dd>
//               </dl>
//             ) : <p className="mt-3 text-muted">{err ? "Status could not be loaded." : "Checking…"}</p>}
//             {(unavailable.length > 0 || providerProblem) && <p role="status" className="mt-3 rounded-lg border border-escalate-line bg-escalate-bg p-2 text-escalate">{unavailable.length > 0 ? `Model ${unavailable.join(", ")} is not available to this key. Run npm run models.` : `Model provider: ${providerProblem}.`}</p>}
//             {(noRuns || budgetOut) && <p className="mt-3 rounded-lg border border-escalate-line bg-escalate-bg p-2 text-escalate">{budgetOut ? "Daily budget used up." : "Daily run limit reached."} It resets at 00:00 UTC.</p>}
//             {lowRuns && <p className="mt-3 rounded-lg border border-review-line bg-review-bg p-2 text-review">{runsLeft} demo runs left today.</p>}
//           </div>
//         )}
//       </div>
//       <span className="num hidden rounded-lg border border-border bg-surface px-2 py-1 text-sm text-muted md:inline" title="Leases, balances and due dates are computed as of this fixed date.">{s ? `Demo date ${s.as_of}` : ""}</span>
//     </>
//   );
// }
