// Verification layers 1 to 3 (schema, evidence, exactness). Layers 4 to 6 live in the pipeline's
// router and abstention modules. A failure at any layer can lower trust in a draft; none can raise it.
import { DraftSchema, clauseAppliesOn, kindsIn, type Draft } from "./facts";
import { guardText } from "./guard";
import type { EvidenceBundle, FactKind, IsoDate } from "./types";

export type LayerEffect = "none" | "retry" | "block";
export interface LayerResult {
  layer: 1 | 2 | 3 | 4 | 5 | 6;
  name: "schema" | "evidence" | "exactness" | "policy" | "semantic" | "abstention";
  ok: boolean;
  effect: LayerEffect;
  issues: string[];
  /** Logged as a critical incident (S0 class), e.g. TypeScript and SQL balances disagree. */
  critical?: boolean;
  /** Not run because no model draft existed (template reply). */
  skipped?: boolean;
}

const pass = (layer: LayerResult["layer"], name: LayerResult["name"]): LayerResult => ({ layer, name, ok: true, effect: "none", issues: [] });

export function layer1Schema(raw: unknown): { result: LayerResult; draft?: Draft } {
  const parsed = DraftSchema.safeParse(raw);
  if (parsed.success) return { result: pass(1, "schema"), draft: parsed.data };
  const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  return { result: { layer: 1, name: "schema", ok: false, effect: "retry", issues } };
}

export interface EvidenceCtx { residentId: string; asOf: IsoDate; requiredKinds: FactKind[] }

export function layer2Evidence(draft: Draft, bundle: EvidenceBundle, ctx: EvidenceCtx): LayerResult {
  const issues: string[] = [];
  const seen = new Set<string>();
  const referenced = new Set<FactKind>();
  for (const s of draft.segments) {
    if (s.type === "text") continue;
    if (seen.has(s.id)) { issues.push(`${s.id} is referenced more than once`); continue; }
    seen.add(s.id);
    const f = bundle.facts.find((x) => x.id === s.id);
    if (!f) { issues.push(`${s.id} is not in this run's evidence bundle`); continue; }
    if (f.residentId !== ctx.residentId) { issues.push(`${s.id} does not belong to this resident`); continue; }
    if (s.type === "quote" && f.kind !== "clause") { issues.push(`${s.id} is not a clause and cannot be quoted`); continue; }
    if (s.type === "fact" && f.kind === "clause") { issues.push(`${s.id} is a clause; use a quote segment`); continue; }
    if (f.kind === "clause" && !clauseAppliesOn(f.clause, ctx.asOf)) issues.push(`${s.id} does not apply on ${ctx.asOf}`);
    if (f.kind === "payment" && f.received_on > ctx.asOf) issues.push(`${s.id} is dated after ${ctx.asOf}`);
    if (f.kind === "balance" && f.as_of > ctx.asOf) issues.push(`${s.id} is dated after ${ctx.asOf}`);
    referenced.add(f.kind);
  }
  // A required kind must be used when the bundle holds one; a kind the bundle lacks is the abstention layer's concern.
  const inBundle = kindsIn(bundle);
  for (const k of ctx.requiredKinds) if (inBundle.has(k) && !referenced.has(k)) issues.push(`draft must reference a ${k} fact`);
  return issues.length ? { layer: 2, name: "evidence", ok: false, effect: "retry", issues } : pass(2, "evidence");
}

export function layer3Exactness(draft: Draft, bundle: EvidenceBundle): LayerResult {
  const issues: string[] = [];
  let critical = false;
  for (const f of bundle.facts) {
    if (f.kind === "balance" && !f.crosscheck.agree) {
      critical = true;
      issues.push(`balance ${f.id}: TypeScript ${f.crosscheck.ts_paise} paise differs from SQL view ${f.crosscheck.sql_paise} paise`);
    }
  }
  const guardIssues: string[] = [];
  draft.segments.forEach((s, i) => {
    if (s.type !== "text") return;
    for (const v of guardText(s.text)) guardIssues.push(`text segment ${i} contains a ${v.category.replace("_", " ")} ("${v.match}")`);
  });
  issues.push(...guardIssues);
  if (!issues.length) return pass(3, "exactness");
  // A balance mismatch is an application fault: block with a critical incident. Digits and the like are a model slip: one retry.
  return { layer: 3, name: "exactness", ok: false, effect: critical ? "block" : "retry", issues, critical };
}
