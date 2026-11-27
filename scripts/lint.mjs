// Dependency-free lint: project rules that a generic linter would not know. Fails (exit 1) on any hit.
import fs from "node:fs";
import path from "node:path";

const ROOTS = ["app", "core", "db", "scripts", "evals", "proxy.ts"];
const rules = [
  { name: "no `as any`", re: /\bas any\b/, skip: (f) => f.startsWith("tests/") },
  { name: "no process.env outside core/env.ts (D6)", re: /process\.env/, skip: (f) => f === "core/env.ts" || f === "core/dev.ts" || f === "proxy.ts" || f.startsWith("scripts/") || f.startsWith("evals/") },
  { name: "no hard-coded hex colours in components", re: /#[0-9a-fA-F]{3,8}\b/, only: (f) => f.startsWith("app/components/") || f === "app/not-found.tsx" || f === "app/error.tsx" },
  { name: "dangerouslySetInnerHTML only for the nonce'd theme script", re: /dangerouslySetInnerHTML/, skip: (f) => f === "app/layout.tsx" },
  { name: "no console.log of request bodies or messages", re: /console\.log\([^)]*(message|body|text)\b/ , skip: (f) => f.startsWith("scripts/") || f.startsWith("evals/") || f.startsWith("db/") },
];
const files = [];
const walk = (p) => {
  if (!fs.existsSync(p)) return;
  const st = fs.statSync(p);
  if (st.isDirectory()) { for (const e of fs.readdirSync(p)) walk(path.join(p, e)); }
  // Rules match on forward-slash paths; path.join() yields backslashes on Windows, which made every path-based exemption miss.
  else if (/\.(ts|tsx)$/.test(p)) files.push(p.split(path.sep).join("/"));
};
ROOTS.forEach(walk);
let bad = 0;
for (const f of files) {
  const lines = fs.readFileSync(f, "utf8").split("\n");
  for (const r of rules) {
    if (r.skip?.(f) || (r.only && !r.only(f))) continue;
    lines.forEach((l, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
      if (r.re.test(l)) { bad++; console.error(`${f}:${i + 1}: ${r.name}\n    ${l.trim().slice(0, 140)}`); }
    });
  }
}
console.log(bad ? `lint: ${bad} problem(s)` : `lint: ok (${files.length} files, ${rules.length} rules)`);
process.exit(bad ? 1 : 0);
