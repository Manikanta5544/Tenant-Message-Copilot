> Historical log. Test counts in this file were true when written; the current numbers are in CHANGELOG.md.

# Progress

## Phase 1: Foundation (done locally)
- Done: Next.js scaffold, 4 SQL migrations (11 tables, append-only triggers, two-scope RLS, `lease_balance` view, least-privilege grants), seed (101=12,000, 302=17,350, duplicate flagged), `/api/health`, `/api/ready`, `/api/demo/status`.
- Verified: typecheck clean, `next build` ok, endpoints return 200 locally, `/api/health` stays 200 with the database unreachable.
- Blockers: no Neon URLs, Vercel token, Anthropic key, or valid GitHub token yet (so nothing deployed, pooled-connection test unverified).
- Next: phase 2 (money core, balance view test, RLS isolation tests, verifier layers 1-3, critical-20 cases).

## Phase 2: Correctness before AI (done locally)
- Done: `core/{types,money,guard,policy,facts,verifier}.ts`, `db/store.ts` (SQL evidence store), critical-20 cases + schema (`evals/`), unit and DB tests.
- Verified: typecheck clean; money, guard (all three scripts), verifier layers 1-3, claim matching, TS-vs-SQL balance agreement for all 9 seeded leases at 7 dates, duplicates/pending/failed/reversal/lease-version cases, 10 DB constraint checks, two-scope isolation incl. Scenario 5 and fail-closed on pooled-style connection. Mutation check: weakening RLS made 7 isolation tests fail.
- Unverified: isolation on a real Neon pooled connection (no credentials).
- Next: phase 3 (providers, triage, bound tools, drafting, router, budget reservation, critical-20 through the pipeline).

## Phase 3: AI workflow (done on the mock; live model NOT run)
- Done: provider interface + mock (failure injection) + Anthropic provider + record/replay, triage, 4 bound tools with allowlists, fact-referenced drafting, router with keyword floors (EN/HI/TE/Hinglish), templates, atomic DB budget, severity scorer, eval runner (`eval`, `eval:replay`, `eval:mock`) saving to `eval_runs`.
- Tests: 201 pass, 8 skipped (Neon-only). Mock critical-20: 20/20, S0 0, S1 0 (says nothing about model quality). Budget: 20 concurrent reservations grant exactly the cap; tiny-cap run serves the banner template with no model call. Provider timeout/429/malformed/unavailable on triage and draft all fall back to escalate_only.
- Found by the evals: a claimed-payment statement could be written as free text, so a draft must now cite `claim_match` when present. Also fixed a scorer blind spot (unresolvable citations).
- Blockers: no ANTHROPIC_API_KEY, so `npm run eval` (live) and the Anthropic provider are unverified; `eval:replay` correctly refuses (no recordings exist).
- Next: phase 4 UI (inbox, workspace, trace, evals page), run service + API routes with persistence, rate limit.

## Phase 4-5 (done)
- UI (Workbench, evidence, verification, trace), API (rate limit, idempotency), evals (50 cases, scorer, gate), OpenAI-compatible provider (Groq default), env template, CI, docker-compose, README, NOTE.
- Measured: mock critical 20/20; mock tier 2 40/50 (gate FAIL, see DECISIONS 27-29). 219 tests pass, 8 skipped.
- Next (needs the owner): set LLM_API_KEY and run `npm run eval`; Neon URLs + Vercel token to deploy; GitHub remote.

## Review rounds
- Round 1 (fix plan) and round 2 (lock report) applied: see DECISIONS 31-43. 257 tests pass, 8 skipped (Neon). Remaining work needs the owner: LLM key, live eval + recordings, Neon/Vercel deploy.

## Production-readiness pass
- Phase 1 done: D1, D2, D6, D3, D4, rate-limit trust, input hardening, error pages, logs, deps, bundle scan.
- Phase 2: doctor and prompt lock done. Live runs, recordings and live eval: NOT RUN (no key or network here).
- Phase 3 done: reasons.ts, decision card, escalate state, review UI, URL selection, j/k, /about, evals links.
- Phase 4 done: CI, RUNBOOK, NEON, verify:neon, NOTE. Neon and Vercel: not run.
