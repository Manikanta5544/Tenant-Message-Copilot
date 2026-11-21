// The text of the evidence bundle shown to the drafting and checking models: ids and values,
// never database ids. Contains only the run's own resident's facts.
import { formatDate, renderFact } from "./facts";
import type { EvidenceBundle, Language } from "./types";

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
