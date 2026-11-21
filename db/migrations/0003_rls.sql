-- 0003: two-scope row level security, enforced for every role without BYPASSRLS, owner included.
-- Strict scope = organisation AND resident. Inbox scope (app.view = 'inbox') adds read-only,
-- organisation-wide access to the four inbox tables only; it is set by server code, never by a request.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['organizations','residents','leases','lease_clauses','payment_events',
    'ledger_entries','messages','runs','trace_events','eval_runs','budget_days'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

CREATE POLICY org_scope ON organizations FOR SELECT USING (id = app_org());

CREATE POLICY resident_strict ON residents FOR SELECT
  USING (organization_id = app_org() AND id = app_resident());
CREATE POLICY resident_inbox ON residents FOR SELECT
  USING (organization_id = app_org() AND app_view() = 'inbox');

CREATE POLICY strict_read ON leases FOR SELECT
  USING (organization_id = app_org() AND resident_id = app_resident());
CREATE POLICY strict_read ON lease_clauses FOR SELECT
  USING (organization_id = app_org() AND resident_id = app_resident());
CREATE POLICY strict_read ON payment_events FOR SELECT
  USING (organization_id = app_org() AND resident_id = app_resident());
CREATE POLICY strict_read ON ledger_entries FOR SELECT
  USING (organization_id = app_org() AND resident_id = app_resident());

CREATE POLICY strict_read ON messages FOR SELECT
  USING (organization_id = app_org() AND resident_id = app_resident());
CREATE POLICY inbox_read ON messages FOR SELECT
  USING (organization_id = app_org() AND app_view() = 'inbox');
CREATE POLICY strict_insert ON messages FOR INSERT
  WITH CHECK (organization_id = app_org() AND resident_id = app_resident());

CREATE POLICY strict_read ON runs FOR SELECT
  USING (organization_id = app_org() AND resident_id = app_resident());
CREATE POLICY inbox_read ON runs FOR SELECT
  USING (organization_id = app_org() AND app_view() = 'inbox');
CREATE POLICY strict_insert ON runs FOR INSERT
  WITH CHECK (organization_id = app_org() AND resident_id = app_resident());
CREATE POLICY strict_update ON runs FOR UPDATE
  USING (organization_id = app_org() AND resident_id = app_resident())
  WITH CHECK (organization_id = app_org() AND resident_id = app_resident());

CREATE POLICY strict_read ON trace_events FOR SELECT
  USING (organization_id = app_org() AND resident_id = app_resident());
CREATE POLICY inbox_read ON trace_events FOR SELECT
  USING (organization_id = app_org() AND app_view() = 'inbox');
CREATE POLICY strict_insert ON trace_events FOR INSERT
  WITH CHECK (organization_id = app_org() AND resident_id = app_resident());

CREATE POLICY org_read ON eval_runs FOR SELECT USING (organization_id = app_org());
CREATE POLICY org_insert ON eval_runs FOR INSERT WITH CHECK (organization_id = app_org());

CREATE POLICY org_read ON budget_days FOR SELECT USING (organization_id = app_org());
CREATE POLICY org_insert ON budget_days FOR INSERT WITH CHECK (organization_id = app_org());
CREATE POLICY org_update ON budget_days FOR UPDATE
  USING (organization_id = app_org()) WITH CHECK (organization_id = app_org());
