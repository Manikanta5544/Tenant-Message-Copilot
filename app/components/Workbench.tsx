"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { InboxRow, ReviewRow, RunView, TraceRow } from "../lib/types";
import type { RunState } from "../lib/run-state";
import Composer, { type Resident } from "./Composer";
import InboxList from "./InboxList";
import Workspace from "./Workspace";
import { Button } from "./ui/Button";
import { EmptyState } from "./ui/EmptyState";
import { Icon } from "./ui/Icon";

type Inbox = { messages: InboxRow[]; residents: Resident[] };

/** Owns the data: inbox, per-message run state, polling, idempotency keys and the 429/stale handling. Presentation lives in the components it renders. */
export default function Workbench() {
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
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
      if (!r.ok) throw new Error();
      setInbox(await r.json()); setLoadErr(null);
    } catch { setLoadErr("The inbox could not be loaded. Check that the database is reachable, then try again."); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  // The server answers POST /api/runs at once and finishes the pipeline afterwards, so the trace fills in while we poll.
  const loadRun = useCallback(async (messageId: string, runId: string) => {
    setRuns((s) => ({ ...s, [messageId]: { status: "loading", label: "Loading the saved draft…" } }));
    const started = Date.now();
    try {
      for (;;) {
        const r = await fetch(`/api/runs/${runId}`);
        if (!r.ok) throw new Error();
        const j = (await r.json()) as { run: RunView; trace: TraceRow[]; reviews?: ReviewRow[] };
        if (j.run.status !== "running") { setRuns((s) => ({ ...s, [messageId]: { status: "ready", run: j.run, trace: j.trace, reviews: j.reviews ?? [] } })); return; }
        const last = j.trace[j.trace.length - 1];
        setRuns((s) => ({ ...s, [messageId]: { status: "loading", label: last ? `Working… ${j.trace.length} steps done, latest: ${last.stage.replace(/_/g, " ")}` : "Working…", steps: j.trace.map((t) => t.stage) } }));
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
    setRuns((s) => ({ ...s, [row.message_id]: { status: "loading", label: "Reading the lease and ledger, drafting and checking…" } }));
    try {
      const r = await fetch("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message_id: row.message_id, idempotency_key: crypto.randomUUID() }) });
      const j = await r.json();
      if (r.status === 429) { setRuns((s) => ({ ...s, [row.message_id]: { status: "error", message: j.error ?? "This demo's limit is reached. Try again later." } })); return; }
      if (!r.ok) throw new Error(j.error);
      await loadRun(row.message_id, j.run_id);
      void refresh();
    } catch { setRuns((s) => ({ ...s, [row.message_id]: { status: "error", message: "The draft could not be generated. Nothing was sent. Try again." } })); }
  };

  const rows = inbox?.messages ?? [];
  const current = rows.find((m) => m.message_id === sel) ?? null;

  return (
    <main id="main" tabIndex={-1} className="mx-auto grid max-w-[1280px] gap-6 px-4 py-4 outline-none lg:grid-cols-[minmax(340px,400px)_minmax(0,1fr)]">
      {!online && <p role="alert" className="flex items-center gap-2 rounded-lg border border-review-line bg-review-bg px-3 py-2 text-base text-review lg:col-span-2"><Icon name="alert" size={16} />You are offline. Messages already on screen stay readable; generating a draft needs a connection.</p>}
      <aside aria-label="Inbox" className={`min-w-0 space-y-4 lg:sticky lg:top-[72px] lg:max-h-[calc(100dvh-88px)] lg:self-start lg:overflow-y-auto lg:pr-1 ${current ? "hidden lg:block" : ""}`}>
        {loadErr && <EmptyState alert tone="error" icon="alert" title="The inbox could not be loaded" action={<Button onClick={refresh}>Retry</Button>}>{loadErr}</EmptyState>}
        {!loadErr && <InboxList rows={rows} loaded={!!inbox} sel={sel} seen={seen} onSelect={select} />}
        {inbox && <Composer residents={inbox.residents} onCreated={async (id) => { await refresh(); setSel(id); }} />}
      </aside>

      <section aria-label="Message detail" className={`min-w-0 ${current ? "" : "hidden lg:block"}`}>
        {current ? (
          <Workspace key={current.message_id} row={current} state={runs[current.message_id] ?? { status: "idle" }} onGenerate={() => generate(current)} onBack={back} onReview={(runId, a) => review(current, runId, a)} />
        ) : (
          <EmptyState icon="inbox" title="Choose a message">Start with a demo scenario. Each reply is a draft for a property manager: nothing is ever sent to a tenant. All residents, leases and payments are synthetic.</EmptyState>
        )}
      </section>
    </main>
  );
}
