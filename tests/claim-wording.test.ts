import { describe, expect, it } from "vitest";
import { renderDraft, renderFact, renderPlain, type Draft } from "../core/facts";
import type { EvidenceBundle } from "../core/types";

const langs = ["English", "Hinglish", "Hindi", "Telugu"] as const;
const claim = (o: object) => ({ id: "F9", kind: "claim_match", claimed: { amount_paise: 850000, date: null, reference: null }, matched: false, matched_reference: null, matched_state: null, matched_posted: null, near_references: [], ...o }) as never;
const matched = (state: string) => claim({ matched: true, matched_reference: "UPI-A101-5521", matched_state: state });

describe("claim-check wording is a complete clause in every language", () => {
  for (const lang of langs) {
    for (const state of ["settled", "pending", "failed"]) {
      it(`${lang} / matched ${state}`, () => {
        const t = renderFact(matched(state), lang);
        expect(t).toContain("UPI-A101-5521");
        expect(t).toMatch(/[.।]$/u);       // ends as a sentence
        expect(t).not.toMatch(/:|\(|\)/);  // no "label: value (state)" fragment
      });
    }
    it(`${lang} / no match`, () => {
      const t = renderFact(claim({}), lang);
      expect(t).toMatch(/[.।]$/u);
      expect(t).not.toMatch(/\d/); // no numbers invented
    });
  }

  it("text after a claim sentence gets no stray punctuation and keeps a space", () => {
    const bundle = { asOf: "2026-07-15", facts: [matched("settled")] } as unknown as EvidenceBundle;
    const d: Draft = { language: "English", segments: [{ type: "text", text: "Hello. " }, { type: "fact", id: "F9" }, { type: "text", text: ". A manager will review this." }] };
    expect(renderPlain(renderDraft(d, bundle))).toBe("Hello. We also see a settled payment with reference UPI-A101-5521. A manager will review this.");
  });
});
