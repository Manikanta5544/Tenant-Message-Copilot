import { describe, expect, it } from "vitest";
import { renderDraft, renderPlain } from "../core/facts";
import { layer1Schema, layer2Evidence, layer3Exactness } from "../core/verifier";
import { ASOF, RES, bundle } from "./fixtures";

const ctx = { residentId: RES, asOf: ASOF, requiredKinds: [] as never[] };
const draft = (segments: unknown[], language = "English") => layer1Schema({ language, segments }).draft!;
const T = (text: string) => ({ type: "text", text });
const F = (id: string) => ({ type: "fact", id });
const Q = (id: string) => ({ type: "quote", id });

describe("layer 1: schema", () => {
  it("accepts text, fact and quote segments", () => {
    expect(layer1Schema({ language: "English", segments: [T("Hello "), F("F1"), Q("C1")] }).result.ok).toBe(true);
  });
  it.each([
    ["extra key", { language: "English", segments: [T("x")], note: "hi" }],
    ["unknown segment type", { language: "English", segments: [{ type: "number", value: 5 }] }],
    ["bad id", { language: "English", segments: [F("12000")] }],
    ["empty segments", { language: "English", segments: [] }],
    ["unknown language", { language: "French", segments: [T("x")] }],
    ["not an object", "hello"],
    ["fact with extra text", { language: "English", segments: [{ type: "fact", id: "F1", text: "₹12,000" }] }],
  ])("rejects %s with a retry", (_n, raw) => {
    const r = layer1Schema(raw).result;
    expect(r.ok).toBe(false);
    expect(r.effect).toBe("retry");
  });
});

describe("layer 2: evidence", () => {
  const b = bundle();
  it("passes references that exist, belong to the resident and apply", () => {
    expect(layer2Evidence(draft([T("a "), F("F1"), T(" b "), Q("C1")]), b, ctx).ok).toBe(true);
  });
  it("rejects unknown ids", () => {
    const r = layer2Evidence(draft([F("F99")]), b, ctx);
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toMatch(/not in this run's evidence bundle/);
  });
  it("rejects duplicate references", () => {
    expect(layer2Evidence(draft([F("F1"), T(" and "), F("F1")]), b, ctx).issues.join()).toMatch(/more than once/);
  });
  it("rejects a fact belonging to another resident", () => {
    const foreign = bundle();
    foreign.facts[0] = { ...foreign.facts[0]!, residentId: "res-302" };
    expect(layer2Evidence(draft([F("F1")]), foreign, ctx).issues.join()).toMatch(/does not belong to this resident/);
  });
  it("rejects a quote of a non-clause and a fact segment pointing at a clause", () => {
    // In the fixture, C1 is a clause and F1 a balance; the id regexes keep the kinds apart, so test the kind check directly.
    const bad = { language: "English" as const, segments: [{ type: "quote" as const, id: "C1" }] };
    const tampered = bundle();
    tampered.facts = tampered.facts.map((f) => (f.id === "C1" ? { ...tampered.facts[0]!, id: "C1" } : f));
    expect(layer2Evidence(bad, tampered, ctx).issues.join()).toMatch(/not a clause/);
  });
  it("rejects a clause that does not apply on the as-of date", () => {
    const expired = bundle(1200000, { effective_to: "2026-06-01" });
    // an expired clause is dropped at build time, so C1 is not in the bundle at all
    expect(layer2Evidence(draft([Q("C1")]), expired, ctx).ok).toBe(false);
    // and if one slips into the bundle, the verifier still refuses it
    const slipped = bundle();
    const c = slipped.facts.find((f) => f.id === "C1")!;
    if (c.kind === "clause") c.clause = { ...c.clause, effective_to: "2026-06-01" };
    expect(layer2Evidence(draft([Q("C1")]), slipped, ctx).issues.join()).toMatch(/does not apply/);
  });
  it("requires the fact kinds the intent needs when the bundle has them", () => {
    const need = { ...ctx, requiredKinds: ["balance", "payment"] as never[] };
    expect(layer2Evidence(draft([T("Nothing cited")]), b, need).issues.length).toBe(2);
    expect(layer2Evidence(draft([F("F1"), F("F2")]), b, need).ok).toBe(true);
  });
  it("does not demand a kind the bundle lacks (that is the abstention layer's job)", () => {
    const empty = { ...b, facts: b.facts.filter((f) => f.kind !== "clause") };
    expect(layer2Evidence(draft([T("holding reply")]), empty, { ...ctx, requiredKinds: ["clause"] as never[] }).ok).toBe(true);
  });
});

describe("layer 3: exactness", () => {
  const b = bundle();
  it("passes clean connective text", () => {
    expect(layer3Exactness(draft([T("Your balance is "), F("F1"), T(", after the payment on record.")]), b).ok).toBe(true);
  });
  it.each([
    ["a digit", "Your balance is 12000"],
    ["a currency symbol", "You owe ₹ now"],
    ["a number word", "You paid eight thousand"],
    ["a month", "paid in November"],
  ])("rejects %s in model text with one retry", (_n, text) => {
    const r = layer3Exactness(draft([T(text)]), b);
    expect(r.ok).toBe(false);
    expect(r.effect).toBe("retry");
    expect(r.critical).toBeFalsy();
  });
  it("blocks and flags a critical incident when TypeScript and SQL balances disagree", () => {
    const r = layer3Exactness(draft([F("F1")]), bundle(1199999));
    expect(r.ok).toBe(false);
    expect(r.effect).toBe("block");
    expect(r.critical).toBe(true);
  });
});

describe("rendering", () => {
  const b = bundle();
  it("renders values and exact clause text from the bundle, never from the model", () => {
    const settled = b.facts.find((f) => f.kind === "payment" && f.reference === "UPI-A101-5521" && !f.is_duplicate)!;
    const d = draft([T("Your balance is "), F("F1"), T(", after the payment "), F(settled.id), T(". Our policy: "), Q("C1")]);
    const plain = renderPlain(renderDraft(d, b));
    expect(plain).toContain("₹12,000");
    expect(plain).toContain("₹8,000 (ref UPI-A101-5521, 12 Nov 2026, settled)");
    expect(plain).toContain("“The landlord will acknowledge a maintenance request within 24 hours.”");
  });
  it("shows a pending payment as pending, in the tenant's language", () => {
    const pend = b.facts.find((f) => f.kind === "payment" && f.state === "pending")!;
    const plain = renderPlain(renderDraft(draft([F(pend.id)], "Hinglish"), b));
    expect(plain).toContain("pending");
    expect(plain).toContain("UPI-A101-PEND");
  });
  it("marks duplicates and shows failed payments as failed", () => {
    const dup = b.facts.find((f) => f.kind === "payment" && f.is_duplicate)!;
    expect(renderPlain(renderDraft(draft([F(dup.id)]), b))).toContain("duplicate entry");
    const failed = b.facts.find((f) => f.kind === "payment" && f.state === "failed")!;
    expect(renderPlain(renderDraft(draft([F(failed.id)]), b))).toContain("failed");
  });
});
