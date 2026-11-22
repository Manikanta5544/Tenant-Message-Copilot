import { getEnv, rawEnv } from "../core/env";
// Drops and rebuilds the schema of the DATABASE_URL_OWNER database, then migrates and seeds. Dev only.
import pg from "pg";
import { migrate } from "./migrate";
import { seed } from "./seed";

const url = getEnv().DATABASE_URL_OWNER;
if (!url) { console.error("DATABASE_URL_OWNER is not set."); process.exit(1); }
if (!/localhost|127\.0\.0\.1/.test(url) && rawEnv().ALLOW_REMOTE_RESET !== "yes") { console.error("Refusing to reset a non-local database. Set ALLOW_REMOTE_RESET=yes to override."); process.exit(1); }
const c = new pg.Client({ connectionString: url });
await c.connect();
await c.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO PUBLIC;");
await c.end();
console.log("applied:", (await migrate(url, getEnv().APP_ROLE_PASSWORD)).join(", "));
await seed(url);
console.log("seeded");
if (!process.argv.includes("--no-baselines")) {
  const { createProvider } = await import("../app/server/provider");
  const { seedBaselines } = await import("./baselines");
  const { closeAllPools } = await import("./client");
  const r = await seedBaselines(createProvider(), (m) => console.log(m));
  await closeAllPools();
  console.log(`baselines: ${r.created} created`);
}
