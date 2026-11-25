"use client";
import { useEffect, useState } from "react";
import { extensionMarkers, measureStyles, type StyleReport } from "../lib/style-probe";
import { classifyStyleCause, collectOriginState, resetSiteState, type CauseReport, type OriginState } from "../lib/style-cause";

/** Development only. Checks that the stylesheet the browser actually uses behaves as built, and says so when it does not. */
export default function StyleProbe() {
  const [r, setR] = useState<StyleReport | null>(null);
  const [copied, setCopied] = useState(false);
  const [why, setWhy] = useState<{ report: CauseReport; origin: OriginState } | null>(null);
  useEffect(() => {
    const run = () => { const m = measureStyles(); setR(m.ok ? null : m); if (!m.ok) console.warn("StyleProbe:", m.problems.join("; ")); if (!m.ok) void collectOriginState(extensionMarkers()).then((origin) => setWhy({ report: classifyStyleCause(origin), origin })).catch(() => setWhy(null)); };
    const t = setTimeout(run, 800);
    window.addEventListener("resize", run);
    return () => { clearTimeout(t); window.removeEventListener("resize", run); };
  }, []);
  if (!r) return null;
  const copy = async () => { try { await navigator.clipboard.writeText(JSON.stringify({ problems: r.problems, cause: why?.report.cause ?? "pending", originState: why?.origin ?? null, ...r.diagnostics }, null, 2)); setCopied(true); } catch { /* clipboard blocked */ } };
  return (
    <div role="alert" data-testid="style-probe" style={{ position: "fixed", left: 8, right: 8, bottom: 8, zIndex: 80, maxWidth: 640, margin: "0 auto", padding: "10px 12px", border: "1px solid var(--border-strong)", borderLeft: "3px solid var(--escalate-line)", borderRadius: 6, background: "var(--surface-raised)", color: "var(--text)", font: "14px/1.5 system-ui, sans-serif" }}>
      <p style={{ margin: 0 }} data-cause={why?.report.cause ?? "pending"}>{why ? why.report.advice : "The page's styles do not match the build. Checking why…"}</p>
      <p style={{ margin: "4px 0 0", color: "var(--text-muted)" }}>{r.problems[0]}</p>
      <p style={{ margin: "6px 0 0" }}><button type="button" onClick={copy} style={{ font: "inherit", textDecoration: "underline", background: "none", border: 0, padding: 0, color: "var(--accent)", cursor: "pointer" }}>{copied ? "Copied" : "Copy diagnostics"}</button>{why?.report.cause !== "extension" && <> · <button type="button" onClick={() => void resetSiteState()} style={{ font: "inherit", textDecoration: "underline", background: "none", border: 0, padding: 0, color: "var(--accent)", cursor: "pointer" }}>Reset site data and reload</button></>} · <a href="/setup/layout" style={{ color: "var(--accent)" }}>Live layout check</a></p>
    </div>
  );
}
