"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { InboxRow as Row } from "../lib/types";
import { INTENT_LABEL } from "../lib/format";
import InboxRow from "./InboxRow";
import { Card } from "./ui/Card";
import { EmptyState } from "./ui/EmptyState";
import { Icon } from "./ui/Icon";
import { Skeleton } from "./ui/Skeleton";
import { cx } from "./ui/cx";

type Filter = "all" | "needs_review" | "escalate_only" | "unprocessed";
const FILTERS: { id: Filter; label: string; test: (m: Row) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "needs_review", label: "Needs review", test: (m) => m.run?.route === "needs_review" },
  { id: "escalate_only", label: "Escalate", test: (m) => m.run?.route === "escalate_only" },
  { id: "unprocessed", label: "Unprocessed", test: (m) => !m.run?.route },
];

/** Sticky header with search and filter chips (client-side only), then grouped sections. Up/Down move between rows, Enter opens. */
export default function InboxList({ rows, loaded, sel, seen, onSelect }: { rows: Row[]; loaded: boolean; sel: string | null; seen: Set<string>; onSelect: (r: Row) => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  // Counts are computed over the search results, so a chip's number always matches what its filter would show.
  const searched = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? rows.filter((m) => `${m.resident_name} ${m.unit} ${m.text} ${m.run?.intent ? INTENT_LABEL[m.run.intent] : ""}`.toLowerCase().includes(needle)) : rows;
  }, [rows, q]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, searched.filter(f.test).length])) as Record<Filter, number>, [searched]);
  const visible = useMemo(() => searched.filter(FILTERS.find((f) => f.id === filter)!.test), [searched, filter]);
  const pinned = visible.filter((m) => m.scenario_label), rest = visible.filter((m) => !m.scenario_label);

  // Arrow keys and j/k move between rows; Enter opens the focused row (it is a button). j/k are ignored while typing.
  const move = (dir: 1 | -1) => {
    const items = [...(box.current?.querySelectorAll<HTMLElement>("[data-inbox-row]") ?? [])];
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    (i < 0 ? items[dir === 1 ? 0 : items.length - 1] : items[Math.min(Math.max(i + dir, 0), items.length - 1)])?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); } else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || !t || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) return;
      if (e.key === "j") move(1); else if (e.key === "k") move(-1);
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  });

  return (
    <div ref={box} onKeyDown={onKey} className="space-y-4">
      <div className="sticky top-0 z-10 -mx-1 space-y-2 bg-bg/95 px-1 pb-2 pt-1 backdrop-blur">
        <div className="relative">
          <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <label htmlFor="inbox-search" className="sr-only">Search messages</label>
          <input id="inbox-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, unit or message" aria-keyshortcuts="j k" className="min-h-11 w-full rounded-lg border border-border-strong bg-surface pl-9 pr-3 text-base placeholder:text-faint sm:min-h-10" />
        </div>
        <div role="group" aria-label="Filter messages" className="flex flex-wrap gap-1.5 pb-1">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" onClick={() => setFilter(f.id)} aria-pressed={filter === f.id}
              className={cx("t flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm font-medium sm:min-h-8", filter === f.id ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-muted hover:bg-bg-subtle hover:text-text")}>
              {f.label}<span className="num text-xs">{loaded ? counts[f.id] : "–"}</span>
            </button>
          ))}
        </div>
      </div>

      {!loaded && <div role="status" aria-label="Loading messages" className="space-y-2">{[0, 1, 2, 3].map((i) => <Card key={i} className="flex gap-3 p-3"><Skeleton className="size-9 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="w-1/2" /><Skeleton className="w-full" /></div></Card>)}</div>}
      {loaded && rows.length === 0 && <EmptyState icon="inbox" title="The inbox is empty">Run <code>npm run migrate && npm run seed</code> to load the synthetic residents and messages.</EmptyState>}
      {loaded && rows.length > 0 && visible.length === 0 && <EmptyState icon="search" title="No messages match" action={<button type="button" className="min-h-11 rounded-lg px-3 text-base font-medium text-accent hover:underline" onClick={() => { setFilter("all"); setQ(""); }}>Clear filters</button>}>Try another filter or search term.</EmptyState>}
      {pinned.length > 0 && <Group title="Demo scenarios" hint="Five one-click walkthroughs"><Rows rows={pinned} sel={sel} seen={seen} onSelect={onSelect} /></Group>}
      {rest.length > 0 && <Group title="Inbox" hint={`${rest.length} message${rest.length === 1 ? "" : "s"}`}><Rows rows={rest} sel={sel} seen={seen} onSelect={onSelect} /></Group>}
    </div>
  );
}

function Group({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return <section aria-label={title}><div className="mb-2 flex items-baseline justify-between px-1"><h2 className="text-lg">{title}</h2><span className="text-sm text-muted">{hint}</span></div>{children}</section>;
}
function Rows({ rows, sel, seen, onSelect }: { rows: Row[]; sel: string | null; seen: Set<string>; onSelect: (r: Row) => void }) {
  return <Card as="div" className="overflow-hidden"><ul className="divide-y divide-border">{rows.map((m) => <li key={m.message_id}><InboxRow m={m} selected={sel === m.message_id} unread={!seen.has(m.message_id)} onSelect={onSelect} /></li>)}</ul></Card>;
}
