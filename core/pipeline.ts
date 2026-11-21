// The explicit state machine: reserve budget -> triage -> evidence tools -> draft -> verify (six
// layers) -> route. Pure orchestration: storage, budget and trace sinks are injected, nothing here
// reads the clock (callers pass asOf and a `now` for latency), the environment or the database.
import {
  FactIds, buildLeaseTermFacts, kindsIn, renderDraft, renderPlain, type Draft, type RenderedSegment,
} from "./facts";
import {
  AdjudicationSchema, ClassificationSchema, PROMPT_VERSION, ProviderError, SemanticResultSchema, worstCaseCostMicroUsd, DEFAULT_PRICES,
  type Classification, type LLMProvider, type ProviderLabel, type ProviderResult, type Usage,
} from "./provider";
import { MANDATORY_TOOLS, REQUIRED_KINDS, TOOL_ALLOWLIST, type Intent, type ToolName } from "./policy";
import { computeRoute, intentFromFloors, keywordFloors, INTENT_ROUTE, type FloorHit } from "./router";
import { templateDraft, type TemplateKind } from "./templates";
import { runToolPlan, type ToolCall, type ToolRecord } from "./tools";
import {
  type EvidenceBundle, type EvidenceStore, type Fact, type FactKind, type IsoDate, type Language, type Route,
} from "./types";
import { layer1Schema, layer2Evidence, layer3Exactness, type LayerResult } from "./verifier";

export interface TraceEvent {
  stage: string;
  model?: string | null;
  tokens_in?: number;
  tokens_out?: number;
  cost_micro_usd?: number;
  latency_ms?: number;
  outcome: string;
  /** Structured, redactable details. Never prompts, chain-of-thought or credentials. */
  payload?: Record<string, unknown>;
}

export interface BudgetPort {
  /** One atomic conditional reservation. False means denied: skip the model. */
  reserve(estimate_micro_usd: number): Promise<boolean>;
  /** Records the actual cost and releases the unused part. */
  settle(estimate_micro_usd: number, actual_micro_usd: number): Promise<void>;
}

export interface PipelineDeps {
  provider: LLMProvider;
  store: EvidenceStore;
  budget: BudgetPort;
  emit(e: TraceEvent): Promise<void>;
  /** Monotonic milliseconds, for latency only. */
  now(): number;
  prices?: Record<string, { in: number; out: number }>;
}

export interface PipelineInput {
  message: string;
  residentId: string;
  ownUnit: string;
  preferredLanguage: Language;
  asOf: IsoDate;
}

export type RunMode = ProviderLabel | "fallback";
export interface PipelineOutput {
  prompt_version: string;
  mode: RunMode;
  draft_source: "model" | "template";
  banner: "budget_exhausted" | "provider_failed" | null;
  intent: Intent;
  urgency: "low" | "normal" | "urgent";
  language: Language;
  route: Route;
  reasons: string[];
  flags: string[];
  draft: Draft;
  rendered: RenderedSegment[];
  bundle: EvidenceBundle;
  verification: LayerResult[];
  tool_records: ToolRecord[];
  usage: { tokens_in: number; tokens_out: number; cost_micro_usd: number };
  critical_incident: boolean;
  suspected_injection: boolean;
}

const LAYER_NAMES = ["schema", "evidence", "exactness", "policy", "semantic", "abstention"] as const;
const skipped = (layer: LayerResult["layer"], why: string): LayerResult => ({ layer, name: LAYER_NAMES[layer - 1]!, ok: true, effect: "none", issues: [why], skipped: true });
const MONEY_KINDS = new Set<FactKind>(["balance", "payment", "claim_match"]);

function usageOf(r: { usage?: Partial<Usage> } | undefined) {
  return { tin: r?.usage?.tokens_in ?? 0, tout: r?.usage?.tokens_out ?? 0, cost: r?.usage?.cost_micro_usd ?? 0 };
}

export async function runPipeline(deps: PipelineDeps, input: PipelineInput): Promise<PipelineOutput> {
  const { provider, store, emit } = deps;
  const prices = deps.prices ?? DEFAULT_PRICES;
  const totals = { tokens_in: 0, tokens_out: 0, cost_micro_usd: 0 };
  const addUsage = (u: { tin: number; tout: number; cost: number }) => { totals.tokens_in += u.tin; totals.tokens_out += u.tout; totals.cost_micro_usd += u.cost; };

  const floors: FloorHit[] = keywordFloors(input.message, input.ownUnit);
  const hazard = floors.some((f) => f.code === "urgent_hazard");
  const emptyBundle: EvidenceBundle = { residentId: input.residentId, leaseId: null, asOf: input.asOf, facts: [] };
  await emit({ stage: "pipeline_started", outcome: "ok", payload: { prompt_version: PROMPT_VERSION, provider: provider.label, floors: floors.map((f) => f.code) } });

  // A template run: no model draft, no claims. Used for escalation topics, holding replies and failures.
  const finish = (a: {
    kind: TemplateKind; language: Language; intent: Intent; urgency: Classification["urgency"]; mode: RunMode; banner?: PipelineOutput["banner"];
    modelRoute?: Route | null; flags?: string[]; reviewFloor?: boolean; forced?: boolean; bundle?: EvidenceBundle; tools?: ToolRecord[];
    verification?: LayerResult[]; critical?: boolean; injection?: boolean; extraReasons?: string[];
  }): PipelineOutput => {
    const draft = templateDraft(a.kind, a.language);
    const bundle = a.bundle ?? emptyBundle;
    const { route, reasons } = computeRoute({
      intentRoute: INTENT_ROUTE[a.intent], floors, verifierRoute: "draft_ready", semanticRoute: "draft_ready", modelSuggestion: a.modelRoute ?? null,
      hasMoneyFact: false, reviewFloor: !!a.reviewFloor, forcedEscalation: !!a.forced,
    });
    const flags = [...new Set([...(a.flags ?? []), ...(hazard ? ["urgent"] : [])])];
    return {
      prompt_version: PROMPT_VERSION, mode: a.mode, draft_source: "template", banner: a.banner ?? null, intent: a.intent, urgency: hazard ? "urgent" : a.urgency,
      language: a.language, route, reasons: [...reasons, ...(a.extraReasons ?? [])], flags, draft, rendered: renderDraft(draft, bundle), bundle,
      verification: a.verification ?? LAYER_NAMES.map((_, i) => skipped((i + 1) as LayerResult["layer"], "template reply: no model draft")),
      tool_records: a.tools ?? [], usage: { ...totals }, critical_incident: !!a.critical, suspected_injection: !!a.injection,
    };
  };
  const fallbackIntent = intentFromFloors(floors, "general_other");

  // ---- 2. reserve budget ----
  const estimate = deps.provider.worstCaseCostMicroUsd?.() ?? worstCaseCostMicroUsd(prices);
  let reserved = false;
  try { reserved = await deps.budget.reserve(estimate); } catch { reserved = false; }
  if (!reserved) {
    await emit({ stage: "budget", outcome: "denied", payload: { estimate_micro_usd: estimate } });
    const out = finish({ kind: "unavailable", language: input.preferredLanguage, intent: fallbackIntent, urgency: "normal", mode: "fallback", banner: "budget_exhausted", forced: true, flags: ["budget_exhausted"] });
    await emit({ stage: "route", outcome: out.route, payload: { reasons: out.reasons, flags: out.flags } });
    return out;
  }
  await emit({ stage: "budget", outcome: "reserved", payload: { estimate_micro_usd: estimate } });

  try {
    // ---- 3. triage ----
    let cls: Classification | null = null;
    const t0 = deps.now();
    try {
      const r: ProviderResult<unknown> = await provider.classify({ message: input.message, asOf: input.asOf, preferredLanguage: input.preferredLanguage });
      addUsage(usageOf(r));
      const parsed = ClassificationSchema.safeParse(r.value);
      if (!parsed.success) throw new ProviderError("malformed", "triage output failed schema", r.usage);
      cls = parsed.data;
      await emit({ stage: "triage", model: r.usage.model, tokens_in: r.usage.tokens_in, tokens_out: r.usage.tokens_out, cost_micro_usd: r.usage.cost_micro_usd, latency_ms: r.usage.latency_ms, outcome: "ok",
        payload: { language: cls.language, intent: cls.intent, urgency: cls.urgency, suspected_injection: cls.suspected_injection, suggested_route: cls.suggested_route, proposed_tools: cls.proposed_tools } });
    } catch (e) {
      const pe = e instanceof ProviderError ? e : new ProviderError("unavailable", "triage failed");
      addUsage(usageOf(pe));
      await emit({ stage: "triage", model: pe.usage?.model ?? null, latency_ms: deps.now() - t0, outcome: `failed:${pe.kind}`, payload: { fallback: "keyword triage + template reply" } });
    }
    if (!cls) {
      const out = finish({ kind: "unavailable", language: input.preferredLanguage, intent: fallbackIntent, urgency: "normal", mode: "fallback", banner: "provider_failed", forced: true, flags: ["provider_failed"], injection: floors.some((f) => f.code === "injection") });
      await emit({ stage: "route", outcome: out.route, payload: { reasons: out.reasons, flags: out.flags } });
      return out;
    }

    // Model-reported injection raises the floor; the keyword floors never lower it.
    if (cls.suspected_injection && !floors.some((f) => f.code === "injection")) floors.push({ code: "injection", route: "escalate_only" });
    const injection = floors.some((f) => f.code === "injection");
    if (injection) await emit({ stage: "injection_suspected", outcome: "logged", payload: { by: cls.suspected_injection ? "model+keywords" : "keywords" } });

    const intent = intentFromFloors(floors, cls.intent);
    const language: Language = cls.language;
    const urgency = hazard ? "urgent" : cls.urgency;
    const flagsBase = [...(urgency === "urgent" ? ["urgent"] : []), ...(injection ? ["suspected_injection"] : [])];
    const common = { language, intent, urgency, mode: provider.label as RunMode, modelRoute: cls.suggested_route, injection };

    // ---- escalation topics: no tools, no draft ----
    if (TOOL_ALLOWLIST[intent].length === 0) {
      const kind: TemplateKind = intent === "other_resident_data" ? "refusal" : "escalation";
      const verification = LAYER_NAMES.map((_, i) => skipped((i + 1) as LayerResult["layer"], "escalation topic: no tools, no model draft"));
      verification[3] = { layer: 4, name: "policy", ok: true, effect: "none", issues: [`intent ${intent} is not allowed for drafting; route ${INTENT_ROUTE[intent]}`] };
      const out = finish({ ...common, kind, flags: flagsBase, verification });
      await emit({ stage: "route", outcome: out.route, payload: { reasons: out.reasons, flags: out.flags } });
      return out;
    }

    // ---- 4. evidence ----
    const ids = new FactIds();
    let lease; let facts: Fact[] = []; let records: ToolRecord[] = [];
    try {
      lease = await store.getLease(input.asOf);
      if (lease) {
        const claim = cls.claimed_amount_inr !== null || cls.claimed_reference !== null || cls.claimed_date !== null;
        const plan: ToolCall[] = [];
        const want = new Set<ToolName>([...MANDATORY_TOOLS[intent], ...cls.proposed_tools]);
        if (claim && (intent === "payment_question" || intent === "balance_question")) want.add("match_claimed_payment");
        const queries = cls.english_queries.length ? cls.english_queries : (language === "English" ? [input.message.slice(0, 120)] : []);
        for (const tool of want) {
          if (tool === "search_lease_clauses") { if (queries.length) plan.push({ tool, args: { queries } }); }
          else if (tool === "match_claimed_payment") plan.push({ tool, args: { amount_inr: cls.claimed_amount_inr, date: cls.claimed_date, reference: cls.claimed_reference } });
          else plan.push({ tool, args: { period: null } });
        }
        // Tools the model asked for outside the allowlist are logged as rejected, never run.
        const ran = await runToolPlan(intent, plan, { residentId: input.residentId, leaseId: lease.id, asOf: input.asOf, store, ids });
        facts = ran.facts; records = ran.records;
        for (const t of cls.proposed_tools) if (!TOOL_ALLOWLIST[intent].includes(t)) records.push({ tool: t, args: {}, status: "rejected", summary: `not allowed for intent ${intent}`, fact_ids: [] });
        if (intent === "lease_question" || intent === "fee_waiver_request") facts.push(...buildLeaseTermFacts(ids, { residentId: input.residentId, leaseId: lease.id, asOf: input.asOf }, lease));
      }
      await emit({ stage: "evidence", outcome: lease ? "ok" : "no_lease", payload: { tools: records, fact_ids: facts.map((f) => f.id), fact_kinds: [...new Set(facts.map((f) => f.kind))] } });
    } catch {
      await emit({ stage: "evidence", outcome: "failed", payload: { fallback: "template reply" } });
      const out = finish({ ...common, kind: "unavailable", mode: "fallback", banner: "provider_failed", forced: true, flags: [...flagsBase, "evidence_unavailable"] });
      await emit({ stage: "route", outcome: out.route, payload: { reasons: out.reasons, flags: out.flags } });
      return out;
    }
    let bundle: EvidenceBundle = { residentId: input.residentId, leaseId: lease?.id ?? null, asOf: input.asOf, facts };
    const required = REQUIRED_KINDS[intent];
    let have = kindsIn(bundle);

    // A balance that disagrees with its SQL cross-check is an application fault: block before any draft.
    const balanceMismatch = facts.some((f) => f.kind === "balance" && !f.crosscheck.agree);
    if (balanceMismatch) {
      const dummy = templateDraft("holding", language);
      const l3 = layer3Exactness(dummy, bundle);
      const verification = LAYER_NAMES.map((_, i) => skipped((i + 1) as LayerResult["layer"], "blocked before drafting"));
      verification[2] = l3;
      await emit({ stage: "critical_incident", outcome: "balance_mismatch", payload: { issues: l3.issues } });
      const out = finish({ ...common, kind: "escalation", mode: "fallback", flags: [...flagsBase, "critical_incident"], bundle, tools: records, verification, critical: true, forced: true, extraReasons: ["balance cross-check failed"] });
      await emit({ stage: "route", outcome: out.route, payload: { reasons: out.reasons, flags: out.flags } });
      return out;
    }

    // ---- retrieval adjudication: a model may only REMOVE clauses or raise a review flag, never add evidence ----
    let conflicting = false, insufficient = false;
    const candidates = facts.flatMap((f) => (f.kind === "clause" ? [{ id: f.id, number: f.clause.number, heading: f.clause.heading, text: f.clause.text, rank: f.clause.rank }] : []));
    if (candidates.length > 0 && intent !== "payment_question" && intent !== "balance_question") {
      const t0 = deps.now();
      try {
        const r = await provider.adjudicate({ message: input.message, intent, candidates });
        addUsage(usageOf(r));
        const adj = AdjudicationSchema.safeParse(r.value);
        if (!adj.success) throw new ProviderError("malformed", "adjudication output failed schema", r.usage);
        const keep = new Set(adj.data.relevant_ids.filter((id) => candidates.some((c) => c.id === id)));
        facts = facts.filter((f) => f.kind !== "clause" || keep.has(f.id));
        conflicting = adj.data.conflict && keep.size >= 2;
        insufficient = keep.size > 0 && !adj.data.sufficient;
        await emit({ stage: "adjudicate", model: r.usage.model, tokens_in: r.usage.tokens_in, tokens_out: r.usage.tokens_out, cost_micro_usd: r.usage.cost_micro_usd, latency_ms: r.usage.latency_ms,
          outcome: keep.size === 0 ? "no_relevant_clause" : conflicting ? "conflict" : insufficient ? "insufficient" : "ok", payload: { candidates: candidates.map((c) => c.id), kept: [...keep] } });
      } catch (e) {
        const pe = e instanceof ProviderError ? e : new ProviderError("unavailable", "adjudication failed");
        addUsage(usageOf(pe));
        // Fail safe: without the adjudicator, two different clauses are treated as a possible conflict (a review, never a guess).
        conflicting = new Set(candidates.map((c) => c.number)).size >= 2;
        await emit({ stage: "adjudicate", model: pe.usage?.model ?? null, latency_ms: deps.now() - t0, outcome: `failed:${pe.kind}`, payload: { fail_safe_conflict: conflicting } });
      }
      bundle = { ...bundle, facts };
      have = kindsIn(bundle);
    }

    // ---- 6 (early). abstention: the material claim cannot be established -> holding reply, review ----
    const missing = required.filter((k) => !have.has(k));
    const noEvidence = !lease || missing.length > 0 || (intent === "general_other" && facts.length === 0);
    if (conflicting || insufficient || noEvidence) {
      const why = conflicting ? "conflicting_clauses" : insufficient ? "insufficient_evidence" : "no_evidence";
      const verification = LAYER_NAMES.map((_, i) => skipped((i + 1) as LayerResult["layer"], "holding reply: no model draft"));
      verification[5] = { layer: 6, name: "abstention", ok: false, effect: "none", issues: [conflicting ? "two or more clauses may conflict; manager to decide" : insufficient ? "retrieved clauses do not settle the question; manager to decide" : `evidence missing: ${missing.join(", ") || "lease"}`] };
      const out = finish({ ...common, kind: "holding", flags: [...flagsBase, why], reviewFloor: true, bundle, tools: records, verification, extraReasons: [conflicting ? "possible conflicting clauses" : insufficient ? "retrieved clauses insufficient" : "evidence missing"] });
      await emit({ stage: "abstention", outcome: why, payload: { missing } });
      await emit({ stage: "route", outcome: out.route, payload: { reasons: out.reasons, flags: out.flags } });
      return out;
    }

    // ---- 5. draft, with verification layers 1-3 and one retry ----
    // A tenant's payment claim that was matched (or not) must be stated through the claim_match fact, never in free text.
    const requiredKinds = [...required, ...(have.has("claim_match") ? ["claim_match" as FactKind] : [])];
    let draft: Draft | null = null;
    let verification: LayerResult[] = [];
    let retryReason: string[] | undefined;
    let critical = false;
    for (let attempt = 1; attempt <= 2 && !draft; attempt++) {
      const t1 = deps.now();
      let raw: ProviderResult<unknown>;
      try {
        raw = await provider.draft({ message: input.message, language, intent, asOf: input.asOf, bundle, retryReason });
      } catch (e) {
        const pe = e instanceof ProviderError ? e : new ProviderError("unavailable", "draft failed");
        addUsage(usageOf(pe));
        await emit({ stage: "draft", model: pe.usage?.model ?? null, latency_ms: deps.now() - t1, outcome: `failed:${pe.kind}`, payload: { attempt, fallback: "template reply" } });
        const out = finish({ ...common, kind: "unavailable", mode: "fallback", banner: "provider_failed", forced: true, flags: [...flagsBase, "provider_failed"], bundle, tools: records });
        await emit({ stage: "route", outcome: out.route, payload: { reasons: out.reasons, flags: out.flags } });
        return out;
      }
      addUsage(usageOf(raw));
      const l1 = layer1Schema(raw.value);
      const layers: LayerResult[] = [l1.result];
      let accepted: Draft | null = null;
      if (l1.draft) {
        const l2 = layer2Evidence(l1.draft, bundle, { residentId: input.residentId, asOf: input.asOf, requiredKinds });
        layers.push(l2);
        if (l2.ok) {
          const l3 = layer3Exactness(l1.draft, bundle);
          layers.push(l3);
          if (l3.ok) accepted = l1.draft;
          if (l3.critical) critical = true;
        }
      }
      const failed = layers.find((l) => !l.ok);
      await emit({ stage: "draft", model: raw.usage.model, tokens_in: raw.usage.tokens_in, tokens_out: raw.usage.tokens_out, cost_micro_usd: raw.usage.cost_micro_usd, latency_ms: raw.usage.latency_ms,
        outcome: failed ? `rejected:${failed.name}` : "accepted", payload: { attempt, layers: layers.map((l) => ({ layer: l.layer, name: l.name, ok: l.ok, issues: l.issues })) } });
      verification = layers;
      if (accepted) draft = accepted;
      else if (critical || failed?.effect === "block") { break; }
      else retryReason = failed?.issues;
    }
    if (!draft) {
      const filled = LAYER_NAMES.map((n, i) => verification.find((l) => l.layer === i + 1) ?? skipped((i + 1) as LayerResult["layer"], "not reached"));
      const out = finish({ ...common, kind: "escalation", mode: "fallback", flags: [...flagsBase, "verification_failed", ...(critical ? ["critical_incident"] : [])], bundle, tools: records, verification: filled, critical, forced: true, extraReasons: [critical ? "balance cross-check failed" : "verification failed twice"] });
      await emit({ stage: "route", outcome: out.route, payload: { reasons: out.reasons, flags: out.flags } });
      return out;
    }

    // ---- layers 4-6 ----
    const rendered = renderDraft(draft, bundle, language);
    const replyText = renderPlain(rendered);
    const referenced = draft.segments.flatMap((s) => (s.type === "text" ? [] : [s.id]));
    const referencedFacts = referenced.map((id) => bundle.facts.find((f) => f.id === id)!).filter(Boolean);
    const hasMoney = referencedFacts.some((f) => MONEY_KINDS.has(f.kind) || (f.kind === "lease_term" && (f.term === "rent" || f.term === "deposit")));

    const l4: LayerResult = { layer: 4, name: "policy", ok: floors.length === 0, effect: "none", issues: floors.map((f) => `keyword floor: ${f.code}`) };

    let semanticRoute: Route = "draft_ready";
    let l5: LayerResult = { layer: 5, name: "semantic", ok: true, effect: "none", issues: [] };
    const t2 = deps.now();
    try {
      const r = await provider.check({ message: input.message, replyText, bundle, referencedIds: referenced });
      addUsage(usageOf(r));
      const parsed = SemanticResultSchema.safeParse(r.value);
      if (!parsed.success) throw new ProviderError("malformed", "semantic output failed schema", r.usage);
      if (!parsed.data.supported) { semanticRoute = "needs_review"; l5 = { layer: 5, name: "semantic", ok: false, effect: "none", issues: parsed.data.issues }; }
      await emit({ stage: "semantic_check", model: r.usage.model, tokens_in: r.usage.tokens_in, tokens_out: r.usage.tokens_out, cost_micro_usd: r.usage.cost_micro_usd, latency_ms: r.usage.latency_ms, outcome: parsed.data.supported ? "supported" : "unsupported", payload: { issues: parsed.data.issues } });
    } catch (e) {
      const pe = e instanceof ProviderError ? e : new ProviderError("unavailable", "check failed");
      addUsage(usageOf(pe));
      semanticRoute = "needs_review"; // the judge can only lower trust, so a missing judge lowers it
      l5 = { layer: 5, name: "semantic", ok: false, effect: "none", issues: [`semantic check unavailable (${pe.kind})`] };
      await emit({ stage: "semantic_check", model: pe.usage?.model ?? null, latency_ms: deps.now() - t2, outcome: `failed:${pe.kind}` });
    }

    const unmatchedClaim = referencedFacts.some((f) => f.kind === "claim_match" && !f.matched) || (facts.some((f) => f.kind === "claim_match" && !f.matched));
    const l6: LayerResult = { layer: 6, name: "abstention", ok: true, effect: "none", issues: unmatchedClaim ? ["claimed payment could not be matched: manager to check"] : [] };
    const flags = [...flagsBase, ...(unmatchedClaim ? ["claim_unmatched"] : []), ...(semanticRoute === "needs_review" ? ["semantic_review"] : []),
      ...(facts.some((f) => f.kind === "payment" && f.state === "pending") && referencedFacts.some((f) => f.kind === "payment" && f.state === "pending") ? ["pending_payment"] : []),
      ...(referencedFacts.some((f) => f.kind === "payment" && f.is_duplicate) ? ["duplicate_payment"] : [])];
    const { route, reasons } = computeRoute({
      intentRoute: INTENT_ROUTE[intent], floors, verifierRoute: "draft_ready", semanticRoute, modelSuggestion: cls.suggested_route,
      hasMoneyFact: hasMoney, reviewFloor: unmatchedClaim, forcedEscalation: false,
    });
    await emit({ stage: "route", outcome: route, payload: { reasons, flags } });
    return {
      prompt_version: PROMPT_VERSION, mode: provider.label, draft_source: "model", banner: null, intent, urgency, language, route, reasons, flags, draft, rendered, bundle,
      verification: [...verification, l4, l5, l6].sort((a, b) => a.layer - b.layer), tool_records: records, usage: { ...totals }, critical_incident: false, suspected_injection: injection,
    };
  } finally {
    try { await deps.budget.settle(estimate, Math.min(totals.cost_micro_usd, estimate)); } catch { /* a crashed settle leaks at most this run's estimate; the counter resets daily */ }
  }
}

