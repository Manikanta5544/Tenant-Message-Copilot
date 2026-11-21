"use client";
import { useId, useState } from "react";
import type { Fact } from "@/core/types";
import { fmtDate, factSource } from "../lib/present";
import { plainText } from "../lib/format";
import type { RunView, Seg } from "../lib/types";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Icon } from "./ui/Icon";
import { cx } from "./ui/cx";

type Edit = { runId: string; text: string; editing: boolean; approved: boolean };

/** The draft as a paper-like letter. Ledger values and exact clause quotes are visibly different from the model's own words,
 *  and each opens its evidence. Edit and Approve keep their per-session behaviour (nothing is ever sent). */
export default function DraftLetter({ run, segs, facts, onOpen, onGenerate }: { run: RunView; segs: Seg[]; facts: Fact[]; onOpen: (id: string) => void; onGenerate: () => void }) {
  const [edit, setEdit] = useState<Edit | null>(null);
  const uid = useId();
  const factOf = (id?: string) => facts.find((f) => f.id === id);
  const e = edit?.runId === run.id ? edit : null;

  return (
    <Card as="section" aria-label="Draft reply" raised className="p-5 sm:p-7">
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <span className="font-semibold text-text">Draft reply</span>
        <span className="flex flex-wrap items-center gap-2">Key: plain words<span className="seg-fact" style={{ fontSize: "0.8125rem" }}>value from the ledger</span><span className="rounded border border-border border-l-4 border-l-accent bg-bg-subtle px-1.5 italic">exact lease clause</span></span>
      </div>

      {e?.editing ? (
        <div>
          <label htmlFor={`${uid}-edit`} className="sr-only">Edit draft</label>
          <textarea id={`${uid}-edit`} value={e.text} onChange={(ev) => setEdit({ ...e, text: ev.target.value })} rows={10} className="w-full rounded-lg border border-border-strong bg-surface p-3 font-serif text-lg leading-relaxed" />
          <p className="mt-1 text-sm text-muted">Edited text is your own wording. Evidence chips describe the original draft.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => setEdit({ ...e, editing: false })}>Save edit</Button>
            <Button onClick={() => setEdit(null)}>Discard edit</Button>
          </div>
        </div>
      ) : e ? (
        <p className="letter whitespace-pre-wrap">{e.text}</p>
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

      {!e?.editing && (
        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          {e?.approved ? (
            <p role="status" className="flex items-center gap-2 rounded-lg border border-ready-line bg-ready-bg px-3 py-2 text-base font-medium text-ready"><Icon name="check" size={16} />Approved in this session. Nothing was sent to the tenant.</p>
          ) : (
            <>
              <Button variant="primary" onClick={() => setEdit({ runId: run.id, text: e?.text ?? plainText(segs), editing: false, approved: true })} title="Marks this draft as reviewed here. Nothing is sent.">Approve draft</Button>
              <Button onClick={() => setEdit(e ? { ...e, editing: true } : { runId: run.id, text: plainText(segs), editing: true, approved: false })}><Icon name="pencil" size={15} />Edit draft</Button>
            </>
          )}
          <Button variant="ghost" className="sm:ml-auto" onClick={onGenerate} title="Run the pipeline again for this message"><Icon name="refresh" size={15} />Generate again</Button>
        </div>
      )}
    </Card>
  );
}
