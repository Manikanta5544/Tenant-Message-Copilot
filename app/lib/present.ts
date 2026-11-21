import { formatInr } from "@/core/money";
import type { Fact } from "@/core/types";

export const fmtDate = (d: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(d + "T00:00:00Z"));

/** Deterministic avatar colour from the token palette (never the status colours red or amber, which mean something). */
const AVATAR = ["bg-accent-soft text-accent", "bg-fact-bg text-fact", "bg-ready-bg text-ready", "bg-bg-subtle text-text", "bg-accent-soft text-fact"];
export function avatarTone(name: string): string {
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR[h % AVATAR.length]!;
}
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");

/** Where a value in the letter came from: shown in the hover/focus popover on a chip. */
export function factSource(f: Fact | undefined): { title: string; lines: string[] } {
  if (!f) return { title: "Source unavailable", lines: ["This value could not be matched to saved evidence."] };
  switch (f.kind) {
    case "balance": return { title: "Ledger balance", lines: [`Derived by code from ${f.lines.length} ledger lines`, `As of ${fmtDate(f.as_of)}`, f.crosscheck.agree ? `SQL cross-check agrees (${formatInr(f.crosscheck.sql_paise)})` : "SQL cross-check DISAGREES"] };
    case "payment": return { title: `Payment ${f.reference}`, lines: [`State: ${f.state}`, `Received ${fmtDate(f.received_on)}`, f.posted ? "Posted to the ledger" : "Not a ledger posting"] };
    case "clause": return { title: `Lease clause ${f.clause.number}`, lines: [f.clause.heading, `Version ${f.clause.version}, effective ${fmtDate(f.clause.effective_from)}`] };
    case "lease_term": return { title: "Lease record", lines: [`Field: ${f.term.replace("_", " ")}`, "Read from the lease, not written by the model"] };
    case "claim_match": return { title: "Claimed payment check", lines: [f.matched ? `Matched ${f.matched_reference}` : "No matching payment event", "Checked against raw payment events"] };
  }
}
