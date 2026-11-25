import { describe, expect, it } from "vitest";
import { resetNote } from "../app/lib/reset-time";

describe("resetNote", () => {
  const now = new Date("2026-11-25T10:00:00Z");
  it("names the local time the limit lifts", () => {
    expect(resetNote(600, now, "UTC")).toBe(" You can try again at 10:10.");
    expect(resetNote("3600", now, "Asia/Calcutta")).toBe(" You can try again at 16:30.");
  });
  it("says nothing for a missing or invalid wait", () => {
    for (const v of [undefined, null, "x", 0, -5]) expect(resetNote(v, now, "UTC")).toBe("");
  });
});
