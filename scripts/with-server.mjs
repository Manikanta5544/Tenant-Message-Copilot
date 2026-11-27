// Starts the production server (`next start`), waits until it answers, runs one command against it, then stops the server. Same on Linux,
// macOS and Windows: no nohup, no `&`, no shell job control. Replaces the bash-only start/wait/kill sequence in CI.
//   node scripts/with-server.mjs [--port 3000] [--wait api/health] [--log server.log] -- "<command>"
// The command runs with BASE_URL set. Exit code is the command's. On failure the last 200 lines of the server log are printed.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { normalizeWaitPath } from "./lib/wait-path.mjs";

const argv = process.argv.slice(2);
const split = argv.indexOf("--");
const opts = argv.slice(0, split < 0 ? argv.length : split);
const command = split < 0 ? "" : argv.slice(split + 1).join(" ");
const opt = (name, def) => { const i = opts.indexOf(name); return i >= 0 && opts[i + 1] ? opts[i + 1] : def; };
const port = opt("--port", "3000"), waitPath = normalizeWaitPath(opt("--wait", "/")), logFile = opt("--log", "server.log");
if (!command) { console.error('usage: node scripts/with-server.mjs [--port N] [--wait PATH] [--log FILE] -- "<command>"'); process.exit(2); }

const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const url = `http://127.0.0.1:${port}`;
const log = fs.openSync(logFile, "w");
const server = spawn(process.execPath, [nextBin, "start", "-p", port, "-H", "127.0.0.1"], { stdio: ["ignore", log, log], env: process.env });
let serverExited = false;
server.on("exit", () => { serverExited = true; });

const stop = () => { if (!serverExited) server.kill("SIGTERM"); };
const tail = () => { try { console.log(`\n--- last 200 lines of ${logFile} ---\n${fs.readFileSync(logFile, "utf8").split("\n").slice(-200).join("\n")}`); } catch { /* no log */ } };

const waiter = spawn(process.execPath, [fileURLToPath(new URL("./wait-for.mjs", import.meta.url)), url + waitPath, "90"], { stdio: "inherit" });
const waited = await new Promise((resolve) => waiter.on("exit", resolve));
if (waited !== 0 || serverExited) { console.error("server did not become ready"); tail(); stop(); process.exit(1); }

// /api/health is liveness only: it answers 200 even when the configuration is invalid (for example a VISITOR_SALT shorter than the 32
// characters `next start` requires), and every page then renders its error panel. A browser suite would only report a 30 s locator timeout.
// Ask /api/ready for the configuration check and stop with the real reason. A database that is down is not fatal here (windows-layout has none).
try {
  const ready = await fetch(url + "/api/ready", { signal: AbortSignal.timeout(15000) }).then((r) => r.json());
  if (ready?.checks?.configuration && ready.checks.configuration.ok === false) {
    console.error(`server is running but its configuration is invalid: ${ready.checks.configuration.detail}`);
    tail(); stop(); process.exit(1);
  }
} catch { /* /api/ready unreachable or not JSON: let the command report what it sees */ }

const child = spawn(command, { shell: true, stdio: "inherit", env: { ...process.env, BASE_URL: url } });
const code = await new Promise((resolve) => child.on("exit", (c) => resolve(c ?? 1)));
if (code !== 0) tail();
stop();
process.exit(code);
