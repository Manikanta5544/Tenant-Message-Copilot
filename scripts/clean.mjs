// `npm run clean`: removes build output and caches (cross-platform; no rm -rf, works in PowerShell and cmd).
import fs from "node:fs";
for (const p of [".next", ".tmc-fingerprint", "tsconfig.tsbuildinfo", "node_modules/.cache"]) {
  try { fs.rmSync(p, { recursive: true, force: true }); console.log(`removed ${p}`); } catch (e) { console.error(`could not remove ${p}: ${e.message}`); process.exitCode = 1; }
}
console.log("Clean. Run `npm run dev` again. If the page still looks wrong, open it in a private window with extensions off.");
