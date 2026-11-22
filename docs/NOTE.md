# Tenant Message Copilot: one-page note

**What it does.** Reads one tenant message, gathers evidence from the tenant's own lease and ledger, and drafts a reply for a property manager: a letter with evidence chips, a six-layer verification panel and a route (draft ready / needs review / escalate only). Nothing is ever sent. All data is synthetic.

**How to evaluate it.** Open `/`, click Scenario 1 to 5 (each has a stored baseline run), then *Generate again* (your own run, visible only to you). Read `/about` (one screen), the Trace tab, and `/evals`. Approve or edit a draft: the decision is recorded in an append-only log and survives reload. Run `npm run doctor`, `npm test`, `npm run eval:mock`.

**Design.** The model writes only plain words plus references to evidence; code renders amounts (integer paise), dates and clause text. Verification: schema, evidence, exactness (TypeScript balance vs SQL view), policy, semantic (can only lower trust), abstention. The route is the most cautious of intent table, multilingual keyword floors, verifier, semantic check, model suggestion and money facts. Isolation is Postgres row-level security (two scopes, restricted role, FORCE RLS). Production refuses to start in mock mode; CSP is nonce-based.

**Measured (this repo, this sandbox).** Typecheck, lint, WCAG contrast (72 pairs) clean. 304 tests pass, 8 skipped (database tests ran against a local Postgres 16). Mock-model critical set: 20/20, S0 0, S1 0, which tests the application, not model quality. Mock all-50 still fails its gate (`abs-05`, a case that needs a real semantic check). Lighthouse accessibility 100 on `/`, `/evals`, `/about` (local Chromium). Playwright: security headers, nonce CSP with zero violations, no horizontal scroll 360 to 1920 px, review persistence, URL-addressable messages.

**Not verified (owner commands).** Live model results: none were produced here (no key, no network to the provider). Run `npm run doctor`, then `npm run eval`, then commit `evals/fixtures/recorded.json` and run `npm run eval:replay`. Neon: not run; `npm run verify:neon` per `docs/NEON.md`. Vercel deployment and the 60 s `maxDuration` on your plan. Turbopack build with real Google Fonts (verified here only with `--webpack` and mocked fonts; CI builds with the real path). Real Dark Reader extension (mutations simulated).

**Known limits.** Guard gaps (README); quality and rate limits of free-tier models; one shared rate bucket when no trusted proxy is configured; review history is filtered by visitor in the application, while the database enforces organisation and resident scope; `style-src 'unsafe-inline'`.

**Accepted risks.** D5: the public demo has no login. `GET /api/runs/:id` is a UUID capability URL over synthetic data, read-only. Production alternative: SSO plus per-organisation RLS claims.

**Next.** Real ingestion with provenance; human-labelled eval set and calibrated semantic judge; per-tenant keys and audit export; second-reviewer rule for money and legal routes; SSO and RLS claims.
