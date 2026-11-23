// Server pages must never throw to the root error boundary because the database or configuration is unavailable.
// safe() runs a loader and returns a typed problem instead of throwing; the page renders its own designed error panel.
import { ConfigMissingError, DbUnavailableError, asDbUnavailable } from "@/core/db-errors";
import { SchemaOutOfDateError, SCHEMA_HINT, isSchemaDriftCode } from "@/core/schema-version";

export interface Problem { code: "config_missing" | "database_unreachable" | "database_auth_failed" | "database_missing" | "database_error" | "schema_out_of_date" | "unexpected"; hint?: string; host?: string; port?: number; missing?: string[]; reference: string }
export type Safe<T> = { ok: true; data: T } | { ok: false; problem: Problem };

/** Turns any thrown value into a Problem (no stack, no credentials). Exported for tests. */
export function toProblem(e: unknown, reference = Math.random().toString(16).slice(2, 10)): Problem {
  e = asDbUnavailable(e);
  if (e instanceof ConfigMissingError) return { code: "config_missing", hint: e.hint, missing: e.missing, reference };
  if (e instanceof DbUnavailableError) return { code: e.code, hint: e.hint, host: e.host, port: e.port, reference };
  if (e instanceof SchemaOutOfDateError || isSchemaDriftCode((e as { code?: unknown } | null)?.code)) return { code: "schema_out_of_date", hint: SCHEMA_HINT, reference };
  return { code: "unexpected", reference };
}

export async function safe<T>(load: () => Promise<T>): Promise<Safe<T>> {
  try { return { ok: true, data: await load() }; }
  catch (e) {
    const problem = toProblem(e);
    console.error(JSON.stringify({ level: "error", msg: "page load failed", code: problem.code, reference: problem.reference, name: e instanceof Error ? e.name : "error" }));
    return { ok: false, problem };
  }
}
