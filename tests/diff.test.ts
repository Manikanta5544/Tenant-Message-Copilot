import { describe, expect, it } from "vitest";
import { changeSentence, diffWords, summarizeDiff } from "../app/lib/diff";

const rebuild = (ops: ReturnType<typeof diffWords>, side: "before" | "after") => ops.filter((o) => o.type === "same" || o.type === (side === "before" ? "del" : "ins")).map((o) => o.text).join("");

describe("word diff", () => {
  it("identical text is one 'same' run", () => {
    expect(diffWords("Hello there", "Hello there")).toEqual([{ type: "same", text: "Hello there" }]);
    expect(changeSentence("Hello there", "Hello there")).toBe("no wording changed");
  });
  it("insert", () => {
    const ops = diffWords("We will check", "We will check again soon");
    expect(summarizeDiff(ops)).toEqual({ added: 2, removed: 0, changed: 2 });
    expect(rebuild(ops, "after")).toBe("We will check again soon");
  });
  it("delete", () => {
    const ops = diffWords("We will check again soon", "We will check");
    expect(summarizeDiff(ops)).toEqual({ added: 0, removed: 2, changed: 2 });
    expect(rebuild(ops, "before")).toBe("We will check again soon");
  });
  it("a replaced word counts as one changed word", () => {
    const ops = diffWords("Please pay by Friday", "Please pay by Monday");
    expect(summarizeDiff(ops)).toEqual({ added: 1, removed: 1, changed: 1 });
    expect(changeSentence("Please pay by Friday", "Please pay by Monday")).toBe("1 word changed");
  });
  it("two replacements", () => {
    expect(changeSentence("A manager will call today", "The manager will call tomorrow")).toBe("2 words changed");
  });
  it("both sides can always be rebuilt exactly (whitespace preserved)", () => {
    const a = "Dear  Priya,\nThank you for writing.", b = "Dear Priya,\nThanks for writing to us.";
    const ops = diffWords(a, b);
    expect(rebuild(ops, "before")).toBe(a);
    expect(rebuild(ops, "after")).toBe(b);
  });
  it("Hindi: words with combining marks are never split", () => {
    const a = "हम आपके भुगतान की जांच करेंगे।", b = "हम आपके भुगतान की दोबारा जांच करेंगे।";
    const ops = diffWords(a, b);
    expect(ops.filter((o) => o.type === "ins").map((o) => o.text.trim())).toEqual(["दोबारा"]);
    expect(rebuild(ops, "after")).toBe(b);
  });
  it("Telugu", () => {
    const a = "మీ చెల్లింపు మాకు కనబడలేదు.", b = "మీ చెల్లింపు మాకు ఇంకా కనబడలేదు.";
    expect(changeSentence(a, b)).toBe("1 word changed");
    expect(rebuild(diffWords(a, b), "before")).toBe(a);
  });
  it("unicode punctuation and emoji tokens", () => {
    const ops = diffWords("Thanks ₹8,000 ✅", "Thanks ₹8,000");
    expect(summarizeDiff(ops).removed).toBe(1);
  });
  it("empty inputs", () => {
    expect(diffWords("", "")).toEqual([]);
    expect(summarizeDiff(diffWords("", "new words"))).toEqual({ added: 2, removed: 0, changed: 2 });
  });
});
