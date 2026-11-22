# Runbook

## Environment variables
All variables are declared and validated in `core/env.ts`; a bad value fails readiness with a readable message.

| Variable | Required | Purpose |
|---|---|---|
| `PROVIDER_MODE` | prod: live | `live` (model), `replay` (recorded real responses), `mock` (tests/CI/local only; **refused in production**) |
| `LLM_API_KEY` / `ANTHROPIC_API_KEY` | live | key for the OpenAI-compatible endpoint (default Groq) or Anthropic (`LLM_PROVIDER=anthropic`) |
| `LLM_BASE_URL`, `LLM_MODEL_TRIAGE/DRAFT/CHECK` | live | endpoint and model IDs; confirm with `npm run models` |
| `LLM_REASONING_EFFORT`, `LLM_OUTPUT_HEADROOM`, `LLM_JSON_MODE`, `LLM_PRICES_JSON` | no | reasoning-model tuning, JSON-mode toggle, prices for cost accounting |
| `DATABASE_URL_APP` | prod | pooled URL of the restricted role `copilot_app` |
| `DATABASE_URL_OWNER`, `APP_ROLE_PASSWORD` | migrate/seed only | direct owner URL (never on Vercel); password given to `copilot_app` |
| `VISITOR_SALT` | prod: 32+ chars | salt for the visitor hash used by rate limits and visitor-scoped runs |
| `DEMO_AS_OF_DATE` | no | the "today" scenarios are computed against |
| `DEMO_DAILY_BUDGET_USD`, `DEMO_MAX_RUNS_PER_DAY`, `RATE_LIMIT_PER_HOUR/DAY`, `MESSAGE_LIMIT_PER_HOUR` | no | cost and abuse limits |
| `TRUST_PROXY` | no | `1` to trust `x-forwarded-for` behind your own proxy. Vercel (`VERCEL=1`) is trusted automatically. |
| `REPO_URL` | no | links the recorded commit on the evals page |

**Rate-limit identity.** `x-forwarded-for` is trusted only when `VERCEL=1` or `TRUST_PROXY=1`. Otherwise it is ignored (it is attacker-controlled) and all traffic shares one conservative bucket, because the App Router exposes no socket address. Behind your own proxy, set `TRUST_PROXY=1`.

## Checks
- `GET /api/health`: liveness (process is up, no dependencies).
- `GET /api/ready`: readiness (configuration, database, migrations, role). 503 means do not route traffic; the body says why.
- `npm run doctor`: the full pre-flight, including billed one-token model round trips.

## Rotate keys
- **Model key:** create a new key at the provider, set `LLM_API_KEY` in Vercel, redeploy, run `npm run doctor`, then revoke the old key.
- **App role password:** `ALTER ROLE copilot_app PASSWORD '...'` as owner, update `DATABASE_URL_APP`, redeploy.
- **VISITOR_SALT:** changing it resets every visitor's own runs and review history views (baselines are unaffected); rate-limit counters restart.

## Incidents
- **Groq/model down or rate limited.** Runs finish with a safe holding reply, route `escalate_only`, and the banner "The model is unavailable; showing a safe holding reply". Nothing is silently mocked. Check the provider status page, run `npm run models`, lower traffic, or wait for `Retry-After`. Free-tier 429s are retried with the provider's `Retry-After` (capped).
- **Budget exhausted.** The banner "Daily demo budget is used up" appears and runs return template replies. The budget and the run cap reset at 00:00 UTC. Raise `DEMO_DAILY_BUDGET_USD` or `DEMO_MAX_RUNS_PER_DAY` and redeploy if appropriate.
- **Database unreachable.** `/api/ready` returns 503 and API calls fail with a 5xx; the UI shows error states with Retry. Check Neon status and `DATABASE_URL_APP`; Neon may need a moment to wake a suspended compute.
- **A run stuck "running".** After 90 s the next read marks it failed and the UI offers Generate again. Cause is usually the function hitting `maxDuration` (60 s).
- **Boot refuses with "PROVIDER_MODE=mock is not allowed in production".** Set `PROVIDER_MODE=live` (or `replay`) and redeploy. The app shows a maintenance page until then.

## Reset the demo
`npm run db:reset` (drops and rebuilds the schema, reseeds, recreates the baseline runs with the configured provider). Never run it against production data you want to keep.

## Reading the logs
One JSON line per run: `{"level","msg":"run","run_id","route","outcome","mode","stage_latency_ms":{...},"tokens_in","tokens_out","cost_micro_usd","visitor"}`. `visitor` is the first 8 characters of a hash. Message text, IP addresses and keys are never logged. Configuration problems log `{"msg":"configuration invalid","problems":[...]}`. UI errors show a reference id (Next's digest for server errors) that matches the server log. Filter in Vercel with `msg:"run" level:error` for failed runs. `Server-Timing` on `GET /api/runs/:id` shows `db` and `pipeline` time.
