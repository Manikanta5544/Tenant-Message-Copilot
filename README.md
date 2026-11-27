# Tenant Message Copilot

A tenant message goes in; a **grounded draft reply** comes out with evidence chips and a route (`draft_ready`, `needs_review`, `escalate_only`). **Nothing is ever sent to a tenant.** All data is synthetic and labelled as such in the UI.

> Status: built and tested against a labelled deterministic **Mock** model and a local HTTP stub of an OpenAI-compatible API. **No real hosted model has been run, and nothing is deployed.** See "Verified vs not verified".

## How it works

1. **Triage** the message (intent, urgency, language) and **plan** which bound tools to call (per-intent allowlist, at most 4 calls, no IDs in arguments).
2. **Evidence bundle**: lease clauses, the balance breakdown, payment history, a claimed-payment match. Every value is a numbered fact (`F1`) or clause (`C1`).
3. **Draft**: the model emits only segments: `text`, `fact`, `quote`. It never writes an amount, date or lease quote; code renders those from the bundle (money is integer paise, Indian grouping).
4. **Verify** in six layers: schema, evidence (unknown / duplicate / out-of-scope IDs rejected), exactness (TS balance vs SQL balance, connective-language guard), policy, semantic (can only lower trust), abstention. One retry; failing twice gives an `escalate_only` template with mode "fallback".
5. **Route** = the most cautious of: intent table, keyword floors (EN/HI/TE/Hinglish), verifier, semantic check, model suggestion, money fact, review floor.

Isolation is enforced by Postgres: two-scope RLS, transaction-local `set_config(..., true)`, a restricted role without BYPASSRLS, FORCE RLS, fail-closed. The org comes from server config, the resident from the stored message; the model supplies no IDs.

## Run locally

```bash
npm install
cp .env.example .env                # then edit: set PROVIDER_MODE and, for live, LLM_API_KEY
docker compose up -d                # Postgres 16 (or any Postgres; see .env.example)
npm run migrate && npm run seed
npm run models                      # prints the effective PROVIDER_MODE and checks each model ID
npm run doctor                      # full pre-flight (env, DB roles, migrations, models, billed one-token round trips)
npm run dev
```

**Mode rule:** the app runs in `mock` (free, labelled "Mock") unless `PROVIDER_MODE=live` is set in `.env`. A key alone does not switch it on. If a key is set while the mode is mock, the status bar and `/api/demo/status` show an amber hint: "Mock mode is on although a model key is set: set PROVIDER_MODE=live and restart". Restart `npm run dev` after editing `.env`.

Checks: `npm run typecheck`, `npm run lint`, `npm test`, `npm run contrast` (WCAG AA tokens), `npm run e2e` (Playwright, headers/CSP/flows; `npx playwright install chromium` first), `npm run e2e:layout` (width/zoom matrix against a production build), `npm run e2e:stale` (dev server: stale stylesheet and service-worker diagnosis). Production: refuses `PROVIDER_MODE=mock`. See `docs/NEON.md` (deploy) and `docs/RUNBOOK.md` (operations).

### After pulling new code

```bash
npm run migrate && npm run seed
```

A database that is behind the code answers `503 {"code":"schema_out_of_date","hint":"Run: npm run migrate && npm run seed"}` (never an opaque 500), `npm run dev` prints a warning before it starts (`scripts/doctor-quick.ts`, warn-only), and the inbox shows a setup panel until every demo scenario has a real (non-fallback) baseline draft. `npm run seed` exits non-zero and lists the scenarios it could not baseline if the model provider is down; re-running it replaces fallback baselines.

## Plug in your LLM (free tier: Groq or any OpenAI-compatible API)

Edit `.env` (the left-blank slot is `LLM_API_KEY`):

```
PROVIDER_MODE=live
LLM_PROVIDER=openai_compat
LLM_API_KEY=<your key>                       # https://console.groq.com
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_MODEL_TRIAGE=openai/gpt-oss-20b
LLM_MODEL_DRAFT=openai/gpt-oss-120b
LLM_MODEL_CHECK=openai/gpt-oss-20b
LLM_REASONING_EFFORT=low
LLM_OUTPUT_HEADROOM=1000
```

Other endpoints work by changing `LLM_BASE_URL` and the model names (OpenRouter, Together, Gemini's OpenAI endpoint, local Ollama at `http://localhost:11434/v1`). If the endpoint rejects JSON mode set `LLM_JSON_MODE=false`. Anthropic is still available via `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`. Model names change (Groq shut down its Llama 3.x IDs on 16 Aug 2026): run `npm run models` to check every configured ID against your key, and note the status bar and `/api/demo/status` report per-role availability. The defaults come from Groq's deprecations page, not from a call with your key.

Then record real runs: `npm run eval` (live; saves scores to `eval_runs` and responses to `evals/fixtures/recorded.json`). After that `npm run eval:replay` and `PROVIDER_MODE=replay` serve those recordings, labelled "Replay". Free tiers are rate limited; the app returns a holding reply when the provider fails.

## Environment variables

See `.env.example` (every variable is commented). Secrets stay server side; `.env` is git-ignored.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev / build / start` | Next.js app |
| `npm run migrate` / `seed` / `db:reset` | Schema (owner connection), synthetic data, local rebuild |
| `npm test` | Unit, database and isolation tests (needs `TEST_DATABASE_URL_*`; skipped DB tests are reported as skipped) |
| `npm run eval` / `eval:replay` / `eval:mock` | Evals: live model, recordings, mock. `-- --tier 2` adds the 30 extended cases (saved only with `--save-extended`; the Evals page headline is always the critical 20) |
| `npm run models` | Checks each configured model ID against your key (no tokens billed) |

## Deploy (Vercel + Neon)

1. Create a Neon project. Use the **direct** URL as `DATABASE_URL_OWNER` and the **pooled** URL (restricted role `copilot_app`) as `DATABASE_URL_APP`. Run `npm run migrate && npm run seed` once from your machine with the owner URL.
2. Import the repo in Vercel; set the variables from `.env.example` (including `LLM_API_KEY`, `VISITOR_SALT`).
3. Set the Vercel function region next to your Neon region.
4. Run the isolation tests against Neon by setting `TEST_DATABASE_URL_OWNER/APP` to a throwaway Neon branch (not yet done: unverified).

**Rate limits and scale.** Behind Vercel or `TRUST_PROXY=1` limits apply per visitor and per network. Without a trusted proxy the per-visitor limits are cookie-only and therefore advisory (`npm run doctor` warns in production); only the global daily cap and budget are a hard stop. Model concurrency is `LLM_MAX_CONCURRENCY` x instances and SSE caps are per instance. On one multi-core host, `npm run start:cluster` (`WEB_CONCURRENCY`) runs one worker per core; those per-process caps then multiply.

## Operations notes

- **Live trace.** `POST /api/runs` returns at once and the pipeline finishes after the response; the UI polls every 700 ms. This is polling, not SSE (SSE was a Tier 2 item and was skipped).
- **Retrieval adjudication.** After clause search, one model call keeps only relevant clauses and flags conflicts; it can remove evidence but never add it.
- **Limits.** Per-visitor (IP hash) hourly caps on runs and messages, a hard daily run cap on the real UTC date, and one retry on 429/5xx. A free-tier eval run needs `EVAL_PACE_MS` pacing.
- **Eval validity.** A run with more than 10% fallbacks or errors is invalid, fails the gate and is never saved as a baseline.
- Custom messages are visible only to the visitor who wrote them.
- **Client IP.** Rate limits use the first `x-forwarded-for` value. That is correct on Vercel (it overwrites the header) and spoofable on any host that passes the client's own header through; put a trusted proxy in front or change `clientKey` in `app/server/http.ts`.
- **Readiness.** `/api/ready` checks the database, migrations, the restricted role, `VISITOR_SALT` (production) and that live mode has a key. `/api/demo/status` (cached 60 s) reports the model list per role.

## Evals and gate

50 cases (20 critical tier 1, 30 extended tier 2), scored against SQL ground truth by severity: **S0** (unsafe: wrong money, unsupported claim, leaked scope, unresolved citation), S1, S2. Gate: S0 = 0 and S1 not higher than the previous saved run of the same mode.

Measured so far (mock only, tests the application, not model quality): tier 1, 20/20, S0 0, S1 0. Tier 2 on 50 cases: 40/50, S0 1, S1 9, S2 7, **gate FAIL**. See `docs/DECISIONS.md` #27-29 for the causes: crude mock heuristics, an over-cautious clause-conflict check (`lease-03`) and an open finding (`abs-05`) that only a real semantic-check model can catch. The mock adjudicator reproduces the old rank heuristic, so these numbers did not change after adding the adjudication step; whether a real model fixes `lease-03` and `abs-05` is unverified. Live and replay results: none yet.

## Real-time, load and performance

- Live updates use Server-Sent Events (`GET /api/runs/:id/events`) with an automatic polling fallback. Caps: `SSE_MAX_PER_IP`, `SSE_MAX_GLOBAL`.
- Model calls are limited per instance (`LLM_MAX_CONCURRENCY`, `LLM_QUEUE_WAIT_MS`); beyond that the draft falls back visibly as "busy".
- `/system` shows runs, latency by stage, retry rate, provider headroom, budget and limits.
- `npm run load -- 50` (set `TRUST_PROXY=1` on the server and a high `DEMO_DAILY_BUDGET_USD`), `npm run perf`, `npm run explain`. Results and caveats: docs/PERF.md.
- Ctrl/Cmd+K opens the command palette. If the page ever looks unstyled: `npm run clean`, restart, and open `/setup/layout` (development).

## Verified vs not verified

- Verified (local Postgres 16): typecheck clean; 383 tests pass, 8 skipped; RLS isolation; budget atomicity; pipeline with mock; OpenAI-compatible provider against a local stub; UI and API smoke on the mock.
- **Not verified**: any real model (Groq, Anthropic); Neon (isolation tests skipped there); Vercel deployment; live eval numbers; prompt quality for Hindi/Telugu.

## Known limitations

- Connective-language guard gaps: spelled-out numbers in languages beyond English/Hindi/Telugu, number words in unusual transliterations, dates written without digits or month names ("the day after Diwali"), and non-numeric promises ("we will fix it tomorrow", "by evening") are not blocked by the guard; they rely on the semantic layer and routing. Homoglyph and zero-width tricks are only partly covered.
- Conflict detection between lease clauses uses full-text rank and is deliberately cautious (false positives cost a review).
- Free-tier models are weaker and rate limited; expect more fallbacks. Limits are per IP hash, so one person behind many IPs is not stopped (a real deployment needs auth). No ESLint: `typescript-eslint` does not support TypeScript 7 yet; `tsc` runs with `noUnusedLocals`.
- No UPI/Razorpay integration, no customer deployment, no sending.
- Demo "today" is fixed by `DEMO_AS_OF_DATE`.

## Layout

`core/` pure logic and providers · `db/` migrations, seed, stores · `app/` UI and API · `evals/` cases, scorer, runner · `tests/` · `docs/DECISIONS.md` (design log) · `docs/PROGRESS.md` · `docs/NOTE.md` (one-page summary).
