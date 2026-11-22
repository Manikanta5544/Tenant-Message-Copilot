// Structured JSON logs (decision D7): one line per run. Never message text, IPs or keys; the visitor is a hash prefix.
export interface RunLog {
  run_id: string; route: string | null; outcome: "completed" | "failed"; mode: string | null;
  stage_latency_ms: Record<string, number>; tokens_in: number; tokens_out: number; cost_micro_usd: number;
  visitor: string | null; error?: string;
}
export const visitorPrefix = (h: string | null) => (h ? h.slice(0, 8) : null);
export function logRun(l: RunLog, sink: (line: string) => void = (s) => console.log(s)) {
  sink(JSON.stringify({ level: l.outcome === "completed" ? "info" : "error", msg: "run", ts: new Date().toISOString(), ...l }));
}
