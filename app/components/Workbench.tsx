"use client";
import { resetNote } from "../lib/reset-time";
import { useCallback, useEffect, useRef, useState } from "react";
import type { InboxRow, ReviewRow } from "../lib/types";
import type { RunState } from "../lib/run-state";
import Composer, { type Resident } from "./Composer";
import InboxList, { type InboxHandle } from "./InboxList";
import dynamic from "next/dynamic";
// The detail view (draft, evidence, trace) is not needed to paint the inbox; it loads on first selection (and is prefetched when idle).
const loadWorkspace = () => import("./Workspace");
const Workspace = dynamic(loadWorkspace, { ssr: false, loading: () => <div className="px-4 pt-4 md:px-6" role="status" aria-label="Loading message"><div className="skeleton h-5 w-1/3" /><div className="skeleton mt-4 h-24 w-full" /></div> });
import { Dot } from "./ui/Dot";
import Overview, { type OverviewFacts } from "./Overview";
import { Kbd } from "./ui/Kbd";
import { Sheet } from "./ui/Sheet";
import SetupPanel from "./SetupPanel";
import ProblemPanel from "./ProblemPanel";
import { networkProblem, readProblem, type ApiProblem } from "../lib/problem";
import { isDev } from "@/core/dev";
import { watchRun } from "../lib/run-stream";
import BatchBar from "./BatchBar";
import { plainText } from "../lib/format";

type Inbox = { messages: InboxRow[]; residents: Resident[]; overview?: OverviewFacts; setup?: { baselines_missing: number; dev: boolean } };

/** Owns the data: inbox, per-message run state, polling, idempotency keys and the 429/stale handling. Presentation lives in the components it renders. */
export default function Workbench() {
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [loadErr, setLoadErr] = useState<ApiProblem | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [online, setOnline] = useState(true);
  const [seen, setSeen] = useState<Set<string>>(new Set());

  // Unread dots are a per-browser convenience; storage may be unavailable, so every access is guarded.
  useEffect(() => { try { setSeen(new Set(JSON.parse(localStorage.getItem("tmc-seen") ?? "[]") as string[])); } catch { /* storage unavailable */ } }, []);
  const markSeen = (id: string) => setSeen((s) => { if (s.has(id)) return s; const n = new Set(s).add(id); try { localStorage.setItem("tmc-seen", JSON.stringify([...n].slice(-200))); } catch { /* ignore */ } return n; });
  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", up); window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/inbox");
      if (!r.ok) { setLoadErr(await readProblem(r, "The inbox could not be loaded.")); return; }
      setInbox(await r.json()); setLoadErr(null);
    } catch { setLoadErr(networkProblem("The inbox could not be loaded. Check your connection, then try again.")); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  // The server answers POST /api/runs at once and finishes the pipeline afterwards. The run is watched over a live stream
  // (EventSource) and falls back to polling by itself; either way the steps shown are real stored trace events.
  const watchers = useRef<Map<string, () => void>>(new Map());
  const bc = useRef<BroadcastChannel | null>(null);
  useEffect(() => () => { watchers.current.forEach((c) => c()); watchers.current.clear(); }, []);
  // Other tabs of this browser: a finished run or a review decision in one tab updates the others without a reload.
  const selRef = useRef<string | null>(null); selRef.current = sel;
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    let ch: BroadcastChannel;
    try { ch = new BroadcastChannel("tmc"); } catch { return; }
    bc.current = ch;
    ch.onmessage = (e: MessageEvent) => {
      const m = e.data as { type?: string; messageId?: string; runId?: string } | null;
      if (!m || typeof m.messageId !== "string" || typeof m.runId !== "string") return;
      const { messageId, runId } = m;
      void refresh();
      // Only re-read what this tab already shows; a tab that never opened the message has nothing to update.
      void (async () => {
        try {
          const r = await fetch(`/api/runs/${runId}`); if (!r.ok) return;
          const j = (await r.json()) as { run: import("../lib/types").RunView; trace: import("../lib/types").TraceRow[]; reviews?: ReviewRow[] };
          if (j.run.status === "running") return;
          setRuns((s) => { const c = s[messageId]; if (!c || c.status === "loading" || (c.status === "ready" && c.run.id !== runId && m.type === "review")) return s; return { ...s, [messageId]: { status: "ready", run: j.run, trace: j.trace, reviews: j.reviews ?? [] } }; });
        } catch { /* offline: the next open reads it */ }
      })();
    };
    return () => { ch.close(); bc.current = null; };
  }, [refresh]);
  const loadRun = useCallback((messageId: string, runId: string): Promise<void> => new Promise<void>((resolve) => {
    watchers.current.get(messageId)?.();
    setRuns((s) => ({ ...s, [messageId]: { status: "loading", live: false } }));
    const fail = (status: number | null) => {
      setRuns((s) => ({ ...s, [messageId]: { status: "error", message: status === 503 ? "The database needs an update before drafts can load." : "The saved draft could not be loaded." } }));
      watchers.current.delete(messageId); resolve();
    };
    const cancel = watchRun(runId, {
      onTrace: (rows) => { const last = rows[rows.length - 1]!; setRuns((s) => ({ ...s, [messageId]: { status: "loading", live: true, label: `Working… ${rows.length} steps done, latest: ${last.stage.replace(/_/g, " ")}`, steps: rows.map((t) => t.stage) } })); },
      onDone: (j) => {
        setRuns((s) => ({ ...s, [messageId]: { status: "ready", run: j.run, trace: j.trace, reviews: j.reviews ?? [] } }));
        watchers.current.delete(messageId);
        try { bc.current?.postMessage({ type: "run", messageId, runId }); } catch { /* channel closed */ }
        resolve();
      },
      onError: fail,
    });
    watchers.current.set(messageId, cancel);
  }), []);

  const select = useCallback((row: InboxRow, push = true) => {
    setSel(row.message_id); markSeen(row.message_id);
    // A link to /?m=<message id> opens exactly this message.
    if (push) { try { window.history.pushState(null, "", `/?m=${row.message_id}`); } catch { /* ignore */ } }
    setRuns((s) => { if (!s[row.message_id] && row.run) void loadRun(row.message_id, row.run.id); return s; });
  }, [loadRun]);
  const back = () => { setSel(null); try { window.history.pushState(null, "", "/"); } catch { /* ignore */ } };

  // Open the message named in the URL once the inbox is loaded, and follow Back/Forward.
  useEffect(() => { const t = setTimeout(() => { void loadWorkspace(); }, 4000); return () => clearTimeout(t); }, []);
  const rowsRef = useRef<InboxRow[]>([]);
  rowsRef.current = inbox?.messages ?? [];
  useEffect(() => {
    if (!inbox) return;
    const open = () => {
      const id = new URLSearchParams(window.location.search).get("m");
      const row = id ? rowsRef.current.find((m) => m.message_id === id) : null;
      if (row) select(row, false); else if (!id) setSel(null);
    };
    open();
    window.addEventListener("popstate", open);
    return () => window.removeEventListener("popstate", open);
  }, [inbox === null, select]); // eslint-disable-line react-hooks/exhaustive-deps

  // Records a reviewer decision (append-only, server-side). Nothing is sent to a tenant.
  const review = async (row: InboxRow, runId: string, a: { action: "approved" | "edited" | "regenerated"; edited_text?: string }): Promise<{ ok: true } | { ok: false; reason: string }> => {
    try {
      const r = await fetch(`/api/runs/${runId}/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...a, idempotency_key: crypto.randomUUID() }) });
      const j = await r.json();
      if (!r.ok) return { ok: false, reason: (j.reason ?? j.error ?? "The decision could not be recorded.") as string };
      try { bc.current?.postMessage({ type: "review", messageId: row.message_id, runId }); } catch { /* channel closed */ }
      setRuns((s) => { const c = s[row.message_id]; return c?.status === "ready" && c.run.id === runId ? { ...s, [row.message_id]: { ...c, reviews: [...c.reviews, j.review as ReviewRow] } } : s; });
      return { ok: true };
    } catch { return { ok: false, reason: "The decision could not be recorded. Check your connection and try again." }; }
  };

  const prevText = useRef<Record<string, string>>({});
  const generate = async (row: InboxRow) => {
    const prev = runs[row.message_id];
    if (prev?.status === "ready" && prev.run.route !== "escalate_only") prevText.current[row.message_id] = plainText(prev.run.segments as never);
    if (prev?.status === "ready") void review(row, prev.run.id, { action: "regenerated" }); // best effort: history only
    setRuns((s) => ({ ...s, [row.message_id]: { status: "loading", live: true, label: "Reading the lease and ledger, drafting and checking…" } }));
    try {
      const r = await fetch("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message_id: row.message_id, idempotency_key: crypto.randomUUID() }) });
      const j = await r.json();
      if (r.status === 429) { setRuns((s) => ({ ...s, [row.message_id]: { status: "error", message: (j.error ?? "This demo's limit is reached.") + (resetNote(j.retry_after_s ?? r.headers.get("retry-after")) || " Try again later.") } })); return; }
      if (!r.ok) {
        const p = await readProblem(new Response(JSON.stringify(j), { status: r.status }), "The draft could not be generated.");
        setRuns((s) => ({ ...s, [row.message_id]: { status: "error", message: p.code === "schema_out_of_date" ? "The database needs an update before drafts can be generated." : "The draft could not be generated.", hint: p.hint, reference: p.reference, code: p.code } }));
        return;
      }
      await loadRun(row.message_id, j.run_id);
      void refresh();
    } catch { setRuns((s) => ({ ...s, [row.message_id]: { status: "error", message: "The draft could not be generated. Nothing was sent. Try again." } })); }
  };

  const rows = inbox?.messages ?? [];
  useEffect(() => { const h = (e: Event) => { void import("../lib/audit").then((m) => m.exportAudit(rowsRef.current, (e as CustomEvent<"csv" | "json">).detail)); }; window.addEventListener("tmc:export-audit", h); return () => window.removeEventListener("tmc:export-audit", h); }, []);
  // While a batch runs, rows that are being worked on show as loading in the list; finished ones appear when the inbox refreshes.
  const lastDone = useRef(0);
  const onBatch = useCallback((st: import("../lib/batch").BatchState) => { if (st.done !== lastDone.current) { lastDone.current = st.done; void refresh(); } }, [refresh]);
  const current = rows.find((m) => m.message_id === sel) ?? null;

  // Keyboard: / search, j/k move, ? shortcuts, e edit, a approve. Ignored while typing and while a dialog is open.
  const list = useRef<InboxHandle>(null);
  const [help, setHelp] = useState(false);
  useEffect(() => { const o = () => setHelp(true); window.addEventListener("tmc:help", o); return () => window.removeEventListener("tmc:help", o); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || !t || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (e.key === "j") list.current?.move(1);
      else if (e.key === "k") list.current?.move(-1);
      else if (e.key === "/") { e.preventDefault(); list.current?.focusSearch(); }
      else if (e.key === "?") setHelp(true);
      else if (e.key === "e" && current) window.dispatchEvent(new Event("tmc:edit"));
      else if (e.key === "a" && current) window.dispatchEvent(new Event("tmc:approve"));
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [current]);

  return (
    <main id="main" tabIndex={-1} data-pane={current ? "detail" : "list"} className="panes outline-none">
      <section aria-label="Inbox" className="pane-list">
        <div className="flex min-h-11 items-center justify-between border-b border-border px-3">
          <h1 className="text-base">Tenant Message Copilot</h1>
          <button type="button" onClick={() => setHelp(true)} aria-label="Keyboard shortcuts" aria-haspopup="dialog" className="t grid size-11 place-items-center rounded-md text-muted hover:bg-bg-subtle hover:text-text md:size-8"><Kbd>?</Kbd></button>
        </div>
        {!online && <p role="alert" className="border-b border-border border-l-2 border-l-review-line px-3 py-2 text-sm text-text">You are offline. Messages on screen stay readable; generating a draft needs a connection.</p>}
        {loadErr && <ProblemPanel problem={loadErr} dev={isDev()} onRetry={refresh} />}
        {!loadErr && inbox?.setup && <SetupPanel missing={inbox.setup.baselines_missing} dev={inbox.setup.dev} />}
        {!loadErr && <InboxList ref={list} rows={rows} loaded={!!inbox} sel={sel} seen={seen} onSelect={select} />}
        {!loadErr && inbox && <BatchBar rows={rows} onProgress={onBatch} onFinished={refresh} />}
        {inbox && <Composer residents={inbox.residents} onCreated={async (id) => { await refresh(); setSel(id); }} />}
      </section>

      <section aria-label="Message detail" className="pane-detail">
        {current ? (
          <Workspace key={current.message_id} row={current} thread={rows.filter((m) => m.resident_id === current.resident_id && m.message_id !== current.message_id)} state={runs[current.message_id] ?? { status: "idle" }} previousText={prevText.current[current.message_id]} onGenerate={() => generate(current)} onBack={back} onReview={(runId, a) => review(current, runId, a)} />
        ) : (
          <Overview rows={rows} facts={inbox?.overview} onSelect={select} />
        )}
      </section>
      <Sheet open={help} onClose={() => setHelp(false)} title="Keyboard shortcuts">
        <dl className="grid grid-cols-[5rem_1fr] items-center gap-y-2 text-base">
          {[["j / k", "Next / previous message"], ["Enter", "Open the focused message"], ["/", "Search the inbox"], ["a", "Approve the draft"], ["e", "Edit the draft"], ["?", "Show this list"], ["Esc", "Close a dialog"]].map(([k, v]) => <div key={k} className="contents"><dt><Kbd>{k}</Kbd></dt><dd>{v}</dd></div>)}
        </dl>
        <h3 className="mt-5 text-base">What the marks mean</h3>
        <p className="mt-1 text-sm text-muted">Each state has its own shape as well as its colour, and the word appears on the selected or hovered row.</p>
        <ul className="mt-2 grid grid-cols-2 gap-y-1.5 text-base">
          {(["ready", "review", "escalate", "none"] as const).map((s) => <li key={s}><Dot status={s} label /></li>)}
        </ul>
        <p className="mt-2 text-sm text-muted">Filled circle, thick ring, square, thin hollow ring.</p>
      </Sheet>
    </main>
  );
}
