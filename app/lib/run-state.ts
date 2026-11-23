import type { ReviewRow, RunView, TraceRow } from "./types";

/** What the detail pane knows about one message's run. `steps` are the trace stages seen so far while a run is still going. */
export type RunState =
  | { status: "idle" }
  /** `live` is true only while a run is actually executing (progress text and steps); opening a stored run is a plain skeleton. */
  | { status: "loading"; live?: boolean; label?: string; steps?: string[] }
  | { status: "error"; message: string; hint?: string; reference?: string; code?: string }
  | { status: "ready"; run: RunView; trace: TraceRow[]; reviews: ReviewRow[] };
