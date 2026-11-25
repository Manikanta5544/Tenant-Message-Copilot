// Security header construction (decision D2). Pure functions so they can be unit-tested.
export function buildCsp(nonce: string, dev = false): string {
  const d: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'strict-dynamic' lets the nonced Next bootstrap load its chunks; host allow-lists are ignored by CSP3 browsers.
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    // Residual risk (documented in NOTE.md): Tailwind/next-font inject inline styles, so styles stay 'unsafe-inline'. Scripts do not.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:"],
    "font-src": ["'self'"],
    "connect-src": ["'self'", ...(dev ? ["ws:", "wss:"] : [])],
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
  };
  const parts = Object.entries(d).map(([k, v]) => `${k} ${v.join(" ")}`);
  if (!dev) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

/** Headers that do not depend on the request. */
export function staticSecurityHeaders(prod: boolean, hstsPreload = false): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), hid=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), serial=(), usb=(), xr-spatial-tracking=()",
    "X-Frame-Options": "DENY",
    ...(prod ? { "Strict-Transport-Security": `max-age=63072000; includeSubDomains${hstsPreload ? "; preload" : ""}` } : {}),
  };
}

export const newNonce = (): string => {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
};
