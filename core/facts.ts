// Evidence facts: built by code from database rows, referenced (never typed) by the model, and
// rendered by code. Pure: no clock, no database.
import { z } from "zod";
import { deriveBalance, endOfPeriod, formatInr, minDate, startOfPeriod } from "./money";
import {
  type BalanceFact, type ClaimMatchFact, type ClauseFact, type ClauseRow, type EvidenceBundle, type Fact, type FactKind,
  type IsoDate, type Language, type LeaseRow, type LeaseTermFact, type LedgerLine, type PaymentEventRow, type PaymentFact,
  LANGUAGES,
} from "./types";

// ---------- draft segments ----------
export const SegmentSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("text"), text: z.string().min(1).max(600) }),
  z.strictObject({ type: z.literal("fact"), id: z.string().regex(/^F\d{1,3}$/) }),
  z.strictObject({ type: z.literal("quote"), id: z.string().regex(/^C\d{1,3}$/) }),
]);
export type Segment = z.infer<typeof SegmentSchema>;

export const DraftSchema = z.strictObject({
  language: z.enum(LANGUAGES as [Language, ...Language[]]),
  segments: z.array(SegmentSchema).min(1).max(40),
});
export type Draft = z.infer<typeof DraftSchema>;

// ---------- fact construction ----------
export class FactIds {
  private f = 0;
  private c = 0;
  nextFact = () => `F${++this.f}`;
  nextClause = () => `C${++this.c}`;
}
export interface FactCtx { residentId: string; leaseId: string; asOf: IsoDate }

/** The date a balance or history is read as of: asOf, or the end of the requested YYYY-MM period. */
export const effectiveAsOf = (asOf: IsoDate, period?: string | null): IsoDate => (period ? minDate(asOf, endOfPeriod(period)) : asOf);

export function buildBalanceFact(ids: FactIds, ctx: FactCtx, lines: LedgerLine[], sqlBalance: number, period?: string | null): BalanceFact {
  const asOf = effectiveAsOf(ctx.asOf, period);
  const d = deriveBalance(lines, asOf);
  return {
    id: ids.nextFact(), kind: "balance", residentId: ctx.residentId, leaseId: ctx.leaseId, as_of: asOf,
    balance_paise: d.balance_paise,
    breakdown: { charges_paise: d.charges_paise, fees_paise: d.fees_paise, payments_paise: d.payments_paise, reversals_paise: d.reversals_paise, adjustments_paise: d.adjustments_paise },
    lines: lines.filter((l) => l.occurred_on <= asOf),
    crosscheck: { ts_paise: d.balance_paise, sql_paise: sqlBalance, agree: d.balance_paise === sqlBalance },
  };
}

export function buildPaymentFacts(ids: FactIds, ctx: FactCtx, events: PaymentEventRow[], period?: string | null): PaymentFact[] {
  return events
    .filter((e) => e.received_on <= ctx.asOf && (!period || (e.received_on >= startOfPeriod(period) && e.received_on <= endOfPeriod(period))))
    .sort((a, b) => a.received_on.localeCompare(b.received_on) || a.reference.localeCompare(b.reference))
    .map((e) => ({
      id: ids.nextFact(), kind: "payment" as const, residentId: ctx.residentId, leaseId: ctx.leaseId,
      reference: e.reference, amount_paise: e.amount_paise, state: e.state, received_on: e.received_on,
      is_duplicate: e.is_duplicate, posted: e.posted, reversed: e.reversed, note: e.note,
    }));
}

export function buildLeaseTermFacts(ids: FactIds, ctx: FactCtx, lease: LeaseRow): LeaseTermFact[] {
  const mk = (term: LeaseTermFact["term"], value: number): LeaseTermFact => ({
    id: ids.nextFact(), kind: "lease_term", residentId: ctx.residentId, leaseId: ctx.leaseId, term, value,
  });
  return [mk("rent", lease.rent_paise), mk("due_day", lease.due_day), mk("grace_days", lease.grace_days), mk("deposit", lease.deposit_paise)];
}

/** A clause applies on d when effective_from <= d and (effective_to is null or d < effective_to). */
export const clauseAppliesOn = (c: ClauseRow, d: IsoDate): boolean => c.effective_from <= d && (c.effective_to === null || d < c.effective_to);

export function buildClauseFacts(ids: FactIds, ctx: FactCtx, clauses: ClauseRow[]): ClauseFact[] {
  return clauses.filter((c) => clauseAppliesOn(c, ctx.asOf)).map((clause) => ({
    id: ids.nextClause(), kind: "clause" as const, residentId: ctx.residentId, leaseId: ctx.leaseId, clause,
  }));
}

export interface Claim { amount_paise: number | null; date: IsoDate | null; reference: string | null }
const dayDiff = (a: IsoDate, b: IsoDate) => Math.abs(Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86_400_000;
const MATCH_WINDOW_DAYS = 3;

/** Matches what the tenant says they paid against raw payment events (any state), never against the ledger alone. */
export function buildClaimMatch(ids: FactIds, ctx: FactCtx, events: PaymentEventRow[], claim: Claim): ClaimMatchFact {
  const live = events.filter((e) => !e.is_duplicate && e.received_on <= ctx.asOf);
  let hit: PaymentEventRow | undefined;
  // A reference alone is not a match: when the tenant also states an amount or a date, they must agree with that payment, otherwise
  // "ref X, paid 5,000" would be verified against a payment of a different amount. The mismatch is reported as unmatched, with the reference
  // listed under near_references so the reviewer sees what it pointed at.
  const byRef = claim.reference ? live.find((e) => e.reference.toLowerCase() === claim.reference!.toLowerCase()) : undefined;
  if (claim.reference) {
    if (byRef && (claim.amount_paise === null || byRef.amount_paise === claim.amount_paise) && (!claim.date || dayDiff(byRef.received_on, claim.date) <= MATCH_WINDOW_DAYS)) hit = byRef;
  } else if (claim.amount_paise !== null) {
    const cands = live.filter((e) => e.amount_paise === claim.amount_paise && (!claim.date || dayDiff(e.received_on, claim.date) <= MATCH_WINDOW_DAYS));
    cands.sort((a, b) => (claim.date ? dayDiff(a.received_on, claim.date) - dayDiff(b.received_on, claim.date) : 0) || b.received_on.localeCompare(a.received_on));
    hit = cands[0];
  }
  const near = [...(byRef && byRef !== hit ? [byRef] : []), ...live.filter((e) => e !== byRef)]
    .filter((e) => e !== hit && (e === byRef || (claim.amount_paise !== null && e.amount_paise === claim.amount_paise) || (claim.date && dayDiff(e.received_on, claim.date) <= MATCH_WINDOW_DAYS)))
    .slice(0, 3).map((e) => e.reference);
  return {
    id: ids.nextFact(), kind: "claim_match", residentId: ctx.residentId, leaseId: ctx.leaseId,
    matched: !!hit, claimed: claim, matched_reference: hit?.reference ?? null, matched_state: hit?.state ?? null,
    matched_posted: hit ? hit.posted : null, near_references: near,
  };
}

export const kindsIn = (b: EvidenceBundle): Set<FactKind> => new Set(b.facts.map((f) => f.kind));
export const factById = (b: EvidenceBundle, id: string): Fact | undefined => b.facts.find((f) => f.id === id);

// ---------- rendering ----------
const LOCALE: Record<Language, string> = { English: "en-IN", Hinglish: "en-IN", Hindi: "hi-IN", Telugu: "te-IN" };
export function formatDate(iso: IsoDate, lang: Language): string {
  return new Intl.DateTimeFormat(LOCALE[lang], { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso + "T00:00:00Z"));
}
const ordinalEn = (n: number) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!); };

const T: Record<Language, { pending: string; settled: string; failed: string; duplicate: string; reversed: string; none: string; ref: string; days: string; due: (n: number) => string; adj: Record<"pending" | "settled" | "failed", string>; found: (adj: string, ref: string) => string }> = {
  English: { pending: "pending", settled: "settled", failed: "failed", duplicate: "duplicate entry", reversed: "reversed", none: "We could not find a payment matching what you described.", ref: "ref", days: "days", due: ordinalEn, adj: { pending: "pending", settled: "settled", failed: "failed" }, found: (a, r) => `We also see a ${a} payment with reference ${r}.` },
  Hinglish: { pending: "pending", settled: "settled", failed: "failed", duplicate: "duplicate entry", reversed: "reversed", none: "Aapne jis payment ka zikr kiya, woh hamein nahi mila.", ref: "ref", days: "din", due: (n) => `${n} tareekh`, adj: { pending: "pending", settled: "settled", failed: "failed" }, found: (a, r) => `Hamein reference ${r} ka ek ${a} payment bhi dikh raha hai.` },
  Hindi: { pending: "लंबित", settled: "सफल", failed: "विफल", duplicate: "डुप्लिकेट प्रविष्टि", reversed: "वापस किया गया", none: "आपने जिस भुगतान का उल्लेख किया, वह हमें नहीं मिला।", ref: "संदर्भ", days: "दिन", due: (n) => `${n} तारीख`, adj: { pending: "लंबित", settled: "सफल", failed: "विफल" }, found: (a, r) => `हमें संदर्भ ${r} वाला एक ${a} भुगतान भी दिख रहा है।` },
  Telugu: { pending: "పెండింగ్", settled: "పూర్తయింది", failed: "విఫలమైంది", duplicate: "డూప్లికేట్ ఎంట్రీ", reversed: "రివర్స్ చేయబడింది", none: "మీరు చెప్పిన చెల్లింపు మాకు కనబడలేదు.", ref: "ref", days: "రోజులు", due: (n) => `${n}వ తేదీ`, adj: { pending: "పెండింగ్‌లో ఉన్న", settled: "పూర్తయిన", failed: "విఫలమైన" }, found: (a, r) => `${r} రిఫరెన్స్‌తో ${a} చెల్లింపు కూడా మాకు కనిపిస్తోంది.` },
};

/** Version of the rendered fact wording (the sentence templates above). Bump it when any template changes: stored baselines record the
 *  version that produced them, and `npm run doctor` flags older ones (refresh with `npm run seed -- --refresh`). */
export const TEMPLATE_VERSION = "t2";

export function renderFact(f: Fact, lang: Language): string {
  const t = T[lang];
  switch (f.kind) {
    case "balance": return formatInr(f.balance_paise);
    case "payment": {
      const flags = [t[f.state], f.is_duplicate ? t.duplicate : null, f.reversed ? t.reversed : null].filter(Boolean).join(", ");
      return `${formatInr(f.amount_paise)} (${t.ref} ${f.reference}, ${formatDate(f.received_on, lang)}, ${flags})`;
    }
    case "lease_term":
      if (f.term === "rent" || f.term === "deposit") return formatInr(f.value);
      if (f.term === "due_day") return t.due(f.value);
      return `${f.value} ${t.days}`;
    case "claim_match":
      return f.matched ? t.found(t.adj[f.matched_state as "pending" | "settled" | "failed"], f.matched_reference!) : t.none;
    case "clause": return f.clause.text;
  }
}

export interface RenderedSegment {
  type: "text" | "fact" | "quote";
  text: string;
  refId?: string;
  kind?: FactKind;
  /** Short citation for a quote chip, e.g. "Clause 3, version 2, effective 1 Jul 2026". */
  cite?: string;
}

/** A quote or a claim-check sentence already ends with its own punctuation, so a model's leading ". " after it is dropped. */
function tidyAfter(prev: Draft["segments"][number] | undefined, text: string, bundle: EvidenceBundle): string {
  if (!prev || prev.type === "text") return text;
  if (prev.type === "quote") return text.replace(/^[\s.,;:!?।]+/u, "");
  if (factById(bundle, prev.id)?.kind !== "claim_match") return text;
  const rest = text.replace(/^[\s.,;:!?।]+/u, "");
  return rest ? " " + rest : "";
}

export function renderDraft(draft: Draft, bundle: EvidenceBundle, lang: Language = draft.language): RenderedSegment[] {
  return draft.segments.map((s, i): RenderedSegment => {
    // A quoted clause already ends with its own punctuation and sits on its own line: a model's ". Next sentence" after it
    // would show a stray leading mark, so punctuation (and surrounding space) at the start of the following text is dropped.
    if (s.type === "text") return { type: "text", text: tidyAfter(draft.segments[i - 1], s.text, bundle) };
    const f = factById(bundle, s.id);
    if (!f) throw new Error(`unknown reference ${s.id}`);
    if (s.type === "quote") {
      if (f.kind !== "clause") throw new Error(`${s.id} is not a clause`);
      return { type: "quote", text: `“${f.clause.text}”`, refId: s.id, kind: "clause",
        cite: `Clause ${f.clause.number}, version ${f.clause.version}, effective ${formatDate(f.clause.effective_from, "English")}` };
    }
    if (f.kind === "clause") throw new Error(`${s.id} is a clause, not a fact`);
    return { type: "fact", text: renderFact(f, lang), refId: s.id, kind: f.kind };
  });
}
export const renderPlain = (r: RenderedSegment[]): string => r.map((s) => s.text).join("");
