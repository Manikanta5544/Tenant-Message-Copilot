import { describe, expect, it } from "vitest";
import { getInboxSnapshot, setInboxSnapshot } from "../app/lib/inbox-snapshot";
import type { InboxRow } from "../app/lib/types";

describe("inbox snapshot for the command palette", () => {
  it("starts empty and returns what the page last loaded, so the palette has messages the moment it opens", () => {
    expect(getInboxSnapshot()).toEqual([]);
    const rows = [{ message_id: "m1" }] as unknown as InboxRow[];
    setInboxSnapshot(rows);
    expect(getInboxSnapshot()).toBe(rows);
  });
});
