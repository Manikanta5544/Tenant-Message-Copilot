# Neon setup (exact steps)

1. **Create the project.** In the Neon console create a project (Postgres 16 or newer). Note the default branch (`main`) and database name.
2. **Get two connection strings** (Connection Details):
   - **Direct** (unpooled, host without `-pooler`): this is `DATABASE_URL_OWNER`. Used by `npm run migrate` and `npm run seed` only.
   - **Pooled** (host with `-pooler`): this is `DATABASE_URL_APP`, but with the restricted role. After step 3 replace the user and password with `copilot_app` and the password you chose in `APP_ROLE_PASSWORD`.
3. **Migrate and seed** from your machine, with a `.env` holding `DATABASE_URL_OWNER`, `DATABASE_URL_APP`, `APP_ROLE_PASSWORD` and (for baselines) `PROVIDER_MODE=live` plus `LLM_API_KEY`:
   ```bash
   npm run migrate        # creates tables, RLS policies, the copilot_app role (password = APP_ROLE_PASSWORD)
   npm run seed           # synthetic data, then baseline runs for the 5 scenarios through the live model
   npm run doctor         # env, both roles, non-bypass RLS role, migrations, model IDs, billed one-token round trips
   ```
4. **Set the Vercel environment** (Production): `PROVIDER_MODE=live`, `LLM_API_KEY`, `LLM_MODEL_*` (as printed by `npm run models`), `DATABASE_URL_APP` (pooled, `copilot_app`), `VISITOR_SALT` (`openssl rand -hex 32`), `DEMO_AS_OF_DATE`. Do **not** put `DATABASE_URL_OWNER` on Vercel.
5. **Deploy**, then confirm readiness: `curl -s https://<your-domain>/api/ready` returns `{"ok":true,...}` with every check `ok`. A 503 lists what is wrong.
6. **Close the "Neon isolation: not run" gap.** Create a second Neon branch named `test` (never reuse the app branch: the tests drop and rebuild the schema), then:
   ```bash
   export TEST_DATABASE_URL_OWNER='postgres://...direct url of the test branch...'
   export TEST_DATABASE_URL_APP='postgres://copilot_app:<APP_ROLE_PASSWORD>@...pooled host of the test branch.../db'
   npm run verify:neon    # prints PASS/FAIL for the RLS isolation, append-only review log and visitor-scope tests
   ```
   `verify:neon` refuses to run if the URLs match the application's own database.

Notes: `maxDuration` is 60 s on `/api/runs`. Vercel's Hobby plan allows up to 60 s without Fluid compute (more with it); confirm the limit for your plan in the project settings. A live run normally takes a few seconds; a run killed by the limit is shown as "did not finish" after 90 s with a Generate again button.
