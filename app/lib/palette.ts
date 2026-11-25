// Pure helpers for the command palette: what can be run, and how a typed query ranks them.
export interface Command { id: string; label: string; hint?: string; group: "Go to" | "Message" | "Action"; keywords?: string; run: () => void }

/** Case-insensitive; every word of the query must appear (in the label, hint or keywords). Earlier and label matches rank first. */
export function rank<T extends { label: string; hint?: string; keywords?: string }>(items: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  const scored: [number, number, T][] = [];
  items.forEach((it, i) => {
    const label = it.label.toLowerCase(), rest = `${it.hint ?? ""} ${it.keywords ?? ""}`.toLowerCase();
    let score = 0;
    for (const w of words) {
      const a = label.indexOf(w);
      if (a >= 0) score += a === 0 ? 0 : 1; else if (rest.includes(w)) score += 3; else return;
    }
    scored.push([score, i, it]);
  });
  return scored.sort((x, y) => x[0] - y[0] || x[1] - y[1]).map((x) => x[2]);
}
export const isPaletteKey = (e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }) => (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k";
