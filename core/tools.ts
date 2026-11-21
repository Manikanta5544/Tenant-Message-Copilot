// The four bound tools. The model supplies only the arguments below; the server binds the
// organisation, resident and lease (through the scoped store), so no argument can name any of them.
import { z } from "zod";
import {
  FactIds, buildBalanceFact, buildClaimMatch, buildClauseFacts, buildPaymentFacts, effectiveAsOf, type Claim,
} from "./facts";
import { MAX_TOOL_CALLS, TOOL_ALLOWLIST, type Intent, type ToolName } from "./policy";
import { rupeesToPaise } from "./money";
import type { EvidenceStore, Fact, IsoDate } from "./types";

const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullish();
type ArgsOf<N extends keyof typeof ToolArgs> = z.infer<(typeof ToolArgs)[N]>;
export const ToolArgs = {
  search_lease_clauses: z.strictObject({ queries: z.array(z.string().min(1).max(120)).min(1).max(3) }),
  get_balance_breakdown: z.strictObject({ period: Period }),
  get_payment_history: z.strictObject({ period: Period }),
  match_claimed_payment: z.strictObject({
    amount_inr: z.number().nonnegative().nullish(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    reference: z.string().max(60).nullish(),
  }),
} as const;

export interface ToolCall { tool: string; args: unknown }
export interface ToolRecord {
  tool: string;
  args: unknown;
  status: "ok" | "rejected" | "error";
  /** Short, human-readable result summary for the trace. Never row contents beyond counts and fact ids. */
  summary: string;
  fact_ids: string[];
}

export interface ToolCtx { residentId: string; leaseId: string; asOf: IsoDate; store: EvidenceStore; ids: FactIds }

export async function runToolPlan(intent: Intent, plan: ToolCall[], ctx: ToolCtx): Promise<{ facts: Fact[]; records: ToolRecord[] }> {
  const facts: Fact[] = [];
  const records: ToolRecord[] = [];
  const allowed = new Set<string>(TOOL_ALLOWLIST[intent]);
  let calls = 0;
  const fctx = { residentId: ctx.residentId, leaseId: ctx.leaseId, asOf: ctx.asOf };
  for (const call of plan) {
    if (!allowed.has(call.tool)) { records.push({ tool: call.tool, args: call.args, status: "rejected", summary: `not allowed for intent ${intent}`, fact_ids: [] }); continue; }
    if (calls >= MAX_TOOL_CALLS) { records.push({ tool: call.tool, args: call.args, status: "rejected", summary: `call cap of ${MAX_TOOL_CALLS} reached`, fact_ids: [] }); continue; }
    calls++;
    const name = call.tool as ToolName;
    const parsed = ToolArgs[name].safeParse(call.args);
    if (!parsed.success) { records.push({ tool: name, args: call.args, status: "rejected", summary: "arguments failed validation (ids and unknown keys are not accepted)", fact_ids: [] }); continue; }
    try {
      let made: Fact[] = [];
      let summary = "";
      if (name === "search_lease_clauses") {
        made = buildClauseFacts(ctx.ids, fctx, await ctx.store.searchClauses(ctx.leaseId, (parsed.data as ArgsOf<"search_lease_clauses">).queries, ctx.asOf));
        summary = `${made.length} clause(s) in force`;
      } else if (name === "get_balance_breakdown") {
        const a = parsed.data as ArgsOf<"get_balance_breakdown">;
        const snap = await ctx.store.getBalanceSnapshot(ctx.leaseId, effectiveAsOf(ctx.asOf, a.period));
        const f = buildBalanceFact(ctx.ids, fctx, snap.lines, snap.sql_balance_paise, a.period);
        made = [f];
        summary = `balance fact over ${f.lines.length} ledger line(s); TypeScript and SQL ${f.crosscheck.agree ? "agree" : "DISAGREE"}`;
      } else if (name === "get_payment_history") {
        const a = parsed.data as ArgsOf<"get_payment_history">;
        const events = await ctx.store.getPaymentEvents(ctx.leaseId, ctx.asOf);
        made = buildPaymentFacts(ctx.ids, fctx, events, a.period);
        summary = `${made.length} payment event(s)`;
      } else {
        const a = parsed.data as ArgsOf<"match_claimed_payment">;
        const claim: Claim = { amount_paise: a.amount_inr == null ? null : rupeesToPaise(a.amount_inr), date: a.date ?? null, reference: a.reference ?? null };
        const events = await ctx.store.getPaymentEvents(ctx.leaseId, ctx.asOf);
        const f = buildClaimMatch(ctx.ids, fctx, events, claim);
        made = [f];
        summary = f.matched ? `matched an event (${f.matched_state})` : "no matching event";
      }
      facts.push(...made);
      records.push({ tool: name, args: call.args, status: "ok", summary, fact_ids: made.map((f) => f.id) });
    } catch (e) {
      records.push({ tool: name, args: call.args, status: "error", summary: "tool failed", fact_ids: [] });
    }
  }
  return { facts, records };
}
