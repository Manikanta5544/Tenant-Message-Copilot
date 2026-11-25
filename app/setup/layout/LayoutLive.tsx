"use client";
import { useEffect, useState } from "react";
import { measureStyles, type StyleReport } from "../../lib/style-probe";

export default function LayoutLive() {
  const [r, setR] = useState<StyleReport | null>(null);
  useEffect(() => {
    const run = () => setR(measureStyles());
    run(); window.addEventListener("resize", run); const t = setInterval(run, 1500);
    return () => { window.removeEventListener("resize", run); clearInterval(t); };
  }, []);
  if (!r) return <p className="mt-4 text-muted">Measuring…</p>;
  return (
    <div className="mt-4">
      <p role="status" className="text-base font-medium" data-testid="layout-status">{r.ok ? "Stylesheet and layout match the viewport." : `Problem: ${r.problems.join("; ")}`}</p>
      <dl className="mt-3 divide-y divide-border border-y border-border text-base">
        {Object.entries(r.diagnostics).map(([k, v]) => (
          <div key={k} className="grid grid-cols-[12rem_1fr] gap-x-3 py-1.5"><dt className="text-muted">{k}</dt><dd className="wrap-anywhere tnum min-w-0">{Array.isArray(v) ? (v.length ? v.join(", ") : "none") : String(v)}</dd></div>
        ))}
      </dl>
    </div>
  );
}
