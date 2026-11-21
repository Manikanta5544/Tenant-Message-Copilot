import { describe, expect, it } from "vitest";
import { assertPaise, deriveBalance, endOfPeriod, formatInr, rupeesToPaise } from "../core/money";
import type { LedgerLine } from "../core/types";

const line = (id: string, entry_type: LedgerLine["entry_type"], amount_paise: number, occurred_on: string): LedgerLine =>
  ({ id, entry_type, amount_paise, description: id, occurred_on, external_reference: null });

describe("money", () => {
  it("formats paise with Indian grouping", () => {
    expect(formatInr(1200000)).toBe("₹12,000");
    expect(formatInr(1735000)).toBe("₹17,350");
    expect(formatInr(10000000)).toBe("₹1,00,000");
    expect(formatInr(1735050)).toBe("₹17,350.50");
    expect(formatInr(0)).toBe("₹0");
    expect(formatInr(-50000)).toBe("-₹500");
  });
  it("rejects non-integer paise", () => {
    expect(() => assertPaise(10.5)).toThrow();
    expect(() => formatInr(0.1 + 0.2)).toThrow();
    expect(rupeesToPaise(8000)).toBe(800000);
  });
  it("derives the Scenario 2 balance: 20,000 rent less 8,000 settled", () => {
    const b = deriveBalance([line("c", "charge", 2000000, "2026-11-01"), line("p", "payment", -800000, "2026-11-12")], "2026-11-19");
    expect(b.balance_paise).toBe(1200000);
    expect(b.charges_paise).toBe(2000000);
    expect(b.payments_paise).toBe(-800000);
  });
  it("excludes lines after asOf and applies reversals as new positive entries", () => {
    const lines = [line("c", "charge", 1500000, "2026-11-01"), line("p", "payment", -500000, "2026-11-02"), line("r", "reversal", 500000, "2026-11-06"), line("f", "fee", 35000, "2026-12-01")];
    expect(deriveBalance(lines, "2026-11-19").balance_paise).toBe(1500000);
    expect(deriveBalance(lines, "2026-11-04").balance_paise).toBe(1000000);
    expect(deriveBalance(lines, "2026-12-01").balance_paise).toBe(1535000);
  });
  it("rejects entries with an impossible sign", () => {
    expect(() => deriveBalance([line("x", "payment", 100, "2026-11-01")], "2026-11-19")).toThrow(/invalid sign/);
    expect(() => deriveBalance([line("x", "charge", -100, "2026-11-01")], "2026-11-19")).toThrow(/invalid sign/);
  });
  it("computes period ends", () => {
    expect(endOfPeriod("2026-02")).toBe("2026-02-28");
    expect(endOfPeriod("2026-11")).toBe("2026-11-30");
    expect(() => endOfPeriod("2026-13")).toThrow();
  });
});
