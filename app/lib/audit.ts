import type { InboxRow, ReviewRow } from "./types";

export interface AuditLine { time: string; message_id: string; resident: string; unit: string; run_id: string; action: string; words_changed: number | null; edited_text: string }
const CSV_COLS: (keyof AuditLine)[] = ["time", "resident", "unit", "message_id", "run_id", "action", "words_changed", "edited_text"];

/** A cell that starts with = + - @ or a control character would be run as a formula by a spreadsheet; a leading apostrophe keeps it text. */
export const csvCell = (v: unknown): string => {
  let t = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\n\r]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
};
export function auditLines(items: { row: Pick<InboxRow, "message_id" | "resident_name" | "unit">; reviews: ReviewRow[]; wordsChanged?: (r: ReviewRow) => number | null }[]): AuditLine[] {
  return items.flatMap(({ row, reviews, wordsChanged }) => reviews.map((r) => ({ time: r.created_at, message_id: row.message_id, resident: row.resident_name, unit: row.unit, run_id: r.run_id, action: r.action, words_changed: r.action === "edited" ? (wordsChanged?.(r) ?? null) : null, edited_text: r.edited_text ?? "" })))
    .sort((a, b) => a.time.localeCompare(b.time));
}
export const toCsv = (lines: AuditLine[]) => [CSV_COLS.join(","), ...lines.map((l) => CSV_COLS.map((c) => csvCell(l[c])).join(","))].join("\r\n") + "\r\n";
export const toJson = (lines: AuditLine[]) => JSON.stringify({ note: "Review actions recorded by this browser session. Nothing was sent to any tenant.", exported_at: new Date().toISOString(), actions: lines }, null, 2);

/** Collects the visitor's review actions from the stored runs and downloads them. Everything happens in the browser. */
export async function exportAudit(rows: InboxRow[], format: "csv" | "json"): Promise<number> {
  const items: Parameters<typeof auditLines>[0] = [];
  for (const row of rows.filter((m) => m.run)) {
    try { const r = await fetch(`/api/runs/${row.run!.id}`); if (!r.ok) continue; const j = (await r.json()) as { reviews?: ReviewRow[] }; if (j.reviews?.length) items.push({ row, reviews: j.reviews }); } catch { /* skip */ }
  }
  const lines = auditLines(items);
  const body = format === "csv" ? toCsv(lines) : toJson(lines);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([body], { type: format === "csv" ? "text/csv;charset=utf-8" : "application/json" }));
  a.download = `review-log.${format}`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return lines.length;
}
