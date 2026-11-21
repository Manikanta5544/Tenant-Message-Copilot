"use client";
import { useMemo, useState } from "react";
import type { Fact } from "@/core/types";
import type { InboxRow, LayerView, Seg } from "../lib/types";
import type { RunState } from "../lib/run-state";
import DecisionCard from "./DecisionCard";
import DraftLetter from "./DraftLetter";
import EvidencePanel from "./EvidencePanel";
import MessageHeader from "./MessageHeader";
import RouteReasons from "./RouteReasons";
import RunStatus from "./RunStatus";
import TraceTable from "./TraceTable";
import VerificationStepper from "./VerificationStepper";
import { Tabs } from "./ui/Tabs";

type Tab = "draft" | "verification" | "trace";

/** Detail pane: sticky message header, decision card, then tabs. Data fetching lives in Workbench; this only presents a RunState. */
export default function Workspace({ row, state, onGenerate, onBack }: { row: InboxRow; state: RunState; onGenerate: () => void; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>("draft");
  const [open, setOpen] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ id: string; n: number } | null>(null);
  const run = state.status === "ready" ? state.run : null;
  const facts = useMemo(() => (run?.facts ?? []) as Fact[], [run]);
  const segs = useMemo(() => (run?.segments ?? []) as Seg[], [run]);
  const referenced = useMemo(() => [...new Set(segs.filter((s) => s.refId).map((s) => s.refId!))].map((id) => facts.find((f) => f.id === id)).filter(Boolean) as Fact[], [segs, facts]);

  // A chip or quote in the letter opens its evidence card and scrolls to it.
  const openEvidence = (id: string) => { setOpen(id); setFlash((f) => ({ id, n: (f?.n ?? 0) + 1 })); };

  return (
    <div className="space-y-4">
      <MessageHeader row={row} onBack={onBack} />
      {state.status !== "ready" ? <RunStatus state={state} onGenerate={onGenerate} /> : (
        <>
          <DecisionCard run={state.run} onGenerate={onGenerate} />
          <Tabs idPrefix="ws" label="Workspace view" value={tab} onChange={setTab} tabs={[{ id: "draft", label: "Draft" }, { id: "verification", label: "Verification" }, { id: "trace", label: "Trace", count: state.trace.length }]} />
          <div role="tabpanel" id={`ws-panel-${tab}`} aria-labelledby={`ws-tab-${tab}`} className="space-y-5">
            {tab === "draft" && (
              <>
                <DraftLetter key={state.run.id} run={state.run} segs={segs} facts={facts} onOpen={openEvidence} onGenerate={onGenerate} />
                <EvidencePanel facts={referenced} open={open} onToggle={setOpen} flash={flash} />
                <RouteReasons run={state.run} />
              </>
            )}
            {tab === "verification" && (
              <section aria-label="Verification">
                <h3 className="mb-3 text-lg">Verification</h3>
                <p className="mb-4 max-w-prose text-base text-muted">Six checks run on every draft. The semantic check can only lower trust, never raise it.</p>
                <VerificationStepper layers={state.run.verification as LayerView[]} />
              </section>
            )}
            {tab === "trace" && <TraceTable runId={state.run.id} events={state.trace} mode={state.run.mode} />}
          </div>
        </>
      )}
    </div>
  );
}
