// `npm run verify:neon`: runs the database isolation tests against a SEPARATE Neon branch (TEST_DATABASE_URL_*).
// The test setup drops and rebuilds the schema on that database, so this refuses to run if the URLs point at the
// application's own database. Exit code 0 = every isolation test passed against Neon.
import { spawnSync } from "node:child_process";
import { rawEnv } from "../core/env";

const e = rawEnv();
const owner = e.TEST_DATABASE_URL_OWNER, app = e.TEST_DATABASE_URL_APP;
const die = (m: string): never => { console.error(`verify:neon: ${m}`); process.exit(2); };
if (!owner || !app) die("set TEST_DATABASE_URL_OWNER (direct URL) and TEST_DATABASE_URL_APP (pooled URL) for a separate Neon branch, e.g. a branch named `test`. See docs/NEON.md.");
const host = (u: string) => { try { return new URL(u).host + new URL(u).pathname; } catch { return die("a database URL is not valid"); } };
if (host(owner!) === host(e.DATABASE_URL_OWNER ?? "") || host(app!) === host(e.DATABASE_URL_APP ?? "")) die("TEST_DATABASE_URL_* points at the application database. The tests drop and rebuild the schema: use a separate Neon branch.");
if (!/neon\.tech/.test(owner!)) console.warn("note: the owner URL does not look like a Neon host; running anyway.");

console.log("Running RLS isolation, append-only review log and visitor-scope tests against the test branch...\n");
const r = spawnSync("npx", ["vitest", "run", "tests/isolation.test.ts", "tests/visitor-and-review.test.ts", "tests/abuse.test.ts"], { stdio: "inherit", env: process.env });
console.log(r.status === 0 ? "\nverify:neon: PASS (isolation tests passed against the test database)" : "\nverify:neon: FAIL (see the output above)");
process.exit(r.status ?? 1);
