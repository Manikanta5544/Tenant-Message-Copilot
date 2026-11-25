// The text of the evidence bundle shown to the drafting and checking models: ids and values,
// never database ids. Contains only the run's own resident's facts.
import { formatDate, renderFact } from "./facts";
import { REQUIRED_KINDS, type Intent } from "./policy";
import type { EvidenceBundle, FactKind, Language } from "./types";

export function describeBundle(bundle: EvidenceBundle, lang: Language, requiredKinds: string[]): string {
  const lines = bundle.facts.map((f) => {
    if (f.kind === "clause") {
      const c = f.clause;
      return `${f.id} [clause] Clause ${c.number} "${c.heading}", version ${c.version}, effective ${formatDate(c.effective_from, "English")}: ${c.text}`;
    }
    return `${f.id} [${f.kind}] ${renderFact(f, lang)}`;
  });
  return [
    `Today is ${formatDate(bundle.asOf, "English")}.`,
    lines.length ? "Evidence (use these ids only):\n" + lines.join("\n") : "Evidence: none was found.",
    requiredKinds.length ? `Required fact kinds when present: ${requiredKinds.join(", ")}.` : "",
  ].filter(Boolean).join("\n");
}

/** The fact kinds the draft prompt names as required: the intent's own kinds, plus claim_match whenever the evidence holds one.
 *  The verifier's evidence layer demands the same set (a payment claim must be answered through its claim_match fact), so the
 *  prompt and the check can no longer disagree. Before this the model was told only "balance", answered the balance, and was
 *  rejected for leaving out the claim_match fact: a wasted first attempt on every payment-claim message. */
export function draftRequiredKinds(intent: Intent, bundle: EvidenceBundle): FactKind[] {
  const base = REQUIRED_KINDS[intent];
  return bundle.facts.some((f) => f.kind === "claim_match") && !base.includes("claim_match") ? [...base, "claim_match"] : base;
}
