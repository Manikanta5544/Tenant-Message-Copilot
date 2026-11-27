import { describe, expect, it } from "vitest";
import { FactIds, buildClaimMatch, clauseAppliesOn, effectiveAsOf, renderDraft } from "../core/facts";
import { ASOF, LEASE, RES, clause, events } from "./fixtures";

const ctx = { residentId: RES, leaseId: LEASE, asOf: ASOF };
const match = (c: Parameters<typeof buildClaimMatch>[3]) => buildClaimMatch(new FactIds(), ctx, events, c);

describe("claim matching", () => {
  it("matches amount and date to a settled posting", () => {
    const m = match({ amount_paise: 800000, date: "2026-11-12", reference: null });
    expect(m.matched).toBe(true);
    expect(m.matched_reference).toBe("UPI-A101-5521");
    expect(m.matched_posted).toBe(true);
  });
  it("matches a pending event that is not a ledger posting", () => {
    const m = match({ amount_paise: 800000, date: "2026-11-18", reference: null });
    expect(m.matched_reference).toBe("UPI-A101-PEND");
    expect(m.matched_state).toBe("pending");
    expect(m.matched_posted).toBe(false);
  });
  it("matches by reference regardless of state, case-insensitively", () => {
    expect(match({ amount_paise: null, date: null, reference: "upi-a101-fail" }).matched_state).toBe("failed");
  });
  it("a claimed reference must agree with the claimed amount and date, else it is unmatched and the reference is listed as near (S2)", () => {
    const wrongAmount = match({ amount_paise: 500000, date: null, reference: "UPI-A101-5521" });
    expect(wrongAmount.matched).toBe(false);
    expect(wrongAmount.matched_reference).toBeNull();
    expect(wrongAmount.near_references).toContain("UPI-A101-5521");
    const wrongDate = match({ amount_paise: 800000, date: "2026-10-01", reference: "UPI-A101-5521" });
    expect(wrongDate.matched).toBe(false);
    expect(wrongDate.near_references[0]).toBe("UPI-A101-5521");
    const agrees = match({ amount_paise: 800000, date: "2026-11-13", reference: "UPI-A101-5521" });
    expect(agrees.matched).toBe(true);
    expect(agrees.matched_reference).toBe("UPI-A101-5521");
    expect(agrees.near_references).not.toContain("UPI-A101-5521");
  });
  it("reports no match for an amount nobody paid, with near matches listed", () => {
    const m = match({ amount_paise: 2000000, date: "2026-11-18", reference: null });
    expect(m.matched).toBe(false);
    expect(m.matched_reference).toBeNull();
    expect(m.near_references).toContain("UPI-A101-PEND");
  });
  it("never matches a duplicate row and does not match outside the date window", () => {
    expect(match({ amount_paise: 800000, date: "2026-10-01", reference: null }).matched).toBe(false);
  });
});

describe("clause validity window", () => {
  const c = clause({ effective_from: "2026-07-01", effective_to: "2026-10-01" });
  it("is inclusive at the start and exclusive at the end", () => {
    expect(clauseAppliesOn(c, "2026-06-30")).toBe(false);
    expect(clauseAppliesOn(c, "2026-07-01")).toBe(true);
    expect(clauseAppliesOn(c, "2026-09-30")).toBe(true);
    expect(clauseAppliesOn(c, "2026-10-01")).toBe(false);
  });
  it("an open-ended clause applies from its start onward", () => {
    expect(clauseAppliesOn(clause({ effective_to: null }), "2030-01-01")).toBe(true);
  });
});

describe("effective as-of", () => {
  it("caps the period at the as-of date", () => {
    expect(effectiveAsOf("2026-11-19", "2026-10")).toBe("2026-10-31");
    expect(effectiveAsOf("2026-11-19", "2026-12")).toBe("2026-11-19");
    expect(effectiveAsOf("2026-11-19", null)).toBe("2026-11-19");
  });
});

describe("text after a quoted clause", () => {
  it("drops a stray leading period and space, but keeps text after other segments untouched", () => {
    const bundle = { residentId: "r", leaseId: "l", asOf: "2026-11-19", facts: [{ id: "C1", kind: "clause", clause: { id: "c", number: 4, version: 1, heading: "h", text: "Pets are not allowed.", effective_from: "2026-01-01", effective_to: null } }] } as never;
    const out = renderDraft({ language: "English", segments: [{ type: "text", text: "Your lease says: " }, { type: "quote", id: "C1" }, { type: "text", text: ". A property manager will review this reply." }, { type: "text", text: ". Second." }], suggested_route: "draft_ready" } as never, bundle);
    expect(out[2]!.text).toBe("A property manager will review this reply.");
    expect(out[3]!.text).toBe(". Second.");
    expect(out[0]!.text).toBe("Your lease says: ");
  });
});
