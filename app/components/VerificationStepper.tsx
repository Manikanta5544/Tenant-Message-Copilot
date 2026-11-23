// import { LAYER_LABEL } from "../lib/format";
// import type { LayerView } from "../lib/types";
// import { Icon } from "./ui/Icon";
// import { cx } from "./ui/cx";

// const HINT: Record<string, string> = {
//   schema: "Output parses against the schema", evidence: "Every id exists, belongs to this resident and applies today", exactness: "Balance matches SQL; no digits or figures in model text",
//   policy: "Topic allowed; keyword floors applied", semantic: "Prose follows from the cited facts (can only lower trust)", abstention: "A material claim can be established",
// };
// type State = "pass" | "warn" | "fail" | "skipped";
// const STYLE: Record<State, { icon: string; dot: string; word: string }> = {
//   pass: { icon: "check", dot: "bg-ready-bg text-ready border-ready-line", word: "passed" },
//   warn: { icon: "alert", dot: "bg-review-bg text-review border-review-line", word: "flagged" },
//   fail: { icon: "x", dot: "bg-escalate-bg text-escalate border-escalate-line", word: "failed" },
//   skipped: { icon: "minus", dot: "bg-bg-subtle text-faint border-border", word: "not run" },
// };

// /** The six verification layers as a vertical stepper. Each step has an icon and a word, and opens to show what it checks and any issues. */
// export default function VerificationStepper({ layers }: { layers: LayerView[] }) {
//   return (
//     <ol className="relative">
//       {layers.map((l, i) => {
//         const state: State = l.skipped ? "skipped" : l.ok ? "pass" : l.critical ? "fail" : "warn";
//         const st = STYLE[state];
//         return (
//           <li key={l.layer} className="relative flex gap-3 pb-4 last:pb-0">
//             {i < layers.length - 1 && <span aria-hidden className="absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px bg-border" />}
//             <span className={cx("z-10 grid size-8 shrink-0 place-items-center rounded-full border", st.dot)}><Icon name={st.icon} size={15} /></span>
//             <details className="group min-w-0 flex-1 rounded-lg" open={l.issues.length > 0}>
//               <summary className="t flex min-h-8 cursor-pointer list-none items-center gap-2 rounded-lg px-1 py-1 hover:bg-bg-subtle">
//                 <span className="text-base font-medium">{l.layer}. {LAYER_LABEL[l.name]}</span>
//                 <span className={cx("text-sm", state === "pass" ? "text-ready" : state === "skipped" ? "text-faint" : state === "fail" ? "text-escalate" : "text-review")}>{st.word}</span>
//                 <Icon name="chevron" size={14} className="ml-auto text-faint transition-transform group-open:rotate-180" />
//               </summary>
//               <div className="px-1 pb-1 pt-1 text-sm text-muted">
//                 <p>{HINT[l.name]}</p>
//                 {l.issues.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-5 text-text">{l.issues.map((x, k) => <li key={k}>{x}</li>)}</ul>}
//               </div>
//             </details>
//           </li>
//         );
//       })}
//     </ol>
//   );
// }
