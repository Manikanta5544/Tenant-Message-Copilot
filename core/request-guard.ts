// Cheap checks for state-changing API requests, run before any route code.
export interface GuardRejection { status: 403 | 415; error: string; code: "unsupported_media_type" | "cross_site" }
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** null = allow. A browser always sends Sec-Fetch-Site (and Origin on POST); a script or curl sends neither and cannot be a CSRF vector, so it is allowed. */
export function guardStateChange(method: string, h: Headers, host: string | null): GuardRejection | null {
  if (!STATE_CHANGING.has(method.toUpperCase())) return null;
  // A cross-site form can only send text/plain, urlencoded or multipart without a CORS preflight; JSON-only closes that route.
  if (!/^application\/json(\s*;|$)/i.test(h.get("content-type") ?? "")) return { status: 415, error: "Content-Type must be application/json.", code: "unsupported_media_type" };
  const site = h.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return { status: 403, error: "Cross-site requests are not allowed.", code: "cross_site" };
  const origin = h.get("origin");
  if (origin && host) {
    let originHost: string | null = null;
    try { originHost = new URL(origin).host; } catch { /* malformed Origin is rejected below */ }
    if (originHost !== host) return { status: 403, error: "Cross-site requests are not allowed.", code: "cross_site" };
  }
  return null;
}
