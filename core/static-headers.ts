// Headers for /_next/static. Kept out of next.config.ts so tests import this module, never the framework's config file
// (a config-file export mismatch otherwise breaks both `tsc` and `next build`, which type-check tests/**).
/** `immutable` is only safe when the file name changes with its content, which is true of production builds (content-hashed names).
 *  The development server does not do that: Turbopack names the CSS chunk from the module path (app_xxxxx._.css), so the same URL carries
 *  different content after every edit. With a year-long immutable entry a browser profile kept the first stylesheet it ever saw for
 *  localhost and rendered every later build with it (an old stylesheet under new HTML; a private window, with an empty cache, was fine).
 *  In development no Cache-Control is sent, so Next's own `no-store` applies. */
export function staticAssetHeaders(env: string | undefined): { key: string; value: string }[] {
  const h = [{ key: "X-Content-Type-Options", value: "nosniff" }];
  if (env === "production") h.push({ key: "Cache-Control", value: "public, max-age=31536000, immutable" });
  return h;
}
