/** Word-level diff between the model's text and a manager's edit (longest common subsequence over whitespace-separated tokens).
 *  Unicode-safe: tokens are split on whitespace only, so Devanagari and Telugu words (which contain combining marks) are never cut. */
export type DiffOp = { type: "same" | "ins" | "del"; text: string };

const tokens = (s: string) => s.match(/\S+|\s+/gu) ?? [];

export function diffWords(before: string, after: string): DiffOp[] {
  const a = tokens(before), b = tokens(after);
  const n = a.length, m = b.length;
  // LCS table (texts are capped at 2000 characters by the edit guard, so this stays small).
  const t: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i]![j] = a[i] === b[j] ? t[i + 1]![j + 1]! + 1 : Math.max(t[i + 1]![j]!, t[i]![j + 1]!);
  const out: DiffOp[] = [];
  const push = (type: DiffOp["type"], text: string) => { const l = out.at(-1); if (l && l.type === type) l.text += text; else out.push({ type, text }); };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push("same", a[i]!); i++; j++; }
    else if (t[i + 1]![j]! >= t[i]![j + 1]!) push("del", a[i++]!);
    else push("ins", b[j++]!);
  }
  while (i < n) push("del", a[i++]!);
  while (j < m) push("ins", b[j++]!);
  return out;
}

const words = (s: string) => (s.match(/\S+/gu) ?? []).length;

/** Counts of words added, removed and changed. A replaced word counts once as "changed" (a group of adjacent deletions and insertions counts max(deleted, inserted)). */
export function summarizeDiff(ops: DiffOp[]): { added: number; removed: number; changed: number } {
  let added = 0, removed = 0, changed = 0, del = 0, ins = 0;
  const flush = () => { changed += Math.max(del, ins); del = 0; ins = 0; };
  for (const o of ops) {
    if (o.type === "same") { if (/\S/u.test(o.text)) flush(); continue; }
    const w = words(o.text);
    if (o.type === "del") { removed += w; del += w; } else { added += w; ins += w; }
  }
  flush();
  return { added, removed, changed };
}

/** "2 words changed", "1 word changed", "no wording changed". */
export function changeSentence(before: string, after: string): string {
  const { changed } = summarizeDiff(diffWords(before, after));
  return changed === 0 ? "no wording changed" : `${changed} ${changed === 1 ? "word" : "words"} changed`;
}
