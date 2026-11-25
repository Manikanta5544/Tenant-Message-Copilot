"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { summarize, type BatchState, type ItemResult } from "../lib/batch";
import { usd } from "../lib/format";
import { watchRun, type RunPayload } from "../lib/run-stream";
import type { InboxRow } from "../lib/types";
import { Button } from "./ui/Button";

/** Starts one run for a message and waits for it, reusing the live stream. Maps the server's answers onto what the batch needs. */
async function processOne(messageId: string): Promise<ItemResult> {
  const r = await fetch("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message_id: messageId, idempotency_key: crypto.randomUUID() }) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 429) return j.code === "budget_exhausted" ? { kind: "budget" } : { kind: "rate_limited", retry_after_s: Number(r.headers.get("retry-after") ?? j.retry_after_s ?? 30) };
  if (!r.ok) return { kind: "failed" };
  const p = await new Promise<RunPayload | null>((res) => { watchRun(j.run_id as string, { onTrace: () => {}, onDone: res, onError: () => res(null) }); });
  if (!p) return { kind: "failed" };
  return { kind: "done", cost_micro_usd: p.trace.reduce((a, t) => a + t.cost_micro_usd, 0), route: p.run.route };
}

export default function BatchBar({ rows, onProgress, onFinished }: { rows: InboxRow[]; onProgress: (s: BatchState) => void; onFinished: () => void }) {
  const todo = rows.filter((m) => !m.run?.route);
  const [state, setState] = useState<BatchState | null>(null);
  const ac = useRef<AbortController | null>(null);
  const running = !!state && !["finished", "cancelled", "budget"].includes(state.status);
  const [tick, setTick] = useState(0);
  useEffect(() => { if (state?.status !== "paused") return; const t = setInterval(() => setTick((n) => n + 1), 500); return () => clearInterval(t); }, [state?.status]);
  const todoRef = useRef(todo); todoRef.current = todo;

  const start = useCallback(async () => {
    if (ac.current) return;
    const ids = todoRef.current.map((m) => m.message_id);
    if (!ids.length) return;
    ac.current = new AbortController();
    const { runBatch } = await import("../lib/batch");
    const end = await runBatch(ids, { runOne: processOne, signal: ac.current.signal, onUpdate: (s) => { setState(s); onProgress(s); } });
    ac.current = null; setState(end); onFinished();
  }, [onProgress, onFinished]);
  useEffect(() => { const h = () => void start(); window.addEventListener("tmc:process-all", h); return () => window.removeEventListener("tmc:process-all", h); }, [start]);

  if (!state && todo.length === 0) return null;
  const finished = state && !running;
  const wait = state?.resume_at ? Math.max(0, Math.ceil((state.resume_at - Date.now()) / 1000)) : 0; void tick;
  return (
    <div className="border-t border-border px-3 py-2 text-sm" data-testid="batch-bar">
      {!state && <div className="flex items-center justify-between gap-2"><span className="min-w-0 text-muted">{todo.length} not processed</span><Button small onClick={start}>Process all unprocessed</Button></div>}
      {running && state && (
        <div role="status" className="space-y-1">
          <div className="flex items-center justify-between gap-2"><span className="min-w-0">{state.status === "paused" ? `Paused by the rate limit. Resumes in ${wait} s.` : state.status === "cancelling" ? "Cancelling…" : `Processing ${state.done + state.failed} of ${state.total}`}</span><Button small variant="secondary" onClick={() => ac.current?.abort()}>Cancel</Button></div>
          <div className="h-1 bg-bg-subtle" aria-hidden><div className="h-1 bg-accent" style={{ width: `${Math.round(((state.done + state.failed) / Math.max(1, state.total)) * 100)}%` }} /></div>
        </div>
      )}
      {finished && state && <div role="status" className="flex items-start justify-between gap-2"><span className="min-w-0 text-muted" data-testid="batch-summary">{summarize(state, usd)}</span><Button small variant="secondary" onClick={() => setState(null)}>Dismiss</Button></div>}
    </div>
  );
}
