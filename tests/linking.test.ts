import { describe, expect, it } from "vitest";
import { linkState } from "../app/lib/evidence";
import type { Fact } from "../core/types";

const balance = { id: "F1", kind: "balance", balance_paise: 1200000, as_of: "2026-11-19", crosscheck: { agree: true, ts_paise: 1200000, sql_paise: 1200000 },
  lines: [{ id: "L1", occurred_on: "2026-11-01", entry_type: "charge", amount_paise: 2000000, description: "Rent", external_reference: null }, { id: "L2", occurred_on: "2026-11-12", entry_type: "payment", amount_paise: -800000, description: "UPI", external_reference: "UPI-A101-5521" }] } as unknown as Fact;
const payment = { id: "F2", kind: "payment", reference: "UPI-A101-5521", state: "settled", amount_paise: 800000 } as unknown as Fact;
const clause = { id: "F3", kind: "clause" } as unknown as Fact;
const facts = [balance, payment, clause];

describe("footnote and ledger linking is two-way", () => {
  it("nothing hovered: nothing highlighted", () => {
    const l = linkState(facts, null, null);
    expect([l.ids.size, l.lineIds.size, l.total]).toEqual([0, 0, false]);
  });
  it("a payment footnote highlights its card and the ledger row with the same reference", () => {
    const l = linkState(facts, "F2", null);
    expect([...l.ids]).toEqual(["F2"]);
    expect([...l.lineIds]).toEqual(["L2"]);
  });
  it("the balance footnote highlights its card and the total row", () => {
    const l = linkState(facts, "F1", null);
    expect(l.ids.has("F1")).toBe(true); expect(l.total).toBe(true); expect(l.lineIds.size).toBe(0);
  });
  it("a ledger row highlights the footnotes that cite it (the balance and the matching payment)", () => {
    const l = linkState(facts, null, "L2");
    expect([...l.ids].sort()).toEqual(["F1", "F2"]);
    expect([...l.lineIds]).toEqual(["L2"]);
  });
  it("a ledger row with no payment reference highlights only the balance footnote", () => {
    expect([...linkState(facts, null, "L1").ids]).toEqual(["F1"]);
  });
  it("a clause footnote has no ledger counterpart", () => {
    const l = linkState(facts, "F3", null);
    expect([l.lineIds.size, l.total]).toEqual([0, false]);
  });
});
