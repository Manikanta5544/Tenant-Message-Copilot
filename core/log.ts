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

/** Error text safe to log: connection strings, API keys and bearer tokens removed, length capped. */
export function redactSecrets(m: string): string {
  return m
    .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, "postgres://[redacted]")
    .replace(/\b(gsk_|sk-ant-|sk-)[A-Za-z0-9_-]{8,}/g, "[redacted-key]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
}
export const safeErrorMessage = (e: unknown): string => redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 300);

export interface ErrorLog { correlation_id: string; route: string; error_name: string; message: string; pg_code?: string; stack?: string }
export function logError(l: ErrorLog, sink: (line: string) => void = (s) => console.error(s)) {
  sink(JSON.stringify({ level: "error", msg: "unhandled", ts: new Date().toISOString(), ...l }));
}
