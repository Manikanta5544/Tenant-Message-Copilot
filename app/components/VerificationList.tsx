import { LAYER_LABEL } from "../lib/format";
import type { LayerView } from "../lib/types";
import { Icon } from "./ui/Icon";
import { cx } from "./ui/cx";

const HINT: Record<string, string> = {
  schema: "Output parses against the schema.", evidence: "Every id exists, belongs to this resident and applies today.", exactness: "Balance matches SQL; no digits or figures in model text.",
  policy: "Topic allowed; keyword floors applied.", semantic: "Prose follows from the cited facts (can only lower trust).", abstention: "A material claim can be established.",
};
type State = "pass" | "warn" | "fail" | "skipped";
const STYLE: Record<State, { icon: string; word: string; cls: string }> = {
  pass: { icon: "check", word: "Passed", cls: "text-ready" },
  warn: { icon: "alert", word: "Flagged", cls: "text-review" },
  fail: { icon: "x", word: "Failed", cls: "text-escalate" },
  skipped: { icon: "minus", word: "Not run", cls: "text-faint" },
};

/** Six rows, one per layer: a glyph, the layer, the outcome as a word. Each row expands to what it checks and any issues. */
export default function VerificationList({ layers }: { layers: LayerView[] }) {
  return (
    <ol aria-label="Verification layers" className="max-w-2xl divide-y divide-border border-y border-border">
      {layers.map((l) => {
        const state: State = l.skipped ? "skipped" : l.ok ? "pass" : l.critical ? "fail" : "warn";
        const st = STYLE[state];
        return (
          <li key={l.layer} data-flagged={!l.skipped && !l.ok ? "true" : undefined}>
            <details className="group" open={l.issues.length > 0}>
              <summary className="t flex min-h-11 cursor-pointer list-none items-center gap-3 px-1 hover:bg-bg-subtle md:min-h-9">
                <span className={cx("grid size-5 place-items-center", st.cls)}><Icon name={st.icon} size={15} /></span>
                <span className="tnum w-4 text-muted">{l.layer}</span>
                <span className="flex-1 text-base font-medium">{LAYER_LABEL[l.name]}</span>
                <span className={cx("text-sm", st.cls)}>{st.word}</span>
                <Icon name="chevron" size={14} className="t text-faint group-open:rotate-180" />
              </summary>
              <div className="pb-2 pl-12 pr-1 text-sm text-muted">
                <p>{HINT[l.name]}</p>
                {l.issues.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-4 text-text">{l.issues.map((x, k) => <li key={k}>{x}</li>)}</ul>}
              </div>
            </details>
          </li>
        );
      })}
    </ol>
  );
}
