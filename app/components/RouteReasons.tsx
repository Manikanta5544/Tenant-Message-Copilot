import { FLAG_LABEL } from "../lib/format";
import { FLAG_TEXT, reasonText } from "@/core/reasons";
import type { RunView } from "../lib/types";
import { Card } from "./ui/Card";
import { Chip, StatusPill } from "./ui/Chip";

const URGENT_FLAGS = ["urgent", "critical_incident", "suspected_injection", "verification_failed"];

export default function RouteReasons({ run }: { run: RunView }) {
  return (
    <section aria-label="Route">
      <h3 className="mb-2 text-lg">Why this route</h3>
      <Card className="p-4 text-base">
        <div className="flex flex-wrap items-center gap-2"><StatusPill route={run.route} /><span className="text-muted">The most cautious of every signal wins; a model can only make a run safer.</span></div>
        {run.route_reasons.length > 0 && <ul className="mt-3 list-disc space-y-0.5 pl-5">{run.route_reasons.map((r, i) => <li key={i}>{reasonText(r, { intent: run.intent })}</li>)}</ul>}
        {run.flags.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5"><span className="mr-1 text-sm text-muted">Review flags</span>
            {run.flags.map((f) => <span key={f} title={FLAG_TEXT[f]}><Chip tone={URGENT_FLAGS.includes(f) ? "escalate" : "review"}>{FLAG_LABEL[f] ?? f}</Chip></span>)}
          </div>
        )}
      </Card>
    </section>
  );
}
