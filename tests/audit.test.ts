import { describe, expect, it } from "vitest";
import { auditLines, csvCell, toCsv, toJson } from "../app/lib/audit";

const row = { message_id: "m1", resident_name: 'Ravi "R" Menon', unit: "B-204" };
const rv = (id: string, action: "approved" | "edited" | "regenerated", at: string, text: string | null = null) => ({ id, run_id: "r1", action, edited_text: text, created_at: at });

describe("review audit export", () => {
  const lines = auditLines([{ row, reviews: [rv("2", "edited", "2026-11-24T11:26:00.000Z", "Hello, =SUM(A1)"), rv("1", "regenerated", "2026-11-24T11:23:00.000Z")], wordsChanged: () => 3 }]);
  it("orders by time and counts edited words only for edits", () => {
    expect(lines.map((l) => l.action)).toEqual(["regenerated", "edited"]);
    expect(lines.map((l) => l.words_changed)).toEqual([null, 3]);
  });
  it("CSV quotes commas, quotes and newlines, and defuses spreadsheet formulas", () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    for (const bad of ["=1+1", "+1", "-1", "@x"]) expect(csvCell(bad).startsWith("'")).toBe(true);
    const csv = toCsv(lines);
    expect(csv.split("\r\n")[0]).toBe("time,resident,unit,message_id,run_id,action,words_changed,edited_text");
    expect(csv).toContain('"Ravi ""R"" Menon"'); expect(csv).toContain('"Hello, =SUM(A1)"');
  });
  it("JSON says nothing was sent and carries every action", () => {
    const j = JSON.parse(toJson(lines));
    expect(j.note).toContain("Nothing was sent"); expect(j.actions).toHaveLength(2);
  });
});
