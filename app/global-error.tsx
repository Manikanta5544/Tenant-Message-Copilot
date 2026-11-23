"use client";
import { useState } from "react";

// Replaces the root layout when it fails, so it brings its own <html> and plain, token-free fallbacks.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [ref] = useState(() => error.digest ?? Math.random().toString(36).slice(2, 10));
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, display: "grid", minHeight: "100dvh", placeItems: "center", padding: 16, background: "#fff", color: "#111" }}>
        <main style={{ maxWidth: 440, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>Tenant Message Copilot</h1>
          <p role="alert" style={{ fontSize: 16, lineHeight: 1.5 }}>Something went wrong. Nothing was sent to anyone. Reference <code>{ref}</code>.</p>
          <button type="button" onClick={reset} style={{ marginTop: 12, minHeight: 44, padding: "0 20px", fontSize: 16, borderRadius: 8, border: "1px solid #1a1a1a", background: "#1a1a1a", color: "#fff", cursor: "pointer" }}>Try again</button>
          <button type="button" onClick={() => { try { void navigator.clipboard.writeText(`reference: ${ref}`); } catch { /* clipboard blocked */ } }} style={{ marginTop: 12, marginLeft: 8, minHeight: 44, padding: "0 20px", fontSize: 16, borderRadius: 8, border: "1px solid #1a1a1a", background: "#fff", color: "#1a1a1a", cursor: "pointer" }}>Copy details</button>
        </main>
      </body>
    </html>
  );
}
