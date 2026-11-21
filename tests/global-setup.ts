// Resets and prepares the test database once per run: drop schema, migrate, seed.
import pg from "pg";
import { migrate } from "../db/migrate";
import { seed } from "../db/seed";

export default async function setup() {
  const owner = process.env.TEST_DATABASE_URL_OWNER;
  if (!owner) { console.warn("TEST_DATABASE_URL_OWNER not set: database tests will be skipped (unverified)."); return; }
  const c = new pg.Client({ connectionString: owner });
  await c.connect();
  await c.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO PUBLIC;");
  await c.end();
  await migrate(owner, "app");
  await seed(owner);
}
