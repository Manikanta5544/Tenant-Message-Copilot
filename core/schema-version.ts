// Schema guard: the code expects every migration in the manifest to be applied. A database that is behind
// (for example after pulling new code without running `npm run migrate`) must fail with a clear, actionable
// 503, never with an opaque 500 from a query against a table or column that does not exist.

export const SCHEMA_HINT = "Run: npm run migrate && npm run seed";

export class SchemaOutOfDateError extends Error {
  readonly hint = SCHEMA_HINT;
  constructor(public missing: string[]) {
    super(`Database schema is out of date (missing ${missing.join(", ")}). ${SCHEMA_HINT}`);
    this.name = "SchemaOutOfDateError";
  }
}

export const missingMigrations = (applied: readonly string[], manifest: readonly string[]): string[] => {
  const have = new Set(applied);
  return manifest.filter((m) => !have.has(m));
};

/** Postgres "undefined table / undefined column": the symptom of running new code on an old schema. */
export const isSchemaDriftCode = (code: unknown): boolean => code === "42P01" || code === "42703";

/**
 * Cached guard. A successful check is remembered for the life of the process; a failed check is NOT cached, so the
 * next request re-checks and recovers as soon as the operator has migrated (no restart needed). Concurrent callers share one check.
 */
export function createSchemaGuard(readApplied: () => Promise<string[]>, manifest: readonly string[]) {
  let ok = false;
  let inflight: Promise<void> | null = null;
  const check = async () => {
    const missing = missingMigrations(await readApplied(), manifest);
    if (missing.length) throw new SchemaOutOfDateError(missing);
    ok = true;
  };
  return {
    ensure(): Promise<void> {
      if (ok) return Promise.resolve();
      inflight ??= check().finally(() => { inflight = null; });
      return inflight;
    },
    reset() { ok = false; },
  };
}
