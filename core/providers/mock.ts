// Deterministic stand-in for a model, labelled "mock" everywhere it appears. It exists to test the
// pipeline, verifier, router, budget and failure paths without spending tokens; its results say
// nothing about real model quality and are never presented as live.
import { costMicroUsd, worstCaseCostMicroUsd, ProviderError, type AdjudicationInput, type ClassificationInput, type DraftInput, type LLMProvider, type ProviderErrorKind, type ProviderResult, type SemanticCheckInput } from "../provider";
import type { Intent } from "../policy";
import { INTENT_ROUTE } from "../router";
import type { Language } from "../types";

export interface MockOptions {
  /** Fail a step with a provider error kind. */
  priced?: boolean;
  fail?: { classify?: ProviderErrorKind; draft?: ProviderErrorKind; check?: ProviderErrorKind; adjudicate?: ProviderErrorKind };
  /** Produce a flawed draft: stray digits, an id that does not exist, a repeated id, a spelled-out number. */
  badDraft?: "digits" | "unknown_fact" | "duplicate_fact" | "number_word" | "currency";
  /** How many consecutive drafts are flawed (1: the retry recovers; 2: verification fails twice). */
  badDraftTimes?: number;
  /** A hijacked model: ignores injection and classifies the request at face value (floors must still hold). */
  gullible?: boolean;
  semantic?: "supported" | "unsupported";
  /** Suggest this route regardless of intent (the model may only make a run safer). */
  suggestRoute?: "draft_ready" | "needs_review" | "escalate_only";
}

const rx = (s: string) => new RegExp(s, "iu");
const HAZARD = rx("\\b(gas|smell|smoke|fire|spark\\w*|short.?circuit|shock|flood\\w*|ceiling)\\b|గ్యాస్|పొగ|मंटल|गैस");
const INJECT = rx("ignore (all )?(previous|prior|above) instructions|system prompt|you are (now )?the (property )?(administrator|manager)|i am the (property )?(manager|administrator)|print your|list (every|all) (tool|table)");
const HINGLISH = rx("\\b(maine|mujhe|kal|parson|nahi|kyun|kya|hai|hain|bheje|bheja|aap|mera|mere|hum|abhi|dikh|raha|rahi|se|ko|ka|ki|ke|mein|khali|kitna|baki|jaldi|karo|kar)\\b");
const STOP = new Set("the a an is are was were be been am i my me we our you your to of in on at for with and or but if it this that these those can could would should will do does did have has had not no yes please there here when what why how which who whom since from by as so than then just also about into over after before again still".split(" "));

function detectLanguage(msg: string, preferred: Language): Language {
  if (/[ఀ-౿]/u.test(msg)) return "Telugu";
  if (/[ऀ-ॿ]/u.test(msg)) return "Hindi";
  const hits = (msg.match(new RegExp(HINGLISH.source, "giu")) ?? []).length;
  if (hits >= 3) return "Hinglish";
  return /[a-z]/i.test(msg) ? "English" : preferred;
}

function pickIntent(msg: string, gullible: boolean): { intent: Intent; injection: boolean } {
  const injection = INJECT.test(msg) && !gullible;
  if (injection) return { intent: "other_resident_data", injection };
  if (/\b(sue|lawyer|court|legal action|police|vakeel)\b/i.test(msg)) return { intent: "legal_threat", injection };
  if (/\b(evict\w*|vacate|khali kar\w*|khali)\b/i.test(msg)) return { intent: "eviction_concern", injection };
  if (/deposit/i.test(msg) && /(deduct|refund|unfair|return|wapas)/i.test(msg)) return { intent: "deposit_dispute", injection };
  if (/\b(waive|waiver|maaf)\b/i.test(msg)) return { intent: "fee_waiver_request", injection };
  if (/\b(paid|payments?|bheje|bheja|transfer\w*|upi|reversed|duplicate|twice|credited|received)\b/i.test(msg) || /చెల్లించాను/u.test(msg)) return { intent: "payment_question", injection };
  if (/\b(balance|outstanding|owe[sd]?|dues?|statement|how much)\b/i.test(msg)) return { intent: "balance_question", injection };
  if (/(\b(leak\w*|drip\w*|tap|broken|repair\w*|fault|not working|gas|smell|smoke|spark\w*|ceiling|lift|kuluyayi)\b|కుళాయి|లీక్)/i.test(msg)) return { intent: "maintenance_request", injection };
  if (/(\b(allowed|permitted|grace|clause|lease|rent due|due date|on which date|can i|can my|subletting|sublet|pets?|cat|dog|guests?|stay|nights?)\b|అద్దె)/i.test(msg)) return { intent: "lease_question", injection };
  return { intent: "general_other", injection };
}

function queriesFor(msg: string): string[] {
  const out: string[] = [];
  const add = (q: string) => { if (!out.includes(q) && out.length < 3) out.push(q); };
  if (/(tap|leak|drip|kuluyayi|కుళాయి|లీక్|repair|broken)/iu.test(msg)) add("tap leak dripping repair maintenance");
  if (/(\bcat\b|\bdog\b|\bpets?\b)/i.test(msg)) add("pets cat keep");
  if (/(guest|brother|visitor|stay|nights)/i.test(msg)) add("guests overnight visitors nights stay");
  if (/(grace|late fee|waive|waiver|maaf)/i.test(msg)) add("late payment grace days late fee");
  if (/(due|అద్దె|rent due|which date)/iu.test(msg)) add("rent due date payable");
  if (/deposit/i.test(msg)) add("security deposit refundable");
  if (/(paint|colour|color|wall)/i.test(msg)) add("paint wall colour alterations");
  if (/(sublet|sub-let)/i.test(msg)) add("sublet subletting assign");
  if (!out.length) {
    const words = msg.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w));
    if (words.length) add(words.slice(0, 4).join(" "));
  }
  return out;
}

function shiftDay(asOf: string, delta: number): string {
  const d = new Date(asOf + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + delta); return d.toISOString().slice(0, 10);
}
function claimFrom(msg: string, asOf: string) {
  const amt = /(?:₹|rs\.?|inr)\s?([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s?(?:rupees|rupaye)/i.exec(msg);
  const amount = amt ? Number((amt[1] ?? amt[2])!.replace(/,/g, "")) : null;
  const ref = /\bUPI-[A-Z0-9-]+\b/i.exec(msg)?.[0] ?? null;
  let date: string | null = null;
  if (/\b(yesterday|kal)\b/i.test(msg)) date = shiftDay(asOf, -1);
  else if (/\bparson\b/i.test(msg)) date = shiftDay(asOf, -2);
  else {
    const d = /\bon the (\d{1,2})(?:st|nd|rd|th)\b/i.exec(msg) ?? /\bon (\d{1,2})(?:st|nd|rd|th)\b/i.exec(msg);
    if (d) date = asOf.slice(0, 8) + String(Number(d[1])).padStart(2, "0");
    else if (/last week/i.test(msg)) date = null;
  }
  return { amount, date, ref };
}

type S = { type: "text"; text: string } | { type: "fact"; id: string } | { type: "quote"; id: string };
const TXT: Record<Language, Record<string, string>> = {
  English: {
    thanks: "Thank you for your message. ", maint: "We have noted your request and our maintenance team will follow up. Your lease says: ",
    lease: "Here is what your lease says: ", balance: "Your outstanding balance is ", payrec: ". On our records we see the payment ", andthen: " and ",
    pending: " A pending payment is still being confirmed with the bank and is not yet counted. ", end: ". A property manager will review this reply before it is sent.",
    waive: "A fee waiver is a decision for the property manager, who will review your request. Your lease states: ", nomatch: "We could not find that payment in our records; a manager will check with you. ",
    plain: "A property manager will look into this and reply to you. ",
  },
  Hinglish: {
    thanks: "Aapke message ke liye dhanyavaad. ", maint: "Humne aapki request note kar li hai aur maintenance team jaldi sampark karegi. Aapke lease mein likha hai: ",
    lease: "Aapke lease mein yeh likha hai: ", balance: "Aapka baki balance ", payrec: ". Hamare records mein yeh payment dikh raha hai ", andthen: " aur ",
    pending: " Pending payment abhi bank se confirm ho raha hai aur abhi count nahi hua hai. ", end: ". Property manager is reply ko bhejne se pehle dekhenge.",
    waive: "Fee maaf karna property manager ka faisla hai, woh aapki request dekhenge. Aapke lease mein likha hai: ", nomatch: "Hamare records mein woh payment nahi mila; manager aapse check karenge. ",
    plain: "Property manager isko dekhkar aapko jawab denge. ",
  },
  Hindi: {
    thanks: "आपके संदेश के लिए धन्यवाद। ", maint: "हमने आपका अनुरोध नोट कर लिया है और रखरखाव टीम जल्द संपर्क करेगी। आपके लीज़ में लिखा है: ",
    lease: "आपके लीज़ में यह लिखा है: ", balance: "आपका बकाया शेष ", payrec: "। हमारे रिकॉर्ड में यह भुगतान दिख रहा है ", andthen: " और ",
    pending: " लंबित भुगतान की बैंक से पुष्टि हो रही है और अभी गिना नहीं गया है। ", end: "। प्रॉपर्टी मैनेजर भेजने से पहले इस उत्तर को देखेंगे।",
    waive: "शुल्क माफ़ करना प्रॉपर्टी मैनेजर का निर्णय है, वे आपका अनुरोध देखेंगे। आपके लीज़ में लिखा है: ", nomatch: "हमारे रिकॉर्ड में वह भुगतान नहीं मिला; मैनेजर आपसे जाँच करेंगे। ",
    plain: "प्रॉपर्टी मैनेजर इसे देखकर आपको उत्तर देंगे। ",
  },
  Telugu: {
    thanks: "మీ సందేశానికి ధన్యవాదాలు. ", maint: "మీ అభ్యర్థనను నమోదు చేసాము, నిర్వహణ బృందం త్వరలో సంప్రదిస్తుంది. మీ లీజులో ఇలా ఉంది: ",
    lease: "మీ లీజులో ఇలా ఉంది: ", balance: "మీ బకాయి మొత్తం ", payrec: ". మా రికార్డులలో ఈ చెల్లింపు కనిపిస్తోంది ", andthen: " మరియు ",
    pending: " పెండింగ్ చెల్లింపు బ్యాంకు నుండి ధృవీకరణ కోసం వేచి ఉంది, ఇంకా లెక్కలోకి రాలేదు. ", end: ". పంపే ముందు ప్రాపర్టీ మేనేజర్ ఈ సమాధానాన్ని చూస్తారు.",
    waive: "రుసుము మాఫీ ప్రాపర్టీ మేనేజర్ నిర్ణయం, వారు మీ అభ్యర్థనను పరిశీలిస్తారు. మీ లీజులో ఇలా ఉంది: ", nomatch: "మా రికార్డులలో ఆ చెల్లింపు కనబడలేదు; మేనేజర్ మిమ్మల్ని సంప్రదిస్తారు. ",
    plain: "ప్రాపర్టీ మేనేజర్ దీన్ని చూసి మీకు సమాధానం ఇస్తారు. ",
  },
};

function composeDraft(input: DraftInput, o: MockOptions, attempt: number): { language: Language; segments: S[] } {
  const L = TXT[input.language];
  const f = input.bundle.facts;
  const seg: S[] = [{ type: "text", text: L.thanks! }];
  const clauses = f.filter((x) => x.kind === "clause");
  const bal = f.find((x) => x.kind === "balance");
  const claim = f.find((x) => x.kind === "claim_match");
  const pays = f.filter((x) => x.kind === "payment");
  const pick = [
    ...pays.filter((p) => claim?.kind === "claim_match" && p.reference === claim.matched_reference),
    ...pays.filter((p) => p.is_duplicate || p.reversed || p.state === "pending" || p.state === "failed"),
    ...pays.slice().reverse().filter((p) => p.state === "settled" && !p.is_duplicate),
  ].filter((p, i, a) => a.indexOf(p) === i).slice(0, 2);

  switch (input.intent) {
    case "maintenance_request":
    case "lease_question":
      seg.push({ type: "text", text: input.intent === "maintenance_request" ? L.maint! : L.lease! });
      if (clauses[0]) seg.push({ type: "quote", id: clauses[0].id });
      seg.push({ type: "text", text: L.end! });
      break;
    case "fee_waiver_request":
      seg.push({ type: "text", text: L.waive! });
      if (clauses[0]) seg.push({ type: "quote", id: clauses[0].id });
      seg.push({ type: "text", text: L.end! });
      break;
    case "balance_question":
    case "payment_question": {
      if (bal) seg.push({ type: "text", text: L.balance! }, { type: "fact", id: bal.id });
      if (pick.length) {
        seg.push({ type: "text", text: L.payrec! });
        pick.forEach((p, i) => { if (i) seg.push({ type: "text", text: L.andthen! }); seg.push({ type: "fact", id: p.id }); });
      }
      if (claim) seg.push({ type: "text", text: pick.length ? ". " : "" }, { type: "fact", id: claim.id });
      if (pick.some((p) => p.state === "pending")) seg.push({ type: "text", text: L.pending! });
      seg.push({ type: "text", text: L.end! });
      break;
    }
    default:
      seg.push({ type: "text", text: L.plain! });
  }
  const bad = o.badDraft && attempt <= (o.badDraftTimes ?? 1);
  if (bad) {
    const first = seg.findIndex((s) => s.type === "fact" || s.type === "quote");
    if (o.badDraft === "digits") seg.push({ type: "text", text: " Your balance is 12000." });
    if (o.badDraft === "currency") seg.push({ type: "text", text: " That is a ₹ amount." });
    if (o.badDraft === "number_word") seg.push({ type: "text", text: " You paid eight thousand." });
    if (o.badDraft === "unknown_fact") seg.splice(Math.max(first, 1), 0, { type: "fact", id: "F99" });
    if (o.badDraft === "duplicate_fact" && first >= 0) seg.push(seg[first]!);
  }
  return { language: input.language, segments: seg };
}

const approxTokens = (v: unknown) => Math.max(1, Math.ceil(JSON.stringify(v).length / 4));

export class MockProvider implements LLMProvider {
  readonly label = "mock" as const;
  constructor(private o: MockOptions = {}) {}
  private drafts = 0;

  /** The mock costs nothing, so a mock demo can never exhaust the budget. Tests of budget logic set priced: true. */
  worstCaseCostMicroUsd(): number { return this.o.priced ? worstCaseCostMicroUsd() : 0; }

  private usage(model: "mock-triage" | "mock-draft" | "mock-check" | "mock-adjudicate", tin: number, tout: number): ProviderResult<never>["usage"] {
    return { model, tokens_in: tin, tokens_out: tout, cost_micro_usd: this.o.priced ? costMicroUsd(model, tin, tout) : 0, latency_ms: 1 };
  }
  private fail(kind: ProviderErrorKind | undefined, model: "mock-triage" | "mock-draft" | "mock-check" | "mock-adjudicate") {
    if (kind) throw new ProviderError(kind, `mock ${kind}`, this.usage(model, kind === "malformed" ? 400 : 0, kind === "malformed" ? 50 : 0));
  }

  async classify(input: ClassificationInput): Promise<ProviderResult<unknown>> {
    this.fail(this.o.fail?.classify === "malformed" ? undefined : this.o.fail?.classify, "mock-triage");
    if (this.o.fail?.classify === "malformed") return { value: { intent: "banana" }, usage: this.usage("mock-triage", 400, 20) };
    const language = detectLanguage(input.message, input.preferredLanguage);
    const { intent, injection } = pickIntent(input.message, !!this.o.gullible);
    const c = claimFrom(input.message, input.asOf);
    const proposed = intent === "balance_question" || intent === "payment_question"
      ? ["get_balance_breakdown", "get_payment_history", ...(c.amount !== null || c.ref ? ["match_claimed_payment"] : [])]
      : intent === "legal_threat" || intent === "eviction_concern" || intent === "deposit_dispute" || intent === "other_resident_data" ? [] : ["search_lease_clauses"];
    const value = {
      language, intent, urgency: HAZARD.test(input.message) ? "urgent" : "normal", suspected_injection: injection,
      claimed_amount_inr: c.amount, claimed_date: c.date, claimed_reference: c.ref,
      english_queries: queriesFor(input.message), proposed_tools: proposed,
      suggested_route: this.o.suggestRoute ?? INTENT_ROUTE[intent],
    };
    return { value, usage: this.usage("mock-triage", approxTokens(input.message) + 400, approxTokens(value)) };
  }

  async draft(input: DraftInput): Promise<ProviderResult<unknown>> {
    this.fail(this.o.fail?.draft === "malformed" ? undefined : this.o.fail?.draft, "mock-draft");
    this.drafts++;
    if (this.o.fail?.draft === "malformed") return { value: "I am sorry, I cannot do that.", usage: this.usage("mock-draft", 900, 30) };
    const value = composeDraft(input, this.o, this.drafts);
    return { value, usage: this.usage("mock-draft", approxTokens(input.bundle) + 700, approxTokens(value)) };
  }

  /** The mock reproduces the old rank heuristic (its only job is to exercise the pipeline). A real model replaces it; abs-05 stays unfixable here. */
  async adjudicate(input: AdjudicationInput): Promise<ProviderResult<unknown>> {
    this.fail(this.o.fail?.adjudicate, "mock-adjudicate");
    const ranked = input.candidates as (AdjudicationInput["candidates"][number] & { rank?: number })[];
    const top = Math.max(0, ...ranked.map((c) => c.rank ?? 0));
    const comparable = ranked.filter((c) => top > 0 && (c.rank ?? 0) >= 0.6 * top);
    const conflict = new Set(comparable.map((c) => c.number)).size >= 2;
    const value = { relevant_ids: input.candidates.map((c) => c.id), conflict, sufficient: true };
    return { value, usage: this.usage("mock-adjudicate", approxTokens(input.candidates) + 300, approxTokens(value)) };
  }

  async check(input: SemanticCheckInput): Promise<ProviderResult<unknown>> {
    this.fail(this.o.fail?.check === "malformed" ? undefined : this.o.fail?.check, "mock-check");
    if (this.o.fail?.check === "malformed") return { value: { supported: "maybe" }, usage: this.usage("mock-check", 500, 10) };
    const unsupported = this.o.semantic === "unsupported";
    const value = { supported: !unsupported, issues: unsupported ? ["mock: a statement is not backed by the evidence"] : [] };
    return { value, usage: this.usage("mock-check", approxTokens(input.replyText) + 500, approxTokens(value)) };
  }
}
