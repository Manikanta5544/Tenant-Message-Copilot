// Clears a stale .next before dev/build. A cache built from a different folder, lockfile, stylesheet or config is a known cause of an
// unstyled or half-styled page (utilities generated for another project state). The fingerprint covers: project path, package.json,
// the lockfile, globals.css, next/postcss config, Node major, and the list and sizes of files under app/ (NOT mtimes: those change on every
// save and would throw the cache away on each restart).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const h = crypto.createHash("sha256");
h.update(`path:${root}\nnode:${process.versions.node.split(".")[0]}\n`);
for (const f of ["package.json", "package-lock.json", "app/globals.css", "next.config.ts", "next.config.js", "next.config.mjs", "postcss.config.mjs", "postcss.config.js", "tsconfig.json"]) {
  try { h.update(`${f}:${crypto.createHash("sha256").update(fs.readFileSync(path.join(root, f))).digest("hex")}\n`); } catch { /* absent */ }
}
function walk(dir) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(p)); else out.push(`${path.relative(root, p)}:${fs.statSync(p).size}`);
  }
  return out;
}
try { h.update(walk(path.join(root, "app")).sort().join("\n")); } catch { /* no app dir */ }
const fp = h.digest("hex").slice(0, 16);

const file = path.join(root, ".tmc-fingerprint");
let prev = null; try { prev = fs.readFileSync(file, "utf8").trim(); } catch { /* first run */ }
const next = path.join(root, ".next");
if (fs.existsSync(next) && prev !== fp) {
  fs.rmSync(next, { recursive: true, force: true });
  console.log(prev ? "Cleared a stale .next folder (project path, dependencies, stylesheet or config changed since it was built)." : "Cleared an unverified .next folder (no fingerprint recorded; it may have been built elsewhere).");
}
fs.writeFileSync(file, fp);
