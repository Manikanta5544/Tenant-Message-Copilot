"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { plainText } from "../lib/format";
import { changeSentence, diffWords } from "../lib/diff";
import DiffText from "./DiffText";
import { linkState } from "../lib/evidence";
import type { Fact } from "@/core/types";
import type { InboxRow, LayerView, ReviewRow, RunView, Seg, TraceRow } from "../lib/types";
import type { RunState } from "../lib/run-state";
import { INTENT_LABEL } from "../lib/format";
import { footnotes } from "../lib/evidence";
import DraftLetter from "./DraftLetter";
import EvidenceRail from "./EvidenceRail";
import MessageBlock from "./MessageBlock";
import OriginalPanel from "./OriginalPanel";
import ReviewHistory from "./ReviewHistory";
import RunStatus from "./RunStatus";
import StatusStrip, { EscalationStatement, Notices } from "./StatusStrip";
import dynamic from "next/dynamic";
const TraceTable = dynamic(() => import("./TraceTable"), { loading: () => <p className="mt-4 text-muted" role="status">Loading trace…</p> });
import VerificationList from "./VerificationList";
import { Button } from "./ui/Button";
import { Sheet } from "./ui/Sheet";
import { Tabs } from "./ui/Tabs";

type Tab = "draft" | "verification" | "trace";
type ReviewFn = (runId: string, a: { action: "approved" | "edited"; edited_text?: string }) => Promise<{ ok: true } | { ok: false; reason: string }>;

const MODE_WORD: Record<string, string> = { live: "Live model", replay: "Replayed model responses", mock: "Mock run, not a real model", fallback: "Standard reply", template: "Standard reply" };
const DOCKED = "(min-width: 1360px)";

/** Detail pane. Data fetching lives in Workbench; this presents a RunState: the message, the status strip, then the draft beside its proof. */
export default function Workspace({ row, thread = [], state, previousText, onGenerate, onBack, onReview }: { row: InboxRow; previousText?: string; thread?: InboxRow[]; state: RunState; onGenerate: () => void; onBack: () => void; onReview: ReviewFn }) {
  return (
    <div className="px-4 pb-10 pt-4 md:px-6">
      <MessageBlock row={row} onBack={onBack} />
      <div className="mt-3">
        {state.status !== "ready" ? <RunStatus state={state} onGenerate={onGenerate} /> : (
          <Ready key={state.run.id} previousText={previousText} row={row} thread={thread} run={state.run} trace={state.trace} reviews={state.reviews} onGenerate={onGenerate} onReview={(a) => onReview(state.run.id, a)} />
        )}
      </div>
    </div>
  );
}

function Ready({ row, thread, run, trace, reviews, previousText, onGenerate, onReview }: { previousText?: string; row: InboxRow; thread: InboxRow[]; run: RunView; trace: TraceRow[]; reviews: ReviewRow[]; onGenerate: () => void; onReview: (a: { action: "approved" | "edited"; edited_text?: string }) => ReturnType<ReviewFn> }) {
  const [tab, setTab] = useState<Tab>("draft");
  const [compare, setCompare] = useState(false);
  const facts = useMemo(() => (run.facts ?? []) as Fact[], [run]);
  const segs = useMemo(() => (run.segments ?? []) as Seg[], [run]);
  const { list, num } = useMemo(() => footnotes(segs, facts), [segs, facts]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(list.map((f) => f.id)));
  const [hot, setHot] = useState<string | null>(null);
  const [lineHot, setLineHot] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ id: string; n: number } | null>(null);
  const [sheet, setSheet] = useState(false);
  const toggle = useCallback((id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  const show = useCallback((id: string) => {
    setOpen((s) => new Set(s).add(id)); setFlash((f) => ({ id, n: (f?.n ?? 0) + 1 }));
    if (!window.matchMedia(DOCKED).matches) setSheet(true);
  }, []);
  // The status strip's summary opens the Verification tab and moves focus to the first flagged layer (or the first row when all passed).
  const [focusVerification, setFocusVerification] = useState(0);
  const openVerification = useCallback(() => { setTab("verification"); setFocusVerification((n) => n + 1); }, []);
  useEffect(() => {
    if (!focusVerification) return;
    const t = setTimeout(() => (document.querySelector<HTMLElement>('[data-flagged="true"] summary') ?? document.querySelector<HTMLElement>('ol[aria-label="Verification layers"] summary'))?.focus(), 30);
    return () => clearTimeout(t);
  }, [focusVerification]);
  const escalate = run.route === "escalate_only";
  const meta = [run.language, INTENT_LABEL[run.intent ?? ""], run.urgency ? run.urgency[0]!.toUpperCase() + run.urgency.slice(1) : null, MODE_WORD[run.mode] ?? run.mode].filter(Boolean);
  const link = useMemo(() => linkState(facts, hot, lineHot), [facts, hot, lineHot]);
  const railProps = { facts: list, num, open, onToggle: toggle, link, onHot: setHot, onLine: setLineHot, flash };
  const hasRail = !escalate && tab === "draft";
  // When the first draft was rejected by a check and the second was used, say so quietly and link to the trace row that shows why.
  const secondAttempt = (() => {
    const d = trace.filter((t) => t.stage === "draft");
    const first = d.find((t) => Number((t.payload as { attempt?: number } | null)?.attempt) === 1), second = d.find((t) => Number((t.payload as { attempt?: number } | null)?.attempt) === 2);
    return first && second && first.outcome.startsWith("rejected:") ? { seq: first.seq, reason: first.outcome.slice(9) } : null;
  })();

  return (
    <div className="detail-grid">
      <div className="detail-main">
        <StatusStrip run={run} onVerification={openVerification} />
        <p className="mt-2 text-sm text-muted" data-testid="meta-line">{meta.join(" · ")}</p>
        <Notices run={run} onGenerate={onGenerate} />
        <div className="mt-4">
          <Tabs idPrefix="ws" label="Workspace view" value={tab} onChange={setTab} tabs={[{ id: "draft", label: "Draft" }, { id: "verification", label: "Verification" }, { id: "trace", label: "Trace", count: trace.length }]} />
        </div>
        <div role="tabpanel" id={`ws-panel-${tab}`} aria-labelledby={`ws-tab-${tab}`}>
          {tab === "draft" && (
            <>
              {escalate ? <EscalationStatement run={run} /> : (
                <>
                  {secondAttempt && (
                    <p className="mt-3 text-sm text-muted" data-testid="second-attempt">
                      <button type="button" className="t underline decoration-border-strong underline-offset-2 hover:text-text" onClick={() => { setTab("trace"); setTimeout(() => { const el = document.getElementById(`trace-${secondAttempt.seq}`); el?.scrollIntoView({ block: "center" }); }, 50); }}>
                        Second attempt (first rejected: {secondAttempt.reason})
                      </button>
                    </p>
                  )}
                  {previousText !== undefined && (
                    <div className="mt-3 max-w-[62ch]">
                      <Button variant="link" onClick={() => setCompare((v) => !v)} aria-expanded={compare}>{compare ? "Hide comparison" : "Compare with previous"}</Button>
                      {compare && <div className="mt-2"><p className="mb-1 text-sm text-muted">Previous draft against this one: {changeSentence(previousText, plainText(segs))}.</p><DiffText ops={diffWords(previousText, plainText(segs))} label="Previous draft compared with this draft" /></div>}
                    </div>
                  )}
                  {hasRail && <div className="evidence-button mt-3"><Button small onClick={() => setSheet(true)} aria-haspopup="dialog">Evidence <span className="tnum text-muted">({list.length})</span></Button></div>}
                  <div className="draft-grid">
                    <DraftLetter run={run} segs={segs} facts={facts} num={num} reviews={reviews} hot={link.ids} onHot={setHot} onOpen={show} onGenerate={onGenerate} onReview={onReview} />
                    <div className="mt-5"><OriginalPanel row={row} thread={thread} /></div>
                  </div>
                </>
              )}
              <ReviewHistory reviews={reviews} currentRunId={run.id} originalText={plainText(segs)} />
              {escalate && <div className="mt-6"><Button variant="link" onClick={onGenerate}>Generate again</Button></div>}
            </>
          )}
          {tab === "verification" && <section aria-label="Verification" className="mt-4"><p className="mb-3 max-w-prose text-base text-muted">Six checks run on every draft. The semantic check can only lower trust, never raise it.</p><VerificationList layers={run.verification as LayerView[]} /></section>}
          {tab === "trace" && <div className="mt-4"><TraceTable runId={run.id} events={trace} mode={run.mode} /></div>}
        </div>
      </div>
      {hasRail && (
        <aside aria-label="Evidence" className="evidence-dock">
          <h2 className="label-caps mb-1.5">Evidence <span className="tnum font-normal">{list.length}</span></h2>
          <EvidenceRail {...railProps} />
        </aside>
      )}
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Evidence" className="md:max-w-xl"><EvidenceRail {...railProps} /></Sheet>
    </div>
  );
}
