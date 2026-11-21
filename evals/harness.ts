// Runs one message through the real pipeline against the database as the restricted runtime role.
// The owner connection is used only to look up the sending resident by unit (test and eval setup).
import pg from "pg";
import { runPipeline, type BudgetPort, type PipelineOutput, type TraceEvent } from "@/core/pipeline";
import type { LLMProvider } from "@/core/provider";
import type { Language } from "@/core/types";
import { makeScopedStore } from "@/db/store";
import { ORG_A, ORG_B } from "@/db/ids";

export interface Resident { id: string; unit: string; name: string; language: Language; org: string }
const orgId = (o: "A" | "B") => (o === "A" ? ORG_A : ORG_B);

export async function findResident(ownerUrl: string, unit: string, org: "A" | "B" = "A"): Promise<Resident> {
  const c = new pg.Client({ connectionString: ownerUrl });
  await c.connect();
  try {
    const r = await c.query("SELECT id, unit, name, preferred_language FROM residents WHERE unit = $1 AND organization_id = $2", [unit, orgId(org)]);
    if (!r.rows[0]) throw new Error(`no resident in unit ${unit}`);
    return { id: r.rows[0].id, unit, name: r.rows[0].name, language: r.rows[0].preferred_language, org: orgId(org) };
  } finally { await c.end(); }
}

export const unlimitedBudget = (): BudgetPort & { settled: number[] } => {
  const settled: number[] = [];
  return { reserve: async () => true, settle: async (_e, a) => { settled.push(a); }, settled };
};

export interface HarnessRun { output: PipelineOutput; events: TraceEvent[]; resident: Resident }
export async function runMessage(a: {
  appUrl: string; ownerUrl: string; provider: LLMProvider; unit: string; org?: "A" | "B"; message: string; asOf: string; budget?: BudgetPort;
}): Promise<HarnessRun> {
  const resident = await findResident(a.ownerUrl, a.unit, a.org ?? "A");
  const events: TraceEvent[] = [];
  const store = makeScopedStore(a.appUrl, { orgId: resident.org, residentId: resident.id });
  const output = await runPipeline(
    { provider: a.provider, store, budget: a.budget ?? unlimitedBudget(), emit: async (e) => { events.push(e); }, now: () => performance.now() },
    { message: a.message, residentId: resident.id, ownUnit: resident.unit, preferredLanguage: resident.language, asOf: a.asOf });
  return { output, events, resident };
}
