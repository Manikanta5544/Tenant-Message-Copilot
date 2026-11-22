// Client-side shapes of the API responses (type-only imports: no server code reaches the browser).
export type { InboxRow, RunView, TraceRow } from "@/db/runs";
export type { ReviewRow } from "@/db/review";
export type Route = "draft_ready" | "needs_review" | "escalate_only";
export interface Seg { type: "text" | "fact" | "quote"; text: string; refId?: string; kind?: string; cite?: string }
export interface LayerView { layer: number; name: string; ok: boolean; effect: string; issues: string[]; skipped?: boolean; critical?: boolean }
export interface StatusView {
  demo_mode: boolean; synthetic_data: boolean; as_of: string; provider_mode: "live" | "replay" | "mock"; provider_backend?: string | null;
  /** True when PROVIDER_MODE is not live although a model key is configured (a common setup slip). */
  mock_with_key?: boolean;
  provider: string; budget: { day: string; cap_micro_usd: number; remaining_micro_usd: number | null; runs_used: number | null; runs_cap: number };
  models: Record<string, { model: string; available: boolean | null }> | null;
}
