// Baseline runs for the seeded scenarios (decision D3): runs.visitor_hash IS NULL, produced by the real pipeline with the
// configured provider. Every visitor sees these until they generate their own run. Created by `npm run seed`.
import type { LLMProvider } from "@/core/provider";
import { randomUUID } from "node:crypto";
import { appUrl, withScope } from "./client";
import { DEMO_ORG_ID } from "./ids";
import { startRun } from "./runs";

export async function seedBaselines(provider: LLMProvider, log: (s: string) => void = () => {}): Promise<{ created: number; kept: number }> {
  const todo = await withScope(appUrl(), { orgId: DEMO_ORG_ID, view: "inbox" }, async (db) =>
    (await db.query<{ id: string; label: string; ok: boolean }>(
      `SELECT m.id, m.scenario_label AS label,
              EXISTS (SELECT 1 FROM runs r WHERE r.message_id = m.id AND r.visitor_hash IS NULL AND r.status = 'completed') AS ok
         FROM messages m WHERE m.source = 'seeded' AND m.scenario_label IS NOT NULL ORDER BY m.scenario_label`)).rows);
  let created = 0, kept = 0;
  for (const m of todo) {
    if (m.ok) { kept++; continue; }
    await startRun({ messageId: m.id, idempotencyKey: randomUUID(), provider, visitor: null });
    created++;
    log(`baseline run for ${m.label}`);
  }
  return { created, kept };
}
