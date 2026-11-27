// Optional: run WEB_CONCURRENCY copies of `next start` behind one port using Node's cluster module (default: one per CPU, max 8).
// Caveats: each worker has its own in-memory state (inbox cache, SSE caps, LLM concurrency), so SSE caps and model concurrency
// multiply by the worker count; per-visitor and per-network limits live in the database and stay exact. Use it only on a multi-core host.
import cluster from "node:cluster";
import os from "node:os";
import { createRequire } from "node:module";

const want = Number(process.env.WEB_CONCURRENCY) || Math.min(8, os.availableParallelism());
const workers = Math.max(1, Math.min(want, 8));
if (cluster.isPrimary) {
  console.log(`start-cluster: ${workers} worker(s) on ${os.availableParallelism()} CPU(s)`);
  for (let i = 0; i < workers; i++) cluster.fork();
  cluster.on("exit", (w, code) => { console.error(`worker ${w.process.pid} exited (${code}); restarting`); setTimeout(() => cluster.fork(), 1000); });
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { for (const w of Object.values(cluster.workers ?? {})) w?.kill(sig); process.exit(0); });
} else {
  const require = createRequire(import.meta.url);
  process.argv.splice(2, 0, "start");
  require(require.resolve("next/dist/bin/next"));
}
