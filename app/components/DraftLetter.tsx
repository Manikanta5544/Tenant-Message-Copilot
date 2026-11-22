"use client";
import { useId, useState } from "react";
import type { Fact } from "@/core/types";
import { fmtDate, factSource } from "../lib/present";
import { plainText } from "../lib/format";
import type { ReviewRow, RunView, Seg } from "../lib/types";
import { fmtTime } from "./ReviewHistory";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Icon } from "./ui/Icon";
import { cx } from "./ui/cx";

type ReviewFn = (a: { action: "approved" | "edited"; edited_text?: string }) => Promise<{ ok: true } | { ok: false; reason: string }>;

/** The draft as a paper-like letter. Ledger values and exact clause quotes are visibly different from the model's own words,
 *  and each opens its evidence. Approve and Edit are recorded server-side (append-only); nothing is ever sent to a tenant. */
export default function DraftLetter({ run, segs, facts, reviews, onOpen, onGenerate, onReview }: { run: RunView; segs: Seg[]; facts: Fact[]; reviews: ReviewRow[]; onOpen: (id: string) => void; onGenerate: () => void; onReview: ReviewFn }) {
  const [editing, setEditing] = useState<{ text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uid = useId();
  const factOf = (id?: string) => facts.find((f) => f.id === id);
  const decided = [...reviews].reverse().find((r) => r.run_id === run.id && r.action !== "regenerated") ?? null;
  const e = editing; // textarea state; the saved edit, if any, comes from the recorded review
  const submit = async (a: { action: "approved" | "edited"; edited_text?: string }) => {
    setBusy(true); setError(null);
    const r = await onReview(a);
    setBusy(false);
    if (r.ok) setEditing(null); else setError(r.reason);
  };

  return (
    <Card as="section" aria-label="Draft reply" raised className="p-5 sm:p-7">
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <span className="font-semibold text-text">Draft reply</span>
        <span className="flex flex-wrap items-center gap-2">Key: plain words<span className="seg-fact" style={{ fontSize: "0.8125rem" }}>value from the ledger</span><span className="rounded border border-border border-l-4 border-l-accent bg-bg-subtle px-1.5 italic">exact lease clause</span></span>
      </div>

      {e ? (
        <div>
          <label htmlFor={`${uid}-edit`} className="sr-only">Edit draft</label>
          <textarea id={`${uid}-edit`} value={e.text} onChange={(ev) => setEditing({ text: ev.target.value })} rows={10} maxLength={2000} aria-invalid={!!error} aria-describedby={error ? `${uid}-err` : undefined} className="w-full rounded-lg border border-border-strong bg-surface p-3 font-serif text-lg leading-relaxed" />
          <p className="mt-1 text-sm text-muted">Your own wording is checked like a draft: no new amounts, dates or promises. Keep values exactly as the draft shows them.</p>
          {error && <p id={`${uid}-err`} role="alert" className="mt-2 flex gap-2 rounded-lg border border-escalate-line bg-escalate-bg px-3 py-2 text-base text-escalate"><Icon name="alert" size={16} className="mt-1 shrink-0" />{error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy || !e.text.trim()} onClick={() => submit({ action: "edited", edited_text: e.text })}>{busy ? "Checking…" : "Approve edited reply"}</Button>
            <Button disabled={busy} onClick={() => { setEditing(null); setError(null); }}>Discard edit</Button>
          </div>
        </div>
      ) : decided?.edited_text ? (
        <p className="letter whitespace-pre-wrap">{decided.edited_text}</p>
      ) : (
        <div className="letter">
          {segs.map((s, i) => {
            if (s.type === "text") return <span key={i} className="seg-text">{s.text}</span>;
            const f = factOf(s.refId);
            if (s.type === "quote") {
              const c = f?.kind === "clause" ? f.clause : null;
              return (
                <button key={i} type="button" onClick={() => onOpen(s.refId!)} className="seg-quote t" title="Open the lease clause in Evidence used">
                  <span>{s.text}</span>
                  <span className="meta">{c ? <><span className="badge">Clause {c.number}</span><span>Version {c.version} · effective {fmtDate(c.effective_from)}</span></> : <span>{s.cite}</span>}</span>
                </button>
              );
            }
            const st = f?.kind === "payment" ? f.state : "";
            const src = factSource(f); const tipId = `${uid}-tip-${i}`;
            return (
              <span key={i} className="group relative inline">
                <button type="button" onClick={() => onOpen(s.refId!)} aria-describedby={tipId} className={cx("seg-fact t", st)}>{s.text}</button>
                <span id={tipId} role="tooltip" className="pop pointer-events-none absolute left-0 top-full z-20 mt-1 hidden w-64 rounded-lg border border-border bg-raised p-3 text-left font-sans text-sm leading-snug text-text shadow-e2 group-focus-within:block group-hover:block">
                  <span className="block font-semibold">{src.title}</span>
                  {src.lines.map((l, k) => <span key={k} className="block text-muted">{l}</span>)}
                  <span className="mt-1 block text-xs text-faint">Click to open the evidence</span>
                </span>
              </span>
            );
          })}
        </div>
      )}

      {!e && (
        <div className="mt-6 space-y-3 border-t border-border pt-4">
          {error && <p role="alert" className="flex gap-2 rounded-lg border border-escalate-line bg-escalate-bg px-3 py-2 text-base text-escalate"><Icon name="alert" size={16} className="mt-1 shrink-0" />{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {decided ? (
              <p role="status" className="flex items-center gap-2 rounded-lg border border-ready-line bg-ready-bg px-3 py-2 text-base font-medium text-ready"><Icon name="check" size={16} />{decided.action === "edited" ? "Approved with your edits" : "Approved"} by you at {fmtTime(decided.created_at)} (recorded). Nothing was sent to the tenant.</p>
            ) : (
              <>
                <Button variant="primary" disabled={busy} onClick={() => submit({ action: "approved" })} title="Records your approval in the review log. Nothing is sent to the tenant.">{busy ? "Recording…" : "Approve draft"}</Button>
                <Button disabled={busy} onClick={() => { setError(null); setEditing({ text: plainText(segs) }); }}><Icon name="pencil" size={15} />Edit draft</Button>
              </>
            )}
            <Button variant="ghost" className="sm:ml-auto" onClick={onGenerate} title="Run the pipeline again for this message"><Icon name="refresh" size={15} />Generate again</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
