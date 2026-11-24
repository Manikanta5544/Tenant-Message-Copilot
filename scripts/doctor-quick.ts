// `predev`: a fast, WARN-ONLY pre-flight (env file, variables, database, migrations, baselines).
// One actionable line per problem. It always exits 0: it must never stop `next dev`.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { failureLines, runChecks } from "../db/diagnostics";

export async function quickCheck(raw: Record<string, string | undefined> = process.env, cwd = process.cwd()): Promise<string[]> {
  return failureLines(await runChecks(raw, { cwd }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  quickCheck().then((w) => {
    if (!w.length) console.log("doctor --quick: env, database, migrations and baselines look good.");
    for (const l of w) console.warn(`doctor --quick: WARN ${l}`);
  }).catch((e) => console.warn(`doctor --quick: skipped (${e instanceof Error ? e.message.split("\n")[0] : e})`)).finally(() => process.exit(0));
}
