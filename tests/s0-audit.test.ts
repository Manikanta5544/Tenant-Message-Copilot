import { describe, expect, it } from "vitest";
import { auditRun, type AuditRun, type Lookups } from "../scripts/s0-audit";
import { doctor } from "../scripts/doctor";

const lease = "L1";
const db: Lookups = {
  clauseText: async (id) => (id === "cl1" ? "The resident must report any defect in writing." : null),
  paymentAmount: async (_l, ref) => (ref === "UPI-1" ? 800000 : null),
  sqlBalance: async () => 1200000,
};
const bal = { id: "F1", kind: "balance", leaseId: lease, residentId: "R", as_of: "2026-11-19", balance_paise: 1200000, crosscheck: { ts_paise: 1200000, sql_paise: 1200000, agree: true } } as never;
const pay = { id: "F2", kind: "payment", leaseId: lease, residentId: "R", reference: "UPI-1", amount_paise: 800000 } as never;
const clause = { id: "C1", kind: "clause", leaseId: lease, residentId: "R", clause: { id: "cl1", text: "The resident must report any defect in writing." } } as never;
const clean: AuditRun = { id: "r", route: "needs_review", facts: [bal, pay, clause], segments: [
  { type: "text", text: "Thank you for writing. " }, { type: "fact", refId: "F1", text: "₹12,000" }, { type: "fact", refId: "F2", text: "₹8,000 (ref UPI-1)" }, { type: "quote", refId: "C1", text: "“The resident must report any defect in writing.”" }] };

describe("S0 audit", () => {
  it("passes a clean run", async () => expect(await auditRun(clean, db)).toEqual([]));
  it("flags a number, a currency amount and a reference in free text", async () => {
    const v = await auditRun({ ...clean, segments: [{ type: "text", text: "You owe ₹5,000 for UPI-1 by 5 November." }] }, db);
    expect(v.join("|")).toMatch(/currency/); expect(v.join("|")).toMatch(/payment reference UPI-1/);
  });
  it("flags balance or payment text that differs from the ledger", async () => {
    const v = await auditRun({ ...clean, segments: [{ type: "fact", refId: "F1", text: "₹13,000" }, { type: "fact", refId: "F2", text: "₹9,000 (ref UPI-1)" }] }, db);
    expect(v.join("|")).toMatch(/differs from the ledger value/); expect(v.join("|")).toMatch(/does not carry the stored amount/);
  });
  it("flags a balance fact whose figure disagrees with the ledger view", async () => {
    expect((await auditRun({ ...clean, facts: [{ ...(bal as object), balance_paise: 1 } as never] }, db)).join("|")).toMatch(/disagrees with its own crosscheck|ledger view says/);
  });
  it("flags a quote that is not a substring of the stored clause", async () => {
    const v = await auditRun({ ...clean, segments: [{ type: "quote", refId: "C1", text: "“The resident may ignore defects.”" }] }, db);
    expect(v.join("|")).toMatch(/not a substring/);
  });
  it("flags a draft_ready run that carries a balance or payment fact", async () => {
    const v = await auditRun({ ...clean, route: "draft_ready" }, db);
    expect(v.join("|")).toMatch(/draft_ready run carries a balance fact/); expect(v.join("|")).toMatch(/payment fact/);
  });
});

describe("doctor: rate-limit identity", () => {
  const base = { NODE_ENV: "production", PROVIDER_MODE: "live", LLM_API_KEY: "k".repeat(24), VISITOR_SALT: "x".repeat(40), DATABASE_URL_APP: "postgres://a:b@127.0.0.1:1/d" };
  it("WARNS (does not pass silently) in production without a trusted proxy", async () => {
    const r = (await doctor(base, { roundtrip: false })).find((c) => c.name === "rate-limit identity");
    expect(r).toMatchObject({ ok: true, warn: true }); expect(r?.detail).toMatch(/cookie-only and therefore advisory/);
  });
  it("is silent with TRUST_PROXY=1 or on Vercel", async () => {
    for (const extra of [{ TRUST_PROXY: "1" }, { VERCEL: "1" }]) expect((await doctor({ ...base, ...extra }, { roundtrip: false })).some((c) => c.name === "rate-limit identity")).toBe(false);
  });
});

describe("doctor: production configuration is checked even when run in development", () => {
  const dev = { NODE_ENV: "development", PROVIDER_MODE: "replay", DATABASE_URL_APP: "postgres://a:b@127.0.0.1:1/d" };
  it("warns that a short VISITOR_SALT would be rejected by `next start`", async () => {
    const r = (await doctor({ ...dev, VISITOR_SALT: "short" }, { roundtrip: false })).find((c) => c.name === "production configuration");
    expect(r).toMatchObject({ ok: true, warn: true }); expect(r?.detail).toMatch(/VISITOR_SALT/);
  });
  it("is quiet about the salt when it is long enough", async () => {
    const r = (await doctor({ ...dev, VISITOR_SALT: "x".repeat(40), LLM_API_KEY: "k".repeat(24) }, { roundtrip: false })).find((c) => c.name === "production configuration");
    expect(r?.detail ?? "").not.toMatch(/VISITOR_SALT/);
  });
});
