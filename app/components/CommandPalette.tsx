"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isPaletteKey, rank, type Command } from "../lib/palette";
import type { InboxRow } from "../lib/types";
import { Dot, statusOf } from "./ui/Dot";
import { cx } from "./ui/cx";

/** Ctrl/Cmd+K. Jump to a message by name, unit or text; go to a page; flip the theme; process everything not yet processed.
 *  Keyboard only is enough: arrows move, Enter runs, Esc closes; focus stays in the box while it is open and returns afterwards. */
export default function CommandPalette({ startOpen = false }: { startOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(startOpen);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const [rows, setRows] = useState<InboxRow[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const before = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);

  const close = useCallback(() => { setOpen(false); setQ(""); setAt(0); before.current?.focus?.(); }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (isPaletteKey(e)) { e.preventDefault(); if (open) close(); else { before.current = document.activeElement as HTMLElement | null; setOpen(true); } } };
    const ext = () => { before.current = document.activeElement as HTMLElement | null; setOpen(true); };
    window.addEventListener("keydown", key); window.addEventListener("tmc:palette", ext);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("tmc:palette", ext); };
  }, [open, close]);
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    let live = true;
    fetch("/api/inbox").then((r) => (r.ok ? r.json() : null)).then((j: { messages?: InboxRow[] } | null) => { if (live && j?.messages) setRows(j.messages); }).catch(() => {});
    return () => { live = false; };
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => router.push(href);
    const theme = () => {
      const now = document.documentElement.getAttribute("data-theme") === "dark" || (!document.documentElement.getAttribute("data-theme") && matchMedia("(prefers-color-scheme: dark)").matches) ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", now);
      try { document.cookie = `theme=${now}; Path=/; Max-Age=31536000; SameSite=Lax`; } catch { /* cookies blocked */ }
      window.dispatchEvent(new Event("tmc:theme"));
    };
    const processAll = () => { if (location.pathname !== "/") router.push("/"); setTimeout(() => window.dispatchEvent(new Event("tmc:process-all")), location.pathname === "/" ? 0 : 600); };
    return [
      { id: "inbox", group: "Go to", label: "Inbox", keywords: "messages home", run: go("/") },
      { id: "evals", group: "Go to", label: "Evals", keywords: "tests scores gate", run: go("/evals") },
      { id: "about", group: "Go to", label: "About", keywords: "how it works", run: go("/about") },
      { id: "system", group: "Go to", label: "System", keywords: "status latency health budget", run: go("/system") },
      { id: "theme", group: "Action", label: "Toggle theme", keywords: "dark light", run: theme },
      { id: "process", group: "Action", label: "Process all unprocessed", keywords: "run batch drafts", run: processAll },
      { id: "export-csv", group: "Action", label: "Export review log (CSV)", keywords: "audit download", run: () => window.dispatchEvent(new CustomEvent("tmc:export-audit", { detail: "csv" })) },
      { id: "export-json", group: "Action", label: "Export review log (JSON)", keywords: "audit download", run: () => window.dispatchEvent(new CustomEvent("tmc:export-audit", { detail: "json" })) },
      ...rows.map((m): Command => ({ id: m.message_id, group: "Message", label: `${m.resident_name}, ${m.unit}`, hint: m.text.slice(0, 80), keywords: `${m.text} ${m.scenario_label ?? ""}`, run: go(`/?m=${m.message_id}`) })),
    ];
  }, [rows, router]);
  const list = useMemo(() => rank(commands, q).slice(0, 12), [commands, q]);
  useEffect(() => { setAt(0); }, [q]);
  if (!open) return null;
  const run = (c?: Command) => { if (!c) return; close(); c.run(); };
  const statusFor = (id: string) => rows.find((r) => r.message_id === id);
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-text/40 px-4 pt-[12vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="palette-in w-full max-w-lg overflow-hidden rounded-lg border border-border bg-raised shadow-pop">
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={list[at] ? `pal-${list[at]!.id}` : undefined} aria-autocomplete="list"
          placeholder="Jump to a message or run a command" className="min-h-11 w-full border-b border-border bg-transparent px-4 text-base outline-none placeholder:text-faint"
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); close(); }
            else if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => Math.min(list.length - 1, i + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
            else if (e.key === "Enter") { e.preventDefault(); run(list[at]); }
            else if (e.key === "Tab") e.preventDefault(); // focus stays in the box
          }} />
        <ul id="palette-list" role="listbox" aria-label="Results" className="max-h-[50dvh] overflow-y-auto py-1">
          {list.length === 0 && <li className="px-4 py-3 text-muted" role="status">Nothing matches “{q}”.</li>}
          {list.map((c, i) => (
            <li key={c.id} id={`pal-${c.id}`} role="option" aria-selected={i === at} onMouseMove={() => setAt(i)} onClick={() => run(c)}
              className={cx("flex min-h-11 min-w-0 cursor-pointer items-center gap-3 px-4 py-1.5", i === at && "bg-bg-subtle")}>
              {c.group === "Message" && <Dot status={statusOf(statusFor(c.id)?.run?.route)} />}
              <span className="min-w-0 flex-1"><span className="block truncate text-base">{c.label}</span>{c.hint && <span className="block truncate text-sm text-muted">{c.hint}</span>}</span>
              <span className="shrink-0 text-xs text-faint">{c.group}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
