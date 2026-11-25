import type { DiffOp } from "../lib/diff";

/** Inline word diff: added text underlined, removed text struck through, both announced to screen readers. */
export default function DiffText({ ops, label }: { ops: DiffOp[]; label: string }) {
  return (
    <p className="letter whitespace-pre-wrap rounded-md border border-border bg-bg-subtle p-3 text-base" aria-label={label}>
      {ops.map((o, i) => o.type === "same" ? <span key={i}>{o.text}</span>
        : o.type === "ins" ? <ins key={i} className="rounded-sm bg-accent-soft text-text underline decoration-accent decoration-2 underline-offset-2"><span className="sr-only">[added: </span>{o.text}<span className="sr-only">]</span></ins>
        : <del key={i} className="text-muted decoration-escalate decoration-2"><span className="sr-only">[removed: </span>{o.text}<span className="sr-only">]</span></del>)}
    </p>
  );
}
