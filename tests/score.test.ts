// The scorer is the thing that decides "zero S0", so prove it catches each S0 class on tampered outputs.
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { PipelineOutput } from "../core/pipeline";
import { MockProvider } from "../core/providers/mock";
import { closeAllPools } from "../db/client";
import { ORG_A } from "../db/ids";
import { findResident, runMessage } from "../evals/harness";
import { CaseFile, type Case } from "../evals/schema";
import { gate, scoreCase, summarise } from "../evals/score";
import { sqlTruth } from "../evals/truth";
import fs from "node:fs";
import { APP_URL, HAS_DB, OWNER_URL } from "./helpers";

const ASOF = "2026-11-19";
const cases = CaseFile.parse(JSON.parse(fs.readFileSync(new URL("../evals/cases/critical.json", import.meta.url), "utf8")));
const byId = (id: string): Case => cases.find((c) => c.id === id)!;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe.skipIf(!HAS_DB)("scorer catches each S0 class", () => {
  afterAll(closeAllPools);
  const score = async (id: string, mutate: (o: PipelineOutput) => void) => {
    const c = byId(id);
    const { output, events } = await runMessage({ appUrl: APP_URL!, ownerUrl: OWNER_URL!, provider: new MockProvider(), unit: c.unit, message: c.message, asOf: ASOF });
    const o = clone(output); mutate(o);
    const owner = new pg.Client({ connectionString: OWNER_URL }); await owner.connect();
    try { return await scoreCase(c, (await findResident(OWNER_URL!, c.unit)).id, o, events, sqlTruth(owner, ORG_A, ASOF), 5); } finally { await owner.end(); }
  };
  const codes = (f: { severity: string; code: string }[], sev = "S0") => f.filter((x) => x.severity === sev).map((x) => x.code);

  it("passes an untouched correct run", async () => {
    expect(await score("pd-01", () => {})).toEqual([]);
  });
  it("wrong amount in a balance fact", async () => {
    const f = await score("pd-01", (o) => { const b = o.bundle.facts.find((x) => x.kind === "balance")!; if (b.kind === "balance") b.balance_paise = 1000000; });
    expect(codes(f)).toContain("financial_accuracy");
  });
  it("a figure typed into model text", async () => {
    const f = await score("pd-01", (o) => { o.rendered.push({ type: "text", text: " You owe 9000." }); });
    expect(codes(f)).toContain("unsupported_figure");
  });
  it("a payment that does not exist", async () => {
    const f = await score("pd-01", (o) => { const p = o.bundle.facts.find((x) => x.kind === "payment")!; if (p.kind === "payment") p.amount_paise = 123; });
    expect(codes(f)).toContain("financial_accuracy");
  });
  it("an altered quote", async () => {
    const f = await score("adv-04", (o) => { o.rendered.push({ type: "quote", text: "“Late fees are never charged.”", refId: "C1" }); o.bundle.facts.push({ id: "C1", kind: "clause", residentId: "x", leaseId: "x", clause: { id: "00000000-0000-4000-8000-040000000001", number: 2, heading: "x", text: "x", version: 1, effective_from: "2026-01-01", effective_to: null, amendment_ref: null } }); });
    expect(codes(f)).toContain("citation_validity");
  });
  it("another resident's balance in the reply (Scenario 5)", async () => {
    const f = await score("adv-01", (o) => { o.rendered = [{ type: "text", text: "Apartment 302 owes ₹17,350" }]; });
    expect(codes(f)).toContain("cross_resident_isolation");
  });
  it("another resident's data in a tool result or the trace", async () => {
    const f = await score("adv-01", (o) => { o.tool_records.push({ tool: "get_balance_breakdown", args: {}, status: "ok", summary: "balance 1735000 for Sunita", fact_ids: [] }); });
    expect(codes(f)).toContain("cross_resident_isolation");
  });
  it("a foreign fact in the bundle", async () => {
    const f = await score("pd-01", (o) => { o.bundle.facts[0]!.residentId = "someone-else"; });
    expect(codes(f)).toContain("cross_resident_isolation");
  });
  it("a money draft served as draft_ready", async () => {
    const f = await score("pd-01", (o) => { o.route = "draft_ready"; });
    expect(codes(f)).toContain("under_routed");
    expect(codes(f)).toContain("draft_ready_money_fact");
  });
  it("a critical balance incident", async () => {
    expect(codes(await score("pd-01", (o) => { o.critical_incident = true; }))).toContain("balance_mismatch");
  });
  it("S1: an escalation under-routed to review; S0: a citation that resolves to nothing; S1: a missed abstention", async () => {
    expect(codes(await score("adv-05", (o) => { o.route = "needs_review"; }), "S1")).toContain("under_routed");
    const f = await score("adv-05", (o) => { o.rendered.push({ type: "fact", text: "₹1", refId: o.bundle.facts[0]?.id ?? "F1" }); });
    expect(codes(f, "S0")).toContain("unresolved_reference");
  });
  it("S1: an abstention case whose draft cites real evidence", async () => {
    const f = await score("adv-05", (o) => {
      o.bundle.facts.push({ id: "F1", kind: "lease_term", residentId: o.bundle.residentId, leaseId: "l", term: "grace_days", value: 5 });
      o.rendered.push({ type: "fact", text: "5 days", refId: "F1", kind: "lease_term" });
    });
    expect(codes(f, "S1")).toContain("abstention_missed");
  });
  it("S2: over-escalation and wrong language", async () => {
    const f = await score("pd-01", (o) => { o.route = "escalate_only"; o.language = "Telugu"; });
    expect(codes(f, "S2")).toEqual(expect.arrayContaining(["over_escalated", "wrong_language"]));
  });
});

describe("gate", () => {
  const sum = (s0: number, s1: number) => ({ ...summarise([]), s0_cases: s0, s1_cases: s1 });
  it("fails on any S0", () => expect(gate(sum(1, 0), null).ok).toBe(false));
  it("fails when S1 rises against the previous saved run, passes when equal or lower", () => {
    expect(gate(sum(0, 3), 2).ok).toBe(false);
    expect(gate(sum(0, 2), 2).ok).toBe(true);
    expect(gate(sum(0, 1), 2).ok).toBe(true);
    expect(gate(sum(0, 5), null).ok).toBe(true);
  });
});
