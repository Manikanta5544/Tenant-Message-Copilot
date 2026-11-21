// Golden-case schema. Expected results are structures (route, fact kinds and values, forbidden data,
// abstention, language), never reference text. Money values are resolved from SQL at eval time.
import { z } from "zod";

export const SqlRef = z.union([
  z.strictObject({ sql: z.literal("balance"), unit: z.string() }),
  z.strictObject({ sql: z.literal("event_amount"), reference: z.string() }),
]);
export type SqlRef = z.infer<typeof SqlRef>;
export const Value = z.union([z.number().int(), SqlRef]);
export type Value = z.infer<typeof Value>;

export const RequiredFact = z.strictObject({
  kind: z.enum(["balance", "payment", "lease_term", "clause", "claim_match"]),
  reference: z.string().optional(),          // payment / claim_match: the event reference
  value_paise: Value.optional(),             // balance / payment amount
  state: z.enum(["pending", "settled", "failed"]).optional(),
  is_duplicate: z.boolean().optional(),
  posted: z.boolean().optional(),
  reversed: z.boolean().optional(),
  matched: z.boolean().optional(),           // claim_match
  clause_number: z.number().int().optional(),
  clause_version: z.number().int().optional(),
});
export type RequiredFact = z.infer<typeof RequiredFact>;

export const CATEGORIES = [
  "lease_interpretation", "payment_reconciliation", "partial_duplicate", "maintenance",
  "adversarial", "abstention", "multilingual",
] as const;

export const Case = z.strictObject({
  id: z.string().regex(/^[a-z]+-\d{2}$/),
  category: z.enum(CATEGORIES),
  tier: z.union([z.literal(1), z.literal(2)]),
  unit: z.string(),                          // the sending resident, by apartment unit
  org: z.enum(["A", "B"]).default("A"),
  message: z.string().min(1).max(2000),
  expect: z.strictObject({
    route: z.enum(["draft_ready", "needs_review", "escalate_only"]),
    acceptable_routes: z.array(z.enum(["draft_ready", "needs_review", "escalate_only"])).optional(),
    language: z.enum(["English", "Hinglish", "Hindi", "Telugu"]),
    abstain: z.boolean(),                    // true: the reply must carry no fact or quote segments
    required_facts: z.array(RequiredFact),
    forbidden: z.strictObject({
      // Another resident's figures or identity. Checked in the reply, facts, tool results and trace.
      values_paise: z.array(Value).default([]),
      resident_units: z.array(z.string()).default([]),
      // Checked in the rendered reply text only.
      strings: z.array(z.string()).default([]),
      // No balance fact in the reply may equal any of these.
      balance_paise: z.array(z.number().int()).default([]),
    }),
  }),
  notes: z.string().optional(),
});
export type Case = z.infer<typeof Case>;
export const CaseFile = z.array(Case);
