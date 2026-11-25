// Next 16 proxy (successor of middleware): per-request CSP nonce and security headers on every response.
import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, newNonce, staticSecurityHeaders } from "@/core/security";
import { VISITOR_COOKIE, mintVisitorCookie, readVisitorId } from "@/core/visitor";

export function proxy(req: NextRequest) {
  const dev = process.env.NODE_ENV !== "production";
  const nonce = newNonce();
  const csp = buildCsp(nonce, dev);
  const reqHeaders = new Headers(req.headers);
  // Next reads the nonce from the request's CSP header and applies it to its own scripts; there is no inline script of ours.
  reqHeaders.set("content-security-policy", csp);
  reqHeaders.set("x-nonce", nonce);
  const res = NextResponse.next({ request: { headers: reqHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  for (const [k, v] of Object.entries(staticSecurityHeaders(!dev, process.env.HSTS_PRELOAD === "1"))) res.headers.set(k, v);
  const api = req.nextUrl.pathname.startsWith("/api/");
  if (api) res.headers.set("Cache-Control", "no-store");
  // A browser gets its signed visitor id from a page load. API calls never mint one: a client that only calls the API (a script) stays in
  // the shared cookie-less bucket instead of getting a fresh identity per request.
  const secret = process.env.VISITOR_SALT ?? "demo";
  if (!api && !readVisitorId(req.headers.get("cookie"), secret)) {
    const https = req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
    res.cookies.set(VISITOR_COOKIE, mintVisitorCookie(secret), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365, secure: https });
  }
  return res;
}

export const config = {
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)" }],
};
