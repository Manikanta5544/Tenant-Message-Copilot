"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { InboxRow, ReviewRow, RunView, TraceRow } from "../lib/types";
import type { RunState } from "../lib/run-state";
import Composer, { type Resident } from "./Composer";
import InboxList, { type InboxHandle } from "./InboxList";
import Workspace from "./Workspace";
import { Dot } from "./ui/Dot";
import Overview, { type OverviewFacts } from "./Overview";
import { Kbd } from "./ui/Kbd";
import { Sheet } from "./ui/Sheet";
import SetupPanel from "./SetupPanel";
import ProblemPanel from "./ProblemPanel";
import { networkProblem, readProblem, type ApiProblem } from "../lib/problem";
import { isDev } from "@/core/dev";

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

  // The server answers POST /api/runs at once and finishes the pipeline afterwards, so the trace fills in while we poll.
  const loadRun = useCallback(async (messageId: string, runId: string) => {
    setRuns((s) => ({ ...s, [messageId]: { status: "loading", live: false } }));
    const started = Date.now();
    try {
      for (;;) {
        const r = await fetch(`/api/runs/${runId}`);
        if (!r.ok) { const p = await readProblem(r, "The saved draft could not be loaded."); setRuns((s) => ({ ...s, [messageId]: { status: "error", message: p.code === "schema_out_of_date" ? "The database needs an update before drafts can load." : "The saved draft could not be loaded.", hint: p.hint, reference: p.reference, code: p.code } })); return; }
        const j = (await r.json()) as { run: RunView; trace: TraceRow[]; reviews?: ReviewRow[] };
        if (j.run.status !== "running") { setRuns((s) => ({ ...s, [messageId]: { status: "ready", run: j.run, trace: j.trace, reviews: j.reviews ?? [] } })); return; }
        const last = j.trace[j.trace.length - 1];
        setRuns((s) => ({ ...s, [messageId]: { status: "loading", live: true, label: last ? `Working… ${j.trace.length} steps done, latest: ${last.stage.replace(/_/g, " ")}` : "Working…", steps: j.trace.map((t) => t.stage) } }));
        if (Date.now() - started > 100_000) throw new Error(); // the server marks a run stale after 90 s, so the next read reports it as failed
        await new Promise((res) => setTimeout(res, 700));
      }
    } catch { setRuns((s) => ({ ...s, [messageId]: { status: "error", message: "The saved draft could not be loaded." } })); }
  }, []);

  const select = useCallback((row: InboxRow, push = true) => {
    setSel(row.message_id); markSeen(row.message_id);
    // A link to /?m=<message id> opens exactly this message.
    if (push) { try { window.history.pushState(null, "", `/?m=${row.message_id}`); } catch { /* ignore */ } }
    setRuns((s) => { if (!s[row.message_id] && row.run) void loadRun(row.message_id, row.run.id); return s; });
  }, [loadRun]);
  const back = () => { setSel(null); try { window.history.pushState(null, "", "/"); } catch { /* ignore */ } };

  // Open the message named in the URL once the inbox is loaded, and follow Back/Forward.
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
      setRuns((s) => { const c = s[row.message_id]; return c?.status === "ready" && c.run.id === runId ? { ...s, [row.message_id]: { ...c, reviews: [...c.reviews, j.review as ReviewRow] } } : s; });
      return { ok: true };
    } catch { return { ok: false, reason: "The decision could not be recorded. Check your connection and try again." }; }
  };

  const generate = async (row: InboxRow) => {
    const prev = runs[row.message_id];
    if (prev?.status === "ready") void review(row, prev.run.id, { action: "regenerated" }); // best effort: history only
    setRuns((s) => ({ ...s, [row.message_id]: { status: "loading", live: true, label: "Reading the lease and ledger, drafting and checking…" } }));
    try {
      const r = await fetch("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message_id: row.message_id, idempotency_key: crypto.randomUUID() }) });
      const j = await r.json();
      if (r.status === 429) { setRuns((s) => ({ ...s, [row.message_id]: { status: "error", message: j.error ?? "This demo's limit is reached. Try again later." } })); return; }
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
  const current = rows.find((m) => m.message_id === sel) ?? null;

  // Keyboard: / search, j/k move, ? shortcuts, e edit, a approve. Ignored while typing and while a dialog is open.
  const list = useRef<InboxHandle>(null);
  const [help, setHelp] = useState(false);
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
    <main id="main" tabIndex={-1} className="flex h-full min-h-0 outline-none">
      <section aria-label="Inbox" className={`flex min-h-0 w-full shrink-0 flex-col border-border md:w-[300px] md:border-r lg:w-[320px] min-[1360px]:w-[380px] ${current ? "max-md:hidden" : ""}`}>
        <div className="flex min-h-11 items-center justify-between border-b border-border px-3">
          <h1 className="text-base">Tenant Message Copilot</h1>
          <button type="button" onClick={() => setHelp(true)} aria-label="Keyboard shortcuts" aria-haspopup="dialog" className="t grid size-11 place-items-center rounded-md text-muted hover:bg-bg-subtle hover:text-text md:size-8"><Kbd>?</Kbd></button>
        </div>
        {!online && <p role="alert" className="border-b border-border border-l-2 border-l-review-line px-3 py-2 text-sm text-text">You are offline. Messages on screen stay readable; generating a draft needs a connection.</p>}
        {loadErr && <ProblemPanel problem={loadErr} dev={isDev()} onRetry={refresh} />}
        {!loadErr && inbox?.setup && <SetupPanel missing={inbox.setup.baselines_missing} dev={inbox.setup.dev} />}
        {!loadErr && <InboxList ref={list} rows={rows} loaded={!!inbox} sel={sel} seen={seen} onSelect={select} />}
        {inbox && <Composer residents={inbox.residents} onCreated={async (id) => { await refresh(); setSel(id); }} />}
      </section>

      <section aria-label="Message detail" className={`min-h-0 min-w-0 flex-1 overflow-y-auto ${current ? "" : "max-md:hidden"}`}>
        {current ? (
          <Workspace key={current.message_id} row={current} thread={rows.filter((m) => m.resident_id === current.resident_id && m.message_id !== current.message_id)} state={runs[current.message_id] ?? { status: "idle" }} onGenerate={() => generate(current)} onBack={back} onReview={(runId, a) => review(current, runId, a)} />
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
