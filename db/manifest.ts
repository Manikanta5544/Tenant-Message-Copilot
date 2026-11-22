// Ordered list of migrations the app expects. /api/ready compares it to schema_migrations.
export const MIGRATIONS = [
  "0001_init.sql",
  "0002_integrity.sql",
  "0003_rls.sql",
  "0004_view_grants.sql",
  "0005_mock_mode.sql",
  "0006_abuse_limits.sql",
  "0007_review_actions.sql",
  "0008_visitor_run_selection.sql",
] as const;
