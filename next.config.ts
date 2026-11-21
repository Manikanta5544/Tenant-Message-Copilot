import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["pg", "ws"],
  // Recorded model responses are read from disk at runtime by replay mode.
  outputFileTracingIncludes: { "/api/runs": ["./evals/fixtures/**/*"] },
};
export default config;
