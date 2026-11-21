-- 0004: the SQL balance view (independent of the TypeScript derivation) and least-privilege grants.
-- security_invoker makes the view obey the caller's RLS.
CREATE VIEW lease_balance WITH (security_invoker = true) AS
SELECT organization_id, resident_id, lease_id, occurred_on, entry_type,
       sum(amount_paise)::bigint AS total_paise, count(*)::int AS entries
FROM ledger_entries
GROUP BY organization_id, resident_id, lease_id, occurred_on, entry_type;

GRANT USAGE ON SCHEMA public TO copilot_app;
GRANT SELECT ON organizations, residents, leases, lease_clauses, payment_events, ledger_entries,
  messages, runs, trace_events, eval_runs, budget_days, lease_balance TO copilot_app;
GRANT INSERT ON messages, runs, trace_events, eval_runs, budget_days TO copilot_app;
GRANT UPDATE ON runs, budget_days TO copilot_app;
GRANT EXECUTE ON FUNCTION app_org(), app_resident(), app_view() TO copilot_app;
-- No DELETE or TRUNCATE is granted to the runtime role on any table.
