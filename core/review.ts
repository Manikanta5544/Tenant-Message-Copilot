// Validation of a manager's edited reply (decision D4). The edit is the manager's own wording, but it must clear the same
// connective-language guard as a model draft before it can be recorded as approved: no new numbers, amounts, dates
// or months, and no promises. Values that the code rendered from evidence (fact and quote segments of the original
// draft) may be kept verbatim; everything else is checked.
import { guardText } from "./guard";

export const MAX_EDIT_CHARS = 2000;

/** Commitments a manager must make personally, outside this tool. */
const PROMISE = /(?<![\p{L}\p{M}])(?:promise[sd]?|guarantee[sd]?|assure[sd]?|waive[sd]?|waiver granted|refund(?:ed|s)?|will (?:not|never) charge|no (?:late )?fee|compensat\w+|reimburs\w+|vaada|वादा|హామీ)(?![\p{L}\p{M}])/iu;

export type EditCheck = { ok: true } | { ok: false; reason: string };

export function checkEditedText(edited: string, renderedSegments: { type: string; text: string }[]): EditCheck {
  const text = edited.trim();
  if (!text) return { ok: false, reason: "The edited reply is empty." };
  if (text.length > MAX_EDIT_CHARS) return { ok: false, reason: `The edited reply is longer than ${MAX_EDIT_CHARS} characters.` };
  // Remove the evidence-rendered strings of the original draft (longest first) so their numbers and dates do not count as new.
  let rest = text;
  const allowed = renderedSegments.filter((s) => s.type !== "text" && s.text).map((s) => s.text).sort((a, b) => b.length - a.length);
  for (const a of allowed) rest = rest.split(a).join(" ");
  const v = guardText(rest)[0];
  if (v) return { ok: false, reason: `The edit introduces a ${v.category.replace("_", " ")} ("${v.match}") that is not from the evidence. Keep amounts and dates exactly as the draft shows them, or remove them.` };
  const p = PROMISE.exec(rest);
  if (p) return { ok: false, reason: `The edit makes a commitment ("${p[0]}"). Commitments need a manager's own decision outside this tool.` };
  return { ok: true };
}
