import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { staticAssetHeaders } from "./core/static-headers";

const here = path.dirname(fileURLToPath(import.meta.url));
const config: NextConfig = {
  poweredByHeader: false,
  // Pin the workspace root to this folder. A folder nested inside a copy of itself ("tenant-copilot (4)/tenant-copilot") otherwise triggers
  // root inference (and the multiple-lockfile warning) and can send file watching and CSS source detection to the wrong place.
  turbopack: { root: here },
  // Dev only: the Next.js "N" badge sits bottom-right; the layout keeps it clear of the footer and composer (checked in e2e).
  devIndicators: { position: "bottom-right" },
  // `next build` type-checks this config's tsconfig only: tests/, e2e/ and scripts/ are checked by `npm run typecheck`, so a bad test file
  // can never block a production build.
  typescript: { tsconfigPath: "tsconfig.build.json" },
  serverExternalPackages: ["pg", "ws"],
  // Recorded model responses are read from disk at runtime by replay mode.
  outputFileTracingIncludes: { "/api/runs": ["./evals/fixtures/**/*"] },
  // The CSP (with its per-request nonce) and the other security headers are set in proxy.ts.
  // Static assets get the non-CSP headers here so they are covered even though the proxy skips them.
  async headers() {
    return [{ source: "/_next/static/:path*", headers: staticAssetHeaders(process.env.NODE_ENV) }];
  },
};
export default config;
