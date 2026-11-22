// Deterministic routing. The final route is the most cautious of every signal, so a model
// (or a verifier layer) can only make a run safer, never less safe.
import type { Intent } from "./policy";
import { REASON } from "./reasons";
import type { Route } from "./types";

export const ROUTE_RANK: Record<Route, number> = { draft_ready: 0, needs_review: 1, escalate_only: 2 };
export const moreCautious = (a: Route, b: Route): Route => (ROUTE_RANK[a] >= ROUTE_RANK[b] ? a : b);

export const INTENT_ROUTE: Record<Intent, Route> = {
  maintenance_request: "draft_ready",
  lease_question: "draft_ready",
  balance_question: "needs_review",
  payment_question: "needs_review",
  fee_waiver_request: "needs_review",
  general_other: "needs_review",
  legal_threat: "escalate_only",
  eviction_concern: "escalate_only",
  deposit_dispute: "escalate_only",
  other_resident_data: "escalate_only",
};

// ---------- keyword floors: English, Hindi, Telugu and Hinglish. They can only raise risk. ----------
export type FloorCode = "legal" | "eviction" | "police" | "deposit_dispute" | "injection" | "other_resident" | "urgent_hazard" | "waiver";
export const FLOOR_CODES: FloorCode[] = ["legal", "eviction", "police", "deposit_dispute", "injection", "other_resident", "urgent_hazard", "waiver"];
const W = (s: string) => new RegExp(s, "iu");

const FLOORS: { code: FloorCode; route: Route; re: RegExp }[] = [
  { code: "legal", route: "escalate_only", re: W("\\b(sue|suing|lawsuit|lawyer|advocate|attorney|court|legal action|legal notice|consumer forum|vakeel|vakil|kanoon|notice bhej)\\b|वकील|कोर्ट|अदालत|कानूनी|కోర్టు|లాయర్|న్యాయ|చట్టపరమైన") },
  { code: "police", route: "escalate_only", re: W("\\b(police|fir|thana|complaint against)\\b|पुलिस|थाना|పోలీస్|పోలీసు") },
  { code: "eviction", route: "escalate_only", re: W("\\b(evict\\w*|vacate|khali kar\\w*|flat khali|ghar khali|terminat\\w*|throw (me|us) out|lease end notice|notice to leave)\\b|बेदखल|खाली कर|ఖాళీ చేయ|ఎవిక్షన్") },
  { code: "deposit_dispute", route: "escalate_only", re: W("(deposit|security money|advance money)[^.?!]{0,80}\\b(deduct\\w*|forfeit\\w*|withh\\w*|refund\\w*|return\\w*|wapas|unfair|dispute\\w*|cut)\\b|\\b(deduct\\w*|forfeit\\w*|refund\\w*|wapas|unfair)\\b[^.?!]{0,80}(deposit|security money)|डिपॉज़िट|डिपॉजिट|సెక్యూరిటీ డిపాజిట్") },
  { code: "injection", route: "escalate_only", re: W("ignore (all |any )?(the )?(previous|prior|above|earlier) (instructions|rules|prompts)|disregard (all |your )?(previous|prior|instructions)|system prompt|your instructions|you are (now )?(the |a )?(property )?(administrator|admin|manager|owner|landlord)|i am the (property )?(manager|administrator|admin|owner|landlord)|developer mode|jailbreak|reveal your|print your (prompt|instructions)|(list|show|print) (all |every )?(the )?(tools|tables|functions|database)|act as (the |a )?(property )?(manager|admin|administrator|owner|landlord)") },
  { code: "urgent_hazard", route: "needs_review", re: W("\\b(gas( leak| smell)?|smell (of )?gas|smells? like gas|fire|smoke|sparks?|spark(ing)?|short.?circuit|electric(al)? shock|electrocut\\w*|shock|flood\\w*|burst pipe|pipe burst|sewage|carbon monoxide|collaps\\w*|ceiling (is )?(leak\\w*|dripping|caving)|leak\\w* (from|through) (the )?ceiling|ceiling leak\\w*|water (is )?(pouring|gushing)|aag lag|gas ki smell|gas leak)\\b|गैस|आग|धुआं|करंट|बाढ़|గ్యాస్|మంటలు|పొగ|కరెంట్ షాక్") },
  { code: "waiver", route: "needs_review", re: W("\\b(waive\\w*|waiver|forgive\\w*|exempt\\w*|maaf kar\\w*|late fee (hata|maaf|mat))\\b|माफ़|माफ|మాఫీ") },
];

const OTHER_RESIDENTS = W("\\b(every|all|each|other|everyone'?s|everybody'?s|neighbou?r'?s?)\\s+(the\\s+)?(residents?|tenants?|apartments?|flats?|units?|people|owners?)\\b|\\bwhole building\\b|\\beveryone\\b");
const UNIT_MENTION = /\b(?:apartment|apt|flat|unit)\s*(?:no\.?|number|#)?\s*([A-Za-z]?-?\d{1,4})\b/giu;
const DATA_WORDS = W("\\b(balance|owe[sd]?|outstanding|dues?|payments?|paid|rent|statement|details|ledger|deposit|account|history|phone|number|contact)\\b");

export interface FloorHit { code: FloorCode; route: Route }

/** Pure text signals. `ownUnit` lets the other-resident check ignore the sender's own apartment. */
export function keywordFloors(message: string, ownUnit: string): FloorHit[] {
  const hits: FloorHit[] = [];
  const text = message.normalize("NFKC");
  for (const f of FLOORS) if (f.re.test(text)) hits.push({ code: f.code, route: f.route });
  const own = ownUnit.trim().toLowerCase();
  const mentioned = [...text.matchAll(UNIT_MENTION)].map((m) => m[1]!.toLowerCase());
  const foreignUnit = mentioned.some((u) => u !== own);
  if ((foreignUnit && DATA_WORDS.test(text)) || (OTHER_RESIDENTS.test(text) && DATA_WORDS.test(text))) {
    hits.push({ code: "other_resident", route: "escalate_only" });
  }
  return hits;
}

/** A floor can override the model's intent so an escalation topic never gets tools or a model draft. */
export function intentFromFloors(hits: FloorHit[], modelIntent: Intent): Intent {
  const has = (c: FloorCode) => hits.some((h) => h.code === c);
  if (has("injection") || has("other_resident")) return "other_resident_data";
  if (has("legal") || has("police")) return "legal_threat";
  if (has("eviction")) return "eviction_concern";
  if (has("deposit_dispute")) return "deposit_dispute";
  if (has("waiver") && (modelIntent === "general_other" || modelIntent === "lease_question" || modelIntent === "maintenance_request")) return "fee_waiver_request";
  return modelIntent;
}

export interface RouteSignals {
  intentRoute: Route;
  floors: FloorHit[];
  /** Verifier outcome: a failed or blocked draft escalates. */
  verifierRoute: Route;
  /** Semantic layer: may only downgrade to needs_review. */
  semanticRoute: Route;
  modelSuggestion: Route | null;
  /** Any draft that carries a money fact is at least needs_review. */
  hasMoneyFact: boolean;
  /** Abstention, missing evidence, unmatched claim, possible clause conflict, urgency and similar: at least review. */
  reviewFloor: boolean;
  /** Provider failure or budget denial: the template reply is escalate_only. */
  forcedEscalation: boolean;
}

export function computeRoute(s: RouteSignals): { route: Route; reasons: string[] } {
  const reasons: string[] = [];
  let route: Route = s.intentRoute;
  const raise = (r: Route, why: string) => { if (ROUTE_RANK[r] > ROUTE_RANK[route]) route = r; if (ROUTE_RANK[r] > 0) reasons.push(why); };
  raise(s.intentRoute, `intent table: ${s.intentRoute}`);
  for (const f of s.floors) raise(f.route, `keyword floor: ${f.code}`);
  raise(s.verifierRoute, REASON.verificationFailed);
  raise(s.semanticRoute, REASON.semanticUnconfirmed);
  if (s.modelSuggestion) raise(s.modelSuggestion, `model suggested ${s.modelSuggestion}`);
  if (s.hasMoneyFact) raise("needs_review", REASON.moneyFact);
  if (s.reviewFloor) raise("needs_review", REASON.flaggedForReview);
  if (s.forcedEscalation) raise("escalate_only", REASON.templateForced);
  return { route, reasons: [...new Set(reasons)] };
}
