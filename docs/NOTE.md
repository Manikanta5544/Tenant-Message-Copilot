# Tenant Message Copilot: one-page note

**What it does.** Reads one tenant message, gathers evidence from the lease and ledger through four bound tools, and drafts a reply for a human. Output: draft with evidence chips, a verification panel, a route. It never sends anything.

**What the model does and doesn't do.** It classifies, picks tools from a per-intent allowlist, and writes connective prose as `text`, `fact` and `quote` segments. It never writes an amount, date or lease quote; code renders them from the evidence bundle. Money is integer paise. Free text must pass a guard (no digits in any script, currency, number words, month names).

**Retrieval.** After clause search a model call keeps only relevant clauses and flags conflicts; it can remove evidence, never add it (mock results unchanged; live effect unverified).

**Verification.** Six layers: schema, evidence (unknown/duplicate/out-of-scope fact IDs rejected), exactness (TypeScript balance against the SQL view), policy, semantic (can only lower trust), abstention. One retry, then an escalate-only template.

**Isolation.** Postgres row-level security with two scopes, transaction-local settings, a restricted role, FORCE RLS, fail-closed. Org from server config; resident from the stored message; the model supplies no IDs.

**Routing.** Most cautious of intent table, multilingual keyword floors, verifier, semantic check, model suggestion, any money fact, review floor.

**Measured results (mock model only; tests the application, not model quality).** Critical 20: 20/20, S0 0, S1 0. All 50: 40/50, S0 1, S1 9, S2 7, gate FAIL (mock limits, one conservative conflict check, one open finding `abs-05` needing a real semantic check). 257 tests pass, 8 skipped. **Live model results: none. Replay: none. Neon isolation: not run.**

**Judge calibration.** Not done (needs a live model): agreement with human labels: unverified.

**Limitations.** Guard gaps (see README); no real-model verification; free-tier quality and rate limits; synthetic data only; no payment integration.

**For a real customer.** Real lease and ledger ingestion with provenance; per-tenant keys and audit export; human-labelled eval set from real messages; calibrated semantic judge; retention and PII policy; reviewer feedback loop; load and rate-limit design; a second-reviewer rule for money and legal routes.
