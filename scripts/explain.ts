// Prints EXPLAIN (ANALYZE, BUFFERS) for the hot read paths as markdown, under the same role and row-level scope the app uses.
// Run: npm run explain   (needs DATABASE_URL_APP and a migrated, seeded database; run a few runs first for realistic counts)
import pg from "pg";
import { DEMO_ORG_ID } from "../db/ids";

const url = process.env.DATABASE_URL_APP;
if (!url) { console.error("DATABASE_URL_APP is not set"); process.exit(1); }

const Q: { name: string; sql: string; params: (ctx: { runId: string; messageId: string }) => unknown[] }[] = [
  { name: "Run lookup (GET /api/runs/:id)", sql: `SELECT r.*, m.text AS message_text, s.name, s.unit, s.preferred_language FROM runs r JOIN messages m ON m.id = r.message_id JOIN residents s ON s.id = r.resident_id WHERE r.id = $1`, params: (c) => [c.runId] },
  { name: "Trace rows for a run, in order", sql: `SELECT seq, stage, model, tokens_in, tokens_out, cost_micro_usd::text, latency_ms, outcome, payload, created_at FROM trace_events WHERE run_id = $1 ORDER BY seq`, params: (c) => [c.runId] },
  { name: "Live stream poll: rows after a sequence number", sql: `SELECT seq FROM trace_events WHERE run_id = $1 AND seq > $2 ORDER BY seq`, params: (c) => [c.runId, 3] },
  { name: "Inbox (GET /api/inbox)", sql: `SELECT m.id, m.text, lr.id AS run_id, lr.route FROM messages m JOIN residents r ON r.id = m.resident_id LEFT JOIN LATERAL (SELECT * FROM runs WHERE message_id = m.id AND (visitor_hash = $1 OR visitor_hash IS NULL) ORDER BY (visitor_hash IS NULL), created_at DESC LIMIT 1) lr ON true WHERE m.source = 'seeded' OR (m.visitor_hash IS NOT NULL AND m.visitor_hash = $1) ORDER BY (m.scenario_label IS NULL), m.scenario_label, m.created_at DESC`, params: () => ["explain-visitor"] },
  { name: "Single-flight check (POST /api/runs)", sql: `SELECT id FROM runs WHERE message_id = $1 AND COALESCE(visitor_hash,'') = $2 AND status = 'running' LIMIT 1`, params: (c) => [c.messageId, ""] },
  { name: "Review actions for a run (reviewer log)", sql: `SELECT ra.id, ra.run_id, ra.action, ra.edited_text, ra.created_at FROM review_actions ra JOIN runs r ON r.id = ra.run_id WHERE r.message_id = (SELECT message_id FROM runs WHERE id = $1) AND ra.visitor_hash = $2 ORDER BY ra.created_at, ra.id`, params: (c) => [c.runId, "explain-visitor"] },
  { name: "Per-visitor hourly count", sql: `SELECT count(*) FROM runs WHERE visitor_hash = $1 AND created_at > now() - interval '60 minutes'`, params: () => ["explain-visitor"] },
];

async function plan(c: pg.PoolClient, sql: string, params: unknown[]) {
  const r = await c.query(`EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) ${sql}`, params);
  return r.rows.map((x) => x["QUERY PLAN"] as string).join("\n");
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
const c = await pool.connect();
try {
  await c.query("BEGIN");
  await c.query("SELECT set_config('app.org_id', $1, true), set_config('app.resident_id', '', true), set_config('app.view', 'inbox', true)", [DEMO_ORG_ID]);
  const run = (await c.query(`SELECT r.id, r.message_id FROM runs r WHERE status='completed' ORDER BY (SELECT count(*) FROM trace_events t WHERE t.run_id = r.id) DESC LIMIT 1`)).rows[0] as { id: string; message_id: string } | undefined;
  if (!run) { console.error("No completed run found: run npm run seed first."); process.exit(1); }
  const counts = (await c.query(`SELECT (SELECT count(*) FROM runs) AS runs, (SELECT count(*) FROM trace_events) AS trace_events, (SELECT count(*) FROM messages) AS messages`)).rows[0];
  console.log(`Row counts at measurement time: runs ${counts.runs}, trace_events ${counts.trace_events}, messages ${counts.messages}.\n`);
  for (const q of Q) {
    const p = q.params({ runId: run.id, messageId: run.message_id });
    console.log(`### ${q.name}\n\nPlanner's choice:\n\n\`\`\`\n${await plan(c, q.sql, p)}\n\`\`\`\n`);
    await c.query("SET LOCAL enable_seqscan = off");
    console.log(`With sequential scans disabled (shows an index exists for it):\n\n\`\`\`\n${await plan(c, q.sql, p)}\n\`\`\`\n`);
    await c.query("SET LOCAL enable_seqscan = on");
  }
  await c.query("ROLLBACK");
} finally { c.release(); await pool.end(); }
