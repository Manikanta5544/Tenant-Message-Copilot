# Performance and concurrency

Everything here was measured in this build environment: **2 vCPUs shared by the browser, the load generator, Node and Postgres**, local Postgres 16, no network latency, mock model or an unreachable provider. It shows where the code stands, not what a deployed instance will do. Owner commands to repeat it are at the end.

## Front end (`npm run perf`, production build, Chromium 1280x800, 5 cold loads, median)

| metric | baseline | current | budget |
|---|---|---|---|
| JS on first load (gzip) | 160 KB | **162 KB** (the visitor-cookie and 429 reset-time code) | ≤ 170 |
| LCP | 92 ms | **92 to 124 ms** across three runs | ≤ 1500 |
| CLS | 0.002 | **0.003** | ≤ 0.02 |
| TBT | 0 | **0** | ≤ 150 |
| selection to draft shown | 108 ms | **86 to 103 ms** | ≤ 250 |
| search keystroke to paint | 22 ms | **25 ms** | ≤ 50 |

Rendering changes in this round: inbox rows and the evidence rail are `memo`ised; the search input stays instant while filtering uses `useDeferredValue`; off-screen inbox rows use `content-visibility: auto`; the only transition left is opacity (`.t`), and animations are opacity or transform. The first version of `content-visibility` used a 64 px placeholder and **raised CLS to 0.011** (rows measure 64 to 129 px, median 88); with `contain-intrinsic-size: auto 88px` CLS is back to 0.003. Without the rule CLS was 0.002, so the rule costs 0.001 and saves layout work for off-screen rows; with 19 rows the saving is not visible in these numbers.

Bundle: no further route-splitting was done this round. The command palette, trace table, detail view, audit export and batch runner already load on demand; the remaining first-load JS is the framework, the inbox and the shell. No extra split was found that would cut first-paint code without moving the selection-to-draft time past its budget.

## Load (`npm run load -- 50`, 50 simultaneous visitors with distinct addresses)

Production build, live mode against an unreachable provider (so create-run exercises the honest fallback), `TRUST_PROXY=1`, 2 vCPUs shared by the load generator, Node and Postgres:

| operation | n | p50 ms | p95 ms | p99 ms | budget p95 ms | p95 | result |
|---|---|---|---|---|---|---|---|
| inbox (GET /api/inbox) | 50 | 341 | 422 | 430 | 120 | 405 | **not met** |
| stored run (GET /api/runs/:id) | 50 | 273 | 313 | 443 | 80 | 265 | **not met** |
| stored run revalidated (304) | 50 | 278 | 320 | 324 | 30 | 292 | **not met** |
| create run (POST /api/runs) | 50 | 335 | 382 | 390 | 150 | 340 | **not met** |
| stream: first event | 50 | 201 | 347 | 377 | 300 | 368 | **not met** |

**0 responses with status 5xx, 0 client errors, 0 rate-limit rejections** (250 responses: 200 x150, 202 x50, 304 x50). Pool wait on the server: p50 0 ms, p95 13 ms, max 54 ms, pool size 3. RSS 176 to 203 MB.

The latency budgets are **not met**, and this round did not change that. One visitor alone gets each of these in about 5 ms, and the pool is no longer the wait (13 ms p95), so the time is 50 requests queueing for one Node thread on two shared CPUs: about 6 ms of CPU per request, serial. A budget of 120 ms p95 at 50-way concurrency needs about 2 ms per request or more than one process. I did not find a cheaper request that preserves the response bodies and the ETag, and I did not add a response cache because it would change what a visitor sees after their own action. On a host with spare cores and two or more instances the same code should do much better; that is **not verified** here.

## EXPLAIN (`npm run explain`, role and row-level scope as the app uses)

Row counts at measurement: runs 267, trace_events 1249, messages 19. **No plan, with the planner's own choice, contains a sequential scan on a growing table**, so no index is needed and **no `0010_*.sql` was added.** Plans below are `EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF)`; `npm run explain` prints these and the others (stream poll, single flight, per-visitor count).

### Run lookup (GET /api/runs/:id)

```
Nested Loop (actual rows=1 loops=1)
  Join Filter: (s.id = r.resident_id)
  Rows Removed by Join Filter: 1
  Buffers: shared hit=6
  ->  Nested Loop (actual rows=1 loops=1)
        Join Filter: (m.id = r.message_id)
        Buffers: shared hit=4
        ->  Index Scan using runs_pkey on runs r (actual rows=1 loops=1)
              Index Cond: (id = 'bc6c631c-c342-40f4-b427-e62ec428fc8e'::uuid)
              Filter: ((organization_id = (NULLIF(current_setting('app.org_id'::text, true), ''::text))::uuid) AND ((resident_id = (NULLIF(current_setting('app.resident_id'::text, true), ''::text))::uuid) OR (NULLIF(current_setting('app.view'::text, true), ''::text) = 'inbox'::text)))
              Buffers: shared hit=2
        ->  Bitmap Heap Scan on messages m (actual rows=1 loops=1)
              Recheck Cond: (organization_id = (NULLIF(current_setting('app.org_id'::text, true), ''::text))::uuid)
              Filter: ((resident_id = (NULLIF(current_setting('app.resident_id'::text, true), ''::text))::uuid) OR (NULLIF(current_setting('app.view'::text, true), ''::text) = 'inbox'::text))
              Heap Blocks: exact=1
              Buffers: shared hit=2
              ->  Bitmap Index Scan on messages_organization_id_resident_id_id_key (actual rows=19 loops=1)
                    Index Cond: (organization_id = (NULLIF(current_setting('app.org_id'::text, true), ''::text))::uuid)
                    Buffers: shared hit=1
  ->  Bitmap Heap Scan on residents s (actual rows=2 loops=1)
        Recheck Cond: (organization_id = (NULLIF(current_setting('app.org_id'::text, true), ''::text))::uuid)
        Filter: ((id = (NULLIF(current_setting('app.resident_id'::text, true), ''::text))::uuid) OR (NULLIF(current_setting('app.view'::text, true), ''::text) = 'inbox'::text))
        Heap Blocks: exact=1
        Buffers: shared hit=2
        ->  Bitmap Index Scan on residents_organization_id_unit_key (actual rows=7 loops=1)
              Index Cond: (organization_id = (NULLIF(current_setting('app.org_id'::text, true), ''::text))::uuid)
              Buffers: shared hit=1
Planning:
  Buffers: shared hit=216
Planning Time: 0.502 ms
Execution Time: 0.062 ms
```

### Trace rows for a run, in order

```
Sort (actual rows=8 loops=1)
  Sort Key: seq
  Sort Method: quicksort  Memory: 26kB
  Buffers: shared hit=6
  ->  Bitmap Heap Scan on trace_events (actual rows=8 loops=1)
        Recheck Cond: (run_id = 'bc6c631c-c342-40f4-b427-e62ec428fc8e'::uuid)
        Filter: ((organization_id = (NULLIF(current_setting('app.org_id'::text, true), ''::text))::uuid) AND ((resident_id = (NULLIF(current_setting('app.resident_id'::text, true), ''::text))::uuid) OR (NULLIF(current_setting('app.view'::text, true), ''::text) = 'inbox'::text)))
        Heap Blocks: exact=1
        Buffers: shared hit=3
        ->  Bitmap Index Scan on trace_events_run_id_seq_key (actual rows=8 loops=1)
              Index Cond: (run_id = 'bc6c631c-c342-40f4-b427-e62ec428fc8e'::uuid)
              Buffers: shared hit=2
Planning:
  Buffers: shared hit=49
Planning Time: 0.131 ms
Execution Time: 0.029 ms
```

### Inbox (GET /api/inbox)

```
Sort (actual rows=19 loops=1)
  Sort Key: ((m.scenario_label IS NULL)), m.scenario_label, m.created_at DESC
  Sort Method: quicksort  Memory: 27kB
  Buffers: shared hit=112
  ->  Nested Loop Left Join (actual rows=19 loops=1)
        Buffers: shared hit=101
        ->  Nested Loop (actual rows=19 loops=1)
              Buffers: shared hit=16
              ->  Bitmap Heap Scan on residents r (actual rows=7 loops=1)
                    Recheck Cond: (organization_id = (NULLIF(current_setting('app.org_id'::text, true), ''::text))::uuid)
                    Filter: ((id = (NULLIF(current_setting('app.resident_id'::text, true), ''::text))::uuid) OR (NULLIF(current_setting('app.view'::text, true), ''::text) = 'inbox'::text))
                    Heap Blocks: exact=1
                    Buffers: shared hit=2
                    ->  Bitmap Index Scan on residents_organization_id_unit_key (actual rows=7 loops=1)
                          Index Cond: (organization_id = (NULLIF(current_setting('app.org_id'::text, true), ''::text))::uuid)
                          Buffers: shared hit=1
              ->  Index Scan using messages_organization_id_resident_id_id_key on messages m (actual rows=3 loops=7)
                    Index Cond: ((organization_id = (NULLIF(current_setting('app.org_id'::text, true), ''::text))::uuid) AND (resident_id = r.id))
                    Filter: (((source = 'seeded'::text) OR ((visitor_hash IS NOT NULL) AND (visitor_hash = 'explain-visitor'::text))) AND ((resident_id = (NULLIF(current_setting('app.resident_id'::text, true), ''::text))::uuid) OR (NULLIF(current_setting('app.view'::text, true), ''::text) = 'inbox'::text)))
                    Buffers: shared hit=14
        ->  Limit (actual rows=0 loops=19)
              Buffers: shared hit=85
              ->  Sort (actual rows=0 loops=19)
                    Sort Key: ((runs.visitor_hash IS NULL)), runs.created_at DESC
                    Sort Method: quicksort  Memory: 25kB
                    Buffers: shared hit=85
                    ->  Bitmap Heap Scan on runs (actual rows=1 loops=19)
                          Recheck Cond: ((visitor_hash = 'explain-visitor'::text) OR ((message_id = m.id) AND (visitor_hash IS NULL)))
                          Filter: ((message_id = m.id) AND (organization_id = (NULLIF(current_setting('app.org_id'::text, true), ''::text))::uuid) AND ((resident_id = (NULLIF(current_setting('app.resident_id'::text, true), ''::text))::uuid) OR (NULLIF(current_setting('app.view'::text, true), ''::text) = 'inbox'::text)))
                          Heap Blocks: exact=9
                          Buffers: shared hit=85
                          ->  BitmapOr (actual rows=0 loops=19)
                                Buffers: shared hit=76
                                ->  Bitmap Index Scan on runs_visitor_recent (actual rows=0 loops=19)
                                      Index Cond: (visitor_hash = 'explain-visitor'::text)
                                      Buffers: shared hit=38
                                ->  Bitmap Index Scan on runs_message_visitor_idx (actual rows=1 loops=19)
                                      Index Cond: ((message_id = m.id) AND (visitor_hash IS NULL))
                                      Buffers: shared hit=38
Planning:
  Buffers: shared hit=22
Planning Time: 0.278 ms
Execution Time: 0.166 ms
```

### Review actions for a run (reviewer log)

```
Sort (actual rows=0 loops=1)
  Sort Key: ra.created_at, ra.id
  Sort Method: quicksort  Memory: 25kB
  Buffers: shared hit=5
  InitPlan 1 (returns $0)
    ->  Index Scan using runs_pkey on runs (never executed)
          Index Cond: (id = 'bc6c631c-c342-40f4-b427-e62ec428fc8e'::uuid)
          Filter: ((organization_id = (NULLIF(current_setting('app.org_id'::text, true), ''::text))::uuid) AND ((resident_id = (NULLIF(current_setting('app.resident_id'::text, true), ''::text))::uuid) OR (NULLIF(current_setting('app.view'::text, true), ''::text) = 'inbox'::text)))
  ->  Nested Loop (actual rows=0 loops=1)
        Buffers: shared hit=2
        ->  Bitmap Heap Scan on review_actions ra (actual rows=0 loops=1)
              Recheck Cond: (organization_id = (NULLIF(current_setting('app.org_id'::text, true), ''::text))::uuid)
              Filter: ((visitor_hash = 'explain-visitor'::text) AND (resident_id = (NULLIF(current_setting('app.resident_id'::text, true), ''::text))::uuid))
              Rows Removed by Filter: 2
              Heap Blocks: exact=1
              Buffers: shared hit=2
              ->  Bitmap Index Scan on review_actions_organization_id_idempotency_key_key (actual rows=2 loops=1)
                    Index Cond: (organization_id = (NULLIF(current_setting('app.org_id'::text, true), ''::text))::uuid)
                    Buffers: shared hit=1
        ->  Index Scan using runs_pkey on runs r (never executed)
              Index Cond: (id = ra.run_id)
              Filter: ((message_id = $0) AND (organization_id = (NULLIF(current_setting('app.org_id'::text, true), ''::text))::uuid) AND ((resident_id = (NULLIF(current_setting('app.resident_id'::text, true), ''::text))::uuid) OR (NULLIF(current_setting('app.view'::text, true), ''::text) = 'inbox'::text)))
Planning:
  Buffers: shared hit=78
Planning Time: 0.258 ms
Execution Time: 0.028 ms
```


## Database settings

Pool max 3, idle timeout 10 s, `statement_timeout` 8 s. A serverless or pooled Postgres has few connections to give, and every query is a short indexed lookup. Pool wait time is exposed on `/system`.

## Model-call concurrency

`LLM_MAX_CONCURRENCY` (default 4) calls in flight per instance, `LLM_QUEUE_WAIT_MS` (default 8000) bounded wait; beyond that a call fails with `busy` and the draft falls back visibly. `/system` shows in-flight, waiting, busy count, queue wait p95 and the provider's remaining requests/tokens from its rate-limit headers. A Postgres token bucket is worth adding when more than one instance serves traffic and shares one provider key.

## Evidence prefetch

Evidence reads are started while triage runs (see DECISIONS 67). Gain is the evidence read time (a few ms locally, more over a network); output is proven identical.

## What was not measured here

Live Groq under load, retry rate before/after the prompt fix on live traffic, Neon pooled behaviour, real network latency. See the final report for the commands.


## Load after the latency work (production build, 2 vCPU shared with the load generator and Postgres)

Changes measured here: `/api/*` skips the nonce/cookie work in the proxy, `set_config` and the query go in one round trip, the run GET answers 304 from a cheap version token before building a body, the inbox has a per-visitor cache (TTL 1.5 s, cleared on every write by this process), and the pool is 10 (`DB_POOL_MAX`). Command: `BASE_URL=http://localhost:3100 npm run load -- N`, one run each, single Node process.

| operation (p95 ms) | budget | before @50 | after @10 | after @25 | after @50 | after @50, 2 workers |
|---|---|---|---|---|---|---|
| inbox | 120 | 422 | 103 (pass) | 189 | 395 | 450 |
| stored run | 80 | 313 | 120 | 231 | 380 | 441 |
| 304 revalidation | 30 | 320 | 35 | 86 | 185 | 162 |
| create run | 150 | 382 | 158 | 228 | 328 | 386 |
| stream first event | 300 | 347 | 49 (pass) | 182 (pass) | 281 (pass) | 223 (pass) |

0 responses with 5xx and 0 client errors at every level; pool wait p95 60 ms at 50 (max 92 ms). A single visitor meets every budget (inbox 6 ms, run 17 ms, 304 5 ms, create 40 ms, first event 22 ms).

**Not met:** the inbox, stored run, 304 and create budgets are still missed at 25 and 50 simultaneous visitors, and 304 and create at 10. The only budget that moved from fail to pass at 50 is the stream first event. The machine has 2 cores shared by the load generator, Postgres and the server, so the server is CPU-bound; running two workers (`npm run start:cluster`, `WEB_CONCURRENCY=2`) gave no improvement here because there are no spare cores. The budgets were set for at least 4 cores and were not changed. Re-measure on such a host with `npm run load -- 50`; nothing here shows they pass there.

### Verification run (clean checkout, production build, 2 vCPU shared)

p50 / p95 / p99 in ms, one run per level, single Node process, `BASE_URL` = the server started by `scripts/with-server.mjs`.

| operation | budget p95 | 1 visitor | 10 | 25 | 50 |
|---|---|---|---|---|---|
| inbox | 120 | 6 / 6 / 6 pass | 56 / 115 / 115 pass | 151 / 237 / 245 **fail** | 188 / 316 / 335 **fail** |
| stored run | 80 | 16 / 16 / 16 pass | 74 / 88 / 88 **fail** | 198 / 241 / 280 **fail** | 278 / 345 / 368 **fail** |
| 304 | 30 | 6 / 6 / 6 pass | 26 / 57 / 57 **fail** | 72 / 87 / 89 **fail** | 120 / 150 / 154 **fail** |
| create run | 150 | 42 / 42 / 42 pass | 115 / 133 / 133 pass | 175 / 191 / 203 **fail** | 224 / 314 / 339 **fail** |
| stream first event | 300 | 25 / 25 / 25 pass | 45 / 57 / 57 pass | 110 / 145 / 146 pass | 235 / 263 / 269 pass |

0 responses with 5xx and 0 client errors at every level; pool wait p95 at most 6 ms. Front end (`npm run perf`, after `npm run seed`): JS 162 KB gzip, LCP 112 ms, CLS 0.003, TBT 0, selection to draft 82 ms, search 26 ms; all pass. `perf` needs baselines: without them the setup banner appears after load and CLS reads 0.025 (this happened once when the test suite had cleared a baseline, and is why the verification script seeds before `perf`).

Run-to-run variance is large on this machine (the stream first event at 50 visitors was 281, 315 and 263 ms in three runs), so a budget that passes by a small margin here is not evidence either way. **The 25 and 50 visitor budgets are not met on this hardware, and the 10-visitor run misses two.** Meeting them needs a host with at least 4 free cores for the server alone (not measured here).


### Latest run (production build, 2 vCPU shared, stubbed provider, database on the same host)

p50 / p95 / p99 in ms, one run per level, single Node process. Command: `npm run load -- N` against a server started by `scripts/with-server.mjs`.

| operation | budget p95 | 1 | 5 | 10 | 25 | 50 |
|---|---|---|---|---|---|---|
| inbox | 120 | 10 / 10 / 10 | 20 / 27 / 27 | 40 / 65 / 65 | 160 / 295 / 303 | 135 / 310 / 362 |
| stored run | 80 | 41 / 41 / 41 | 82 / 120 / 120 | 190 / 230 / 230 | 301 / 362 / 479 | 462 / 561 / 572 |
| 304 | 30 | 19 / 19 / 19 | 22 / 38 / 38 | 39 / 49 / 49 | 120 / 166 / 175 | 215 / 262 / 275 |
| create run | 150 | 93 / 93 / 93 | 178 / 246 / 246 | 273 / 367 / 367 | 442 / 613 / 614 | 494 / 649 / 715 |
| stream first event | 300 | 51 / 51 / 51 | 29 / 55 / 55 | 29 / 76 / 76 | 210 / 364 / 365 | 352 / 578 / 585 |

No 5xx and no client errors at any level. Pool wait p95: 23, 32, 23, 21 and 184 ms; the pool (10 connections) saturates only at 50 visitors. Server RSS stayed between 127 and 185 MB, and no streams stayed open after any run. Every budget is met with one visitor; from 5 visitors the stored-run, 304 and create budgets are missed, and from 25 visitors all are missed on this host.

These runs were slower than earlier ones on the same machine (an earlier run met the inbox budget at 10 visitors with 103 ms and the stream budget at 50), which shows run-to-run variance on shared cores that is comparable to the differences between code changes here. The profile shows about 5 ms of CPU per request on one event loop, spread across routing, serialization and the driver, with no single hot spot; the limit is the host, not a query.

### Round trips to a remote database

Counted as client-to-server packets per request, with a cold connection excluded: inbox 3, 304 revalidation 3, stored run 12, run creation 36. Skipping the COMMIT wait for read-only scopes and reading a run with its trace in one statement removed one trip each from the inbox, 304 and stored-run paths. With a database 20 ms away, run creation is the request most worth reducing next.
