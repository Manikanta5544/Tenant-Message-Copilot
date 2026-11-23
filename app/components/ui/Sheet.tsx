"use client";
import { useEffect, useRef } from "react";
import { Icon } from "./Icon";
import { cx } from "./cx";

/** Modal sheet: a bottom sheet on narrow screens, a centred panel on wide ones. Esc, the backdrop and the close button dismiss it;
 *  focus moves in on open and returns to the trigger on close; Tab stays inside. */
export function Sheet({ open, onClose, title, children, className }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; className?: string }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const focusables = () => [...(panel.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])') ?? [])];
    (focusables()[0] ?? panel.current)?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key !== "Tab") return;
      const f = focusables(); if (!f.length) return;
      const first = f[0]!, last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); before?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-text/40 md:items-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className={cx("sheet-in flex max-h-[85dvh] w-full flex-col rounded-t-lg border border-border bg-raised shadow-pop md:max-w-lg md:rounded-lg", className)}>
        <div className="flex min-h-11 items-center justify-between border-b border-border px-4">
          <h2 className="text-base">{title}</h2>
          <button type="button" onClick={onClose} aria-label={`Close ${title}`} className="t -mr-2 grid size-11 place-items-center rounded-md text-muted hover:bg-bg-subtle hover:text-text md:size-8"><Icon name="x" size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
