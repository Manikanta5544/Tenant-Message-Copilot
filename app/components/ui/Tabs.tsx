"use client";
import { useRef } from "react";
import { cx } from "./cx";

export interface TabDef<T extends string> { id: T; label: string; count?: number }
/** Accessible tab list: roving tabindex, arrow keys, Home/End. Panels are rendered by the caller with matching ids. */
export function Tabs<T extends string>({ tabs, value, onChange, label, idPrefix }: { tabs: TabDef<T>[]; value: T; onChange: (t: T) => void; label: string; idPrefix: string }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (i: number) => { const t = tabs[(i + tabs.length) % tabs.length]!; onChange(t.id); refs.current[t.id]?.focus(); };
  return (
    <div role="tablist" aria-label={label} className="tabs-scroll flex gap-4 border-b border-border">
      {tabs.map((t, i) => (
        <button key={t.id} ref={(el) => { refs.current[t.id] = el; }} role="tab" id={`${idPrefix}-tab-${t.id}`} aria-controls={`${idPrefix}-panel-${t.id}`} aria-selected={value === t.id} tabIndex={value === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => { if (e.key === "ArrowRight") { e.preventDefault(); move(i + 1); } else if (e.key === "ArrowLeft") { e.preventDefault(); move(i - 1); } else if (e.key === "Home") { e.preventDefault(); move(0); } else if (e.key === "End") { e.preventDefault(); move(tabs.length - 1); } }}
          className={cx("t -mb-px flex min-h-11 items-center gap-1.5 whitespace-nowrap border-b-2 text-base font-medium md:min-h-9", value === t.id ? "border-accent text-text" : "border-transparent text-muted hover:text-text")}>
          {t.label}{t.count !== undefined && <span className="tnum text-sm text-faint">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
