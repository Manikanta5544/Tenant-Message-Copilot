import { appUrl, withScope } from "@/db/client";
import { DEMO_ORG_ID } from "@/db/ids";
import { MIGRATIONS } from "@/db/manifest";
import { liveConfigured } from "@/app/server/provider";
import { providerMode } from "@/core/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Check = { ok: boolean; detail?: string };

/** Readiness: database reachable, migrations current, restricted role in effect, and production secrets set.
 *  Model availability is reported by /api/demo/status (it must not make this endpoint flap on a provider outage). */
export async function GET() {
  const checks: Record<string, Check> = {};
  try {
    await withScope(appUrl(), { orgId: DEMO_ORG_ID }, async (db) => {
      const mig = await db.query<{ version: string }>("SELECT version FROM schema_migrations ORDER BY version");
      const have = mig.rows.map((r) => r.version);
      const missing = MIGRATIONS.filter((m) => !have.includes(m));
      checks.database = { ok: true };
      checks.migrations = missing.length ? { ok: false, detail: `missing: ${missing.join(", ")}` } : { ok: true };
      const role = await db.query<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>(
        "SELECT current_user, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user");
      const r = role.rows[0];
      checks.restricted_role = !!r && !r.rolsuper && !r.rolbypassrls ? { ok: true, detail: r.current_user } : { ok: false, detail: "runtime role can bypass RLS" };
    });
  } catch {
    checks.database = { ok: false, detail: "database unreachable" };
  }
  const prod = process.env.NODE_ENV === "production";
  const salt = process.env.VISITOR_SALT;
  checks.visitor_salt = !prod || (salt && salt !== "change-me" && salt !== "demo") ? { ok: true } : { ok: false, detail: "set VISITOR_SALT to a random value" };
  const mode = providerMode();
  checks.provider_config = mode !== "live" || liveConfigured() ? { ok: true, detail: mode } : { ok: false, detail: "PROVIDER_MODE=live but no LLM key is set" };

  const ok = Object.values(checks).every((c) => c.ok);
  return Response.json({ status: ok ? "ready" : "not_ready", checks }, { status: ok ? 200 : 503 });
}
