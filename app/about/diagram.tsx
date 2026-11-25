// Theme-aware plain SVG: strokes and fills come from the tokens through Tailwind classes. Hidden on phones, where the numbered list says the same.
// It is built as one static string and attached after hydration (DiagramMount), so React never hydrates the <svg> children that browser extensions such as
// Dark Reader rewrite. The markup is static and contains no user data.
const BOX = "fill-surface stroke-border-strong";
export function diagramSvg(): string {
  const boxes: [string, string, number, number, boolean][] = [
    ["Message", "tenant writes", 0, 0, false], ["Read", "language, intent, urgency", 1, 0, true], ["Evidence", "lease and ledger", 2, 0, false], ["Draft", "words and references", 3, 0, true],
    ["Verify", "six layers", 3, 1, false], ["Route", "most cautious signal", 2, 1, false], ["Manager", "approve or edit", 1, 1, false],
  ];
  const X = (c: number) => 8 + c * 180, Y = (r: number) => 8 + r * 96;
  const arrow = (x1: number, y1: number, x2: number, y2: number) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="stroke-border-strong" stroke-width="1.25" marker-end="url(#arr)"/>`;
  const g = boxes.map(([t, sub, c, r, model]) => `<g><rect x="${X(c)}" y="${Y(r)}" width="156" height="64" rx="6" class="${BOX}" stroke-width="1.25"${model ? ' stroke-dasharray="5 4"' : ""}/><text x="${X(c) + 12}" y="${Y(r) + 28}" class="fill-text" font-size="14" font-weight="600">${t}</text><text x="${X(c) + 12}" y="${Y(r) + 47}" class="fill-muted" font-size="11.5">${sub}</text></g>`).join("");
  const lines = [0, 1, 2].map((c) => arrow(X(c) + 156, Y(0) + 32, X(c + 1) - 3, Y(0) + 32)).join("") + arrow(X(3) + 78, Y(0) + 64, X(3) + 78, Y(1) - 3) + [3, 2].map((c) => arrow(X(c), Y(1) + 32, X(c - 1) + 159, Y(1) + 32)).join("");
  return `<svg role="img" aria-labelledby="dg-t dg-d" viewBox="0 0 736 200" class="h-auto w-full"><title id="dg-t">Pipeline diagram</title><desc id="dg-d">Message, read, evidence and draft run left to right. The draft goes down to verify, then right to left through route to the manager.</desc><defs><marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 8 4 0 8z" class="fill-border-strong"/></marker></defs>${g}${lines}</svg>`;
}
