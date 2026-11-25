"use client";
import { forwardRef, useImperativeHandle, useMemo, useRef, useState, useDeferredValue } from "react";
import type { InboxRow as Row } from "../lib/types";
import { INTENT_LABEL } from "../lib/format";
import InboxRow from "./InboxRow";
import { EmptyState } from "./ui/EmptyState";
import { Icon } from "./ui/Icon";
import { Kbd } from "./ui/Kbd";
import { Skeleton } from "./ui/Skeleton";

export interface InboxHandle { focusSearch: () => void; move: (dir: 1 | -1) => void }
const GROUPS = [
  { id: "needs", label: "Needs you", test: (m: Row) => m.run?.route === "needs_review" || m.run?.route === "escalate_only" },
  { id: "ready", label: "Ready", test: (m: Row) => m.run?.route === "draft_ready" },
  { id: "none", label: "Unprocessed", test: (m: Row) => !m.run?.route },
] as const;

/** Search, then three groups with counts. Roving tabindex; Arrow keys and j/k move, Enter opens, `/` focuses search (handled by Workbench). */
const InboxList = forwardRef<InboxHandle, { rows: Row[]; loaded: boolean; sel: string | null; seen: Set<string>; onSelect: (r: Row) => void }>(function InboxList({ rows, loaded, sel, seen, onSelect }, ref) {
  const [q, setQ] = useState("");
  // The input stays instant; filtering and regrouping the list can lag a frame behind a fast typist.
  const dq = useDeferredValue(q);
  const box = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const visible = useMemo(() => {
    const needle = dq.trim().toLowerCase();
    return needle ? rows.filter((m) => `${m.resident_name} ${m.unit} ${m.text} ${m.run?.intent ? INTENT_LABEL[m.run.intent] : ""}`.toLowerCase().includes(needle)) : rows;
  }, [rows, dq]);
  const groups = GROUPS.map((g) => ({ ...g, rows: visible.filter(g.test) })).filter((g) => g.rows.length);
  const order = groups.flatMap((g) => g.rows);
  // Exactly one row is in the tab order: the selected one, else the first.
  const tabbableId = order.find((m) => m.message_id === sel)?.message_id ?? order[0]?.message_id;

  const move = (dir: 1 | -1) => {
    const items = [...(box.current?.querySelectorAll<HTMLElement>("[data-inbox-row]") ?? [])];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const cur = i >= 0 ? i : Math.max(0, items.findIndex((e) => e.dataset.id === sel));
    const next = items[i < 0 && sel === null ? (dir === 1 ? 0 : items.length - 1) : Math.min(Math.max(cur + dir, 0), items.length - 1)];
    next?.focus();
  };
  useImperativeHandle(ref, () => ({ focusSearch: () => search.current?.focus(), move }));

  return (
    <div ref={box} onKeyDown={(e) => { if (e.target instanceof HTMLInputElement) return; if (e.key === "ArrowDown") { e.preventDefault(); move(1); } else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); } }} className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-3 py-2">
        <label htmlFor="inbox-search" className="sr-only">Search messages</label>
        <div className="relative">
          <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input ref={search} id="inbox-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, unit or message" aria-keyshortcuts="/" className="min-h-11 w-full rounded-md border border-border-strong bg-surface pl-8 pr-8 text-base placeholder:text-faint md:min-h-8" />
          <Kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 max-md:hidden">/</Kbd>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="inbox-scroll">
        {!loaded && <div role="status" aria-label="Loading messages">{[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} aria-hidden className="grid grid-cols-[14px_1fr] gap-x-2.5 border-b border-border px-3 py-2.5"><Skeleton className="mt-1 size-2.5 rounded-full" /><div className="space-y-2"><div className="flex gap-2"><Skeleton className="h-3.5 w-1/3" /><Skeleton className="ml-auto h-3.5 w-6" /></div><Skeleton className="h-3 w-5/6" /></div></div>))}</div>}
        {loaded && rows.length === 0 && <EmptyState title="The inbox is empty">Run <code>npm run migrate && npm run seed</code> to load the synthetic residents and messages.</EmptyState>}
        {loaded && rows.length > 0 && order.length === 0 && <EmptyState title="No messages match" action={<button type="button" className="min-h-11 text-base font-medium text-accent underline underline-offset-4 md:min-h-7" onClick={() => setQ("")}>Clear search</button>}>Try another search term.</EmptyState>}
        {groups.map((g) => (
          <section key={g.id} aria-label={g.label}>
            <h2 className="label-caps sticky top-0 z-10 flex items-center justify-between border-b border-border bg-bg px-3 py-1.5">{g.label}<span className="tnum font-normal">{g.rows.length}</span></h2>
            {g.rows.map((m) => <InboxRow key={m.message_id} m={m} selected={sel === m.message_id} unread={!seen.has(m.message_id)} tabbable={m.message_id === tabbableId} onSelect={onSelect} />)}
          </section>
        ))}
      </div>
    </div>
  );
});
export default InboxList;
