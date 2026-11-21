import { defineConfig } from "vitest/config";
import path from "node:path";
import fs from "node:fs";

// Load .env for local runs (CI sets the variables directly).
if (fs.existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: { globalSetup: ["tests/global-setup.ts"], include: ["tests/**/*.test.ts"], testTimeout: 30000, hookTimeout: 60000, fileParallelism: false },
});
