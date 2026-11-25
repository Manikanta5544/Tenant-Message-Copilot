// Visitor identity for rate limits when no trusted proxy tells us the client address.
// The cookie is `<id>.<tag>`: a random id and an HMAC of it under the server secret, so a client can keep or drop its cookie but cannot
// choose another visitor's id or invent a valid one. Residual risk (docs/RUNBOOK.md): a client that discards cookies and reloads the page
// gets a new id each time; the global daily run cap and the daily budget remain the hard stop.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export const VISITOR_COOKIE = "tmc_v";
const tag = (secret: string, id: string) => createHmac("sha256", secret).update(`visitor-cookie|${id}`).digest("base64url").slice(0, 22);

export function mintVisitorCookie(secret: string): string {
  const id = randomBytes(16).toString("base64url");
  return `${id}.${tag(secret, id)}`;
}

/** The visitor id when the Cookie header carries a cookie we signed; null otherwise (absent, malformed or forged). */
export function readVisitorId(cookieHeader: string | null, secret: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k !== VISITOR_COOKIE) continue;
    const [id, t] = rest.join("=").split(".");
    if (!id || !t || id.length !== 22) return null;
    const want = Buffer.from(tag(secret, id)), got = Buffer.from(t);
    return want.length === got.length && timingSafeEqual(want, got) ? id : null;
  }
  return null;
}

/** The client address a trusted proxy appended. The LEFT of x-forwarded-for is whatever the client sent, so we count from the right:
 *  hops = how many trusted proxies sit in front of us (1 = the last entry is the address our nearest proxy saw). */
export function trustedClientIp(h: Headers, hops: number, vercel: boolean): string | null {
  const single = vercel ? h.get("x-vercel-forwarded-for") : null;
  for (const v of [single, h.get("x-real-ip")]) { const ip = v?.split(",")[0]?.trim(); if (ip && isIP(ip)) return ip; }
  const parts = (h.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ip = parts[parts.length - Math.max(1, hops)];
  return ip && isIP(ip) ? ip : null;
}
