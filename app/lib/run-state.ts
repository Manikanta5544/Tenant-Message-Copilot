import type { ReviewRow, RunView, TraceRow } from "./types";

/** What the detail pane knows about one message's run. `steps` are the trace stages seen so far while a run is still going. */
export type RunState =
  | { status: "idle" }
  | { status: "loading"; label: string; steps?: string[] }
  | { status: "error"; message: string }
  | { status: "ready"; run: RunView; trace: TraceRow[]; reviews: ReviewRow[] };
