import { defineConfig } from "vitest/config";
import path from "node:path";
import fs from "node:fs";

// Load .env for local runs (CI sets the variables directly).
if (fs.existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  // Worker threads, not forked processes: on a Windows laptop each forked worker took ~10 s to start (56 files, 641 s in total) and vitest then failed
  // with "Timeout starting forks runner" although every test had passed. Threads start in milliseconds and every test file still gets its own isolated context.
  test: { pool: "threads", globalSetup: ["tests/global-setup.ts"], include: ["tests/**/*.test.ts"], testTimeout: 30000, hookTimeout: 60000, fileParallelism: false },
});
