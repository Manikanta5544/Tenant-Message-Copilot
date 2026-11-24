// Fails if any secret value or key-shaped string appears in the client bundle (.next/static) (Phase 1, secrets).
// Secret values come from the environment of the build; key prefixes are matched regardless.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SECRET_ENV = ["LLM_API_KEY", "ANTHROPIC_API_KEY", "DATABASE_URL_APP", "DATABASE_URL_OWNER", "VISITOR_SALT", "APP_ROLE_PASSWORD", "TEST_DATABASE_URL_APP", "TEST_DATABASE_URL_OWNER"];
export const KEY_PATTERNS = [/gsk_[A-Za-z0-9]{20,}/, /sk-ant-[A-Za-z0-9_-]{20,}/, /sk-[A-Za-z0-9]{32,}/, /postgres(?:ql)?:\/\/[^\s"'`]+:[^\s"'`@]+@/];

export function scan(dir, env = process.env) {
  const hits = [];
  const needles = SECRET_ENV.map((k) => [k, env[k]]).filter(([, v]) => v && v.length >= 8);
  const walk = (p) => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const f = path.join(p, e.name);
      if (e.isDirectory()) { walk(f); continue; }
      if (!/\.(js|mjs|css|html|json|map|txt)$/.test(e.name)) continue;
      const text = fs.readFileSync(f, "utf8");
      for (const [k, v] of needles) if (text.includes(v)) hits.push(`${f}: contains the value of ${k}`);
      for (const re of KEY_PATTERNS) if (re.test(text)) hits.push(`${f}: matches ${re}`);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return hits;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2] ?? ".next/static";
  if (!fs.existsSync(dir)) { console.error(`scan-bundle: ${dir} not found: run the build first`); process.exit(2); }
  const hits = scan(dir);
  if (hits.length) { console.error(hits.join("\n")); console.error("scan-bundle: SECRET REACHED THE CLIENT BUNDLE"); process.exit(1); }
  console.log(`scan-bundle: clean (${dir})`);
}
