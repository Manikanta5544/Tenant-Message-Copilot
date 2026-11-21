"use client";
import { useCallback, useEffect, useState } from "react";
import type { InboxRow, RunView, TraceRow } from "../lib/types";
import type { RunState } from "../lib/run-state";
import Composer, { type Resident } from "./Composer";
import InboxList from "./InboxList";
import Workspace from "./Workspace";
import { Button } from "./ui/Button";
import { EmptyState } from "./ui/EmptyState";

type Inbox = { messages: InboxRow[]; residents: Resident[] };

/** Owns the data: inbox, per-message run state, polling, idempotency keys and the 429/stale handling. Presentation lives in the components it renders. */
export default function Workbench() {
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, RunState>>({});

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
        const j = (await r.json()) as { run: RunView; trace: TraceRow[] };
        if (j.run.status !== "running") { setRuns((s) => ({ ...s, [messageId]: { status: "ready", run: j.run, trace: j.trace } })); return; }
        const last = j.trace[j.trace.length - 1];
        setRuns((s) => ({ ...s, [messageId]: { status: "loading", label: last ? `Working… ${j.trace.length} steps done, latest: ${last.stage.replace(/_/g, " ")}` : "Working…", steps: j.trace.map((t) => t.stage) } }));
        if (Date.now() - started > 100_000) throw new Error(); // the server marks a run stale after 90 s, so the next read reports it as failed
        await new Promise((res) => setTimeout(res, 700));
      }
    } catch { setRuns((s) => ({ ...s, [messageId]: { status: "error", message: "The saved draft could not be loaded." } })); }
  }, []);

  const select = (row: InboxRow) => {
    setSel(row.message_id);
    if (!runs[row.message_id] && row.run) void loadRun(row.message_id, row.run.id);
  };

  const generate = async (row: InboxRow) => {
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
      <aside aria-label="Inbox" className={`min-w-0 space-y-4 lg:sticky lg:top-[72px] lg:max-h-[calc(100dvh-88px)] lg:self-start lg:overflow-y-auto lg:pr-1 ${current ? "hidden lg:block" : ""}`}>
        {loadErr && <EmptyState alert tone="error" icon="alert" title="The inbox could not be loaded" action={<Button onClick={refresh}>Retry</Button>}>{loadErr}</EmptyState>}
        {!loadErr && <InboxList rows={rows} loaded={!!inbox} sel={sel} onSelect={select} />}
        {inbox && <Composer residents={inbox.residents} onCreated={async (id) => { await refresh(); setSel(id); }} />}
      </aside>

      <section aria-label="Message detail" className={`min-w-0 ${current ? "" : "hidden lg:block"}`}>
        {current ? (
          <Workspace key={current.message_id} row={current} state={runs[current.message_id] ?? { status: "idle" }} onGenerate={() => generate(current)} onBack={() => setSel(null)} />
        ) : (
          <EmptyState icon="inbox" title="Choose a message">Start with a demo scenario. Each reply is a draft for a property manager: nothing is ever sent to a tenant. All residents, leases and payments are synthetic.</EmptyState>
        )}
      </section>
    </main>
  );
}
