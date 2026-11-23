"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Fact } from "@/core/types";
import { checkEditedText } from "@/core/review";
import { fmtDate } from "../lib/present";
import { plainText } from "../lib/format";
import { changeSentence, diffWords } from "../lib/diff";
import type { ReviewRow, RunView, Seg } from "../lib/types";
import { fmtTime } from "./ReviewHistory";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { cx } from "./ui/cx";

type ReviewFn = (a: { action: "approved" | "edited"; edited_text?: string }) => Promise<{ ok: true } | { ok: false; reason: string }>;

/** The draft: a serif letter on a 62ch measure. Values from the ledger and exact lease quotes are inline text with a footnote number
 *  that points at the evidence rail; they never wrap as blocks. Approve and Edit are recorded server-side (append-only);
 *  nothing is ever sent to a tenant. */
export default function DraftLetter({ run, segs, facts, num, reviews, hot, onHot, onOpen, onGenerate, onReview }: {
  run: RunView; segs: Seg[]; facts: Fact[]; num: Record<string, number>; reviews: ReviewRow[]; hot: Set<string>; onHot: (id: string | null) => void; onOpen: (id: string) => void; onGenerate: () => void; onReview: ReviewFn;
}) {
  const [editing, setEditing] = useState<{ text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uid = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const factOf = (id?: string) => facts.find((f) => f.id === id);
  const decided = [...reviews].reverse().find((r) => r.run_id === run.id && r.action !== "regenerated") ?? null;
  const start = () => { if (decided || editing) return; setError(null); setEditing({ text: plainText(segs) }); };
  const approve = async () => { if (decided || editing || busy) return; await submit({ action: "approved" }); };
  async function submit(a: { action: "approved" | "edited"; edited_text?: string }) {
    setBusy(true); setError(null);
    const r = await onReview(a);
    setBusy(false);
    if (r.ok) setEditing(null); else setError(r.reason);
  }
  // Keyboard shortcuts (a, e) arrive as window events from the Workbench so this component owns its own state.
  const handlers = useRef({ start, approve });
  handlers.current = { start, approve };
  useEffect(() => {
    const a = () => void handlers.current.approve(), e = () => handlers.current.start();
    window.addEventListener("tmc:approve", a); window.addEventListener("tmc:edit", e);
    return () => { window.removeEventListener("tmc:approve", a); window.removeEventListener("tmc:edit", e); };
  }, []);
  useEffect(() => { if (editing && area.current && document.activeElement !== area.current) area.current.focus(); }, [editing !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live guard feedback: the same function the server runs, so a rejection is explained before the request is made.
  const guard = useMemo(() => (editing ? checkEditedText(editing.text, segs) : null), [editing, segs]);

  const original = useMemo(() => plainText(segs), [segs]);
  const ops = useMemo(() => (editing ? diffWords(original, editing.text) : []), [editing, original]);

  return (
    <section aria-label="Draft reply" className="mt-5">
      {editing ? (
        <div className="max-w-[62ch]">
          <label htmlFor={`${uid}-edit`} className="sr-only">Edit draft</label>
          <textarea ref={area} id={`${uid}-edit`} value={editing.text} onChange={(ev) => { setEditing({ text: ev.target.value }); setError(null); }} rows={11} maxLength={2000}
            aria-invalid={guard ? !guard.ok : undefined} aria-describedby={`${uid}-guard`} className="w-full rounded-md border border-border-strong bg-surface p-3 font-serif text-[1.0313rem] leading-[1.7]" />
          <p id={`${uid}-guard`} role="status" aria-live="polite" className={cx("mt-1.5 flex gap-2 text-base", guard && !guard.ok ? "text-escalate" : "text-muted")}>
            {guard && !guard.ok
              ? <><Icon name="x" size={14} className="mt-1" /><span><b>Not allowed.</b> {guard.reason}</span></>
              : <><Icon name="check" size={14} className="mt-1" /><span>Clears the guard: no new amounts, dates or promises. The server checks it again on approval.</span></>}
          </p>
          <div className="mt-3" data-testid="edit-diff">
            <h3 className="text-sm font-medium">Your edit against the model's text <span className="font-normal text-muted">({changeSentence(original, editing.text)})</span></h3>
            <p className="letter mt-1 whitespace-pre-wrap rounded-md border border-border bg-bg-subtle p-3 text-base" aria-label="Inline comparison">
              {ops.map((o, i) => o.type === "same" ? <span key={i}>{o.text}</span>
                : o.type === "ins" ? <ins key={i} className="rounded-sm bg-accent-soft text-text underline decoration-accent decoration-2 underline-offset-2"><span className="sr-only">[added: </span>{o.text}<span className="sr-only">]</span></ins>
                : <del key={i} className="text-muted decoration-escalate decoration-2"><span className="sr-only">[removed: </span>{o.text}<span className="sr-only">]</span></del>)}
            </p>
            <p className="mt-1 text-sm text-muted">Added text is underlined, removed text is struck through. Both versions are kept in the review log.</p>
          </div>
          {error && <p role="alert" className="mt-2 border-l-2 border-escalate-line pl-3 text-base text-escalate">{error}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={busy || !guard?.ok} onClick={() => submit({ action: "edited", edited_text: editing.text })}>{busy ? "Checking…" : "Approve edited reply"}</Button>
            <Button variant="link" disabled={busy} onClick={() => { setEditing(null); setError(null); }}>Discard edit</Button>
          </div>
        </div>
      ) : (
        <>
          {decided?.edited_text ? <p className="letter whitespace-pre-wrap">{decided.edited_text}</p> : (
            <div className="letter">
              {segs.map((s, i) => {
                if (s.type === "text") return <span key={i} className="seg-text">{s.text}</span>;
                const f = factOf(s.refId); const n = s.refId ? num[s.refId] : undefined;
                const handle = { onMouseEnter: () => onHot(s.refId ?? null), onMouseLeave: () => onHot(null), onFocus: () => onHot(s.refId ?? null), onBlur: () => onHot(null), "data-hot": !!s.refId && hot.has(s.refId) } as const;
                const open = (e: React.MouseEvent) => { e.preventDefault(); onOpen(s.refId!); };
                if (s.type === "quote") {
                  const c = f?.kind === "clause" ? f.clause : null;
                  return (
                    <a key={i} href={`#ev-${s.refId}`} onClick={open} {...handle} className="quote t no-underline">
                      <span>{s.text}</span>
                      <span className="qmeta">{c ? `Clause ${c.number} · version ${c.version} · effective ${fmtDate(c.effective_from)}` : s.cite}<sup>[{n}]<span className="sr-only"> footnote</span></sup></span>
                    </a>
                  );
                }
                const st = f?.kind === "payment" && f.state !== "settled" ? f.state : "";
                return <a key={i} href={`#ev-${s.refId}`} onClick={open} {...handle} className={cx("ref t", st)}>{s.text}<sup>[{n}]<span className="sr-only"> evidence footnote</span></sup></a>;
              })}
            </div>
          )}

          <div className="mt-6 border-t border-border pt-3">
            {error && <p role="alert" className="mb-2 border-l-2 border-escalate-line pl-3 text-base text-escalate">{error}</p>}
            {decided ? (
              <p role="status" className="text-base"><b className="font-medium">{decided.action === "edited" ? "Approved with your edits" : "Approved"} by you, <time className="tnum" dateTime={decided.created_at}>{fmtTime(decided.created_at)}</time> · recorded.</b> <span className="text-muted">Nothing was sent to the tenant.</span></p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" disabled={busy} onClick={approve} aria-keyshortcuts="a" title="Records your approval in the review log. Nothing is sent to the tenant.">{busy ? "Recording…" : "Approve"}</Button>
                <Button disabled={busy} onClick={start} aria-keyshortcuts="e"><Icon name="pencil" size={13} />Edit</Button>
                <Button variant="link" className="ml-auto" onClick={onGenerate} title="Read the message again and write a new draft">Generate again</Button>
              </div>
            )}
            {decided && <div className="mt-2"><Button variant="link" onClick={onGenerate}>Generate again</Button></div>}
          </div>
        </>
      )}
    </section>
  );
}
