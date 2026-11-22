import { getEnv } from "../core/env";
// Applies db/migrations/*.sql in order over the DIRECT owner connection (never the pooler).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { MIGRATIONS } from "./manifest";

export async function migrate(ownerUrl: string, appRolePassword?: string): Promise<string[]> {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
  const onDisk = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  if (JSON.stringify(onDisk) !== JSON.stringify([...MIGRATIONS])) {
    throw new Error(`db/manifest.ts does not match db/migrations: ${onDisk.join(",")}`);
  }
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const done = new Set((await client.query("SELECT version FROM schema_migrations")).rows.map((r) => r.version as string));
    for (const f of onDisk) {
      if (done.has(f)) continue;
      await client.query("BEGIN");
      try {
        await client.query(fs.readFileSync(path.join(dir, f), "utf8"));
        await client.query("INSERT INTO schema_migrations(version) VALUES ($1)", [f]);
        await client.query("COMMIT");
        applied.push(f);
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`migration ${f} failed: ${(e as Error).message}`);
      }
    }
    await client.query("GRANT SELECT ON schema_migrations TO copilot_app");
    if (appRolePassword) {
      await client.query(`ALTER ROLE copilot_app PASSWORD ${client.escapeLiteral(appRolePassword)}`);
    }
  } finally {
    await client.end();
  }
  return applied;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = getEnv().DATABASE_URL_OWNER;
  if (!url) { console.error("DATABASE_URL_OWNER is not set (direct owner connection)."); process.exit(1); }
  migrate(url, getEnv().APP_ROLE_PASSWORD).then(
    (a) => console.log(a.length ? `applied: ${a.join(", ")}` : "up to date"),
    (e) => { console.error(e.message); process.exit(1); },
  );
}
