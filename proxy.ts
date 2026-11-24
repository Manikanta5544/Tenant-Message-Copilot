// Next 16 proxy (successor of middleware): per-request CSP nonce and security headers on every response.
import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, newNonce, staticSecurityHeaders } from "@/core/security";

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
  for (const [k, v] of Object.entries(staticSecurityHeaders(!dev))) res.headers.set(k, v);
  if (req.nextUrl.pathname.startsWith("/api/")) res.headers.set("Cache-Control", "no-store");
  return res;
}

export const config = {
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)" }],
};
