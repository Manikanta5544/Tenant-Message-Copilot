/** What an API error response tells the operator. The shapes come from app/server/http.ts `fail()`. */
export interface ApiProblem { status: number; message: string; code?: string; hint?: string; reference?: string; host?: string; port?: number; missing?: string[] }

export async function readProblem(res: Response, fallback: string): Promise<ApiProblem> {
  let j: Record<string, unknown> = {};
  try { j = (await res.json()) as Record<string, unknown>; } catch { /* non-JSON body */ }
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  return {
    status: res.status,
    message: str(j.error) ?? fallback,
    code: str(j.code), hint: str(j.hint), reference: str(j.correlation_id), host: str(j.host), port: typeof j.port === "number" ? j.port : undefined,
    missing: Array.isArray(j.missing) ? j.missing.filter((x): x is string => typeof x === "string") : undefined,
  };
}

/** Network failure (fetch itself rejected). */
export const networkProblem = (message: string): ApiProblem => ({ status: 0, message });

export const SETUP_COMMANDS = "npm run migrate && npm run seed";
