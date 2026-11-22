-- 0007: reviewer decisions (decision D4). Append-only: the runtime role may INSERT and SELECT, never UPDATE or DELETE,
-- and a trigger rejects UPDATE, DELETE and TRUNCATE for every role (including the owner), so history cannot be rewritten.
-- Nothing here sends anything to a tenant; it records what a person in the demo decided about a draft.
CREATE TABLE review_actions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  resident_id uuid NOT NULL,
  run_id uuid NOT NULL,
  visitor_hash text NOT NULL,
  action text NOT NULL CHECK (action IN ('approved','edited','regenerated')),
  edited_text text CHECK (edited_text IS NULL OR char_length(edited_text) <= 2000),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((action = 'edited') = (edited_text IS NOT NULL)),
  FOREIGN KEY (organization_id, resident_id, run_id) REFERENCES runs(organization_id, resident_id, id),
  UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX review_actions_run_idx ON review_actions (run_id, created_at);

ALTER TABLE review_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_actions FORCE ROW LEVEL SECURITY;
CREATE POLICY strict_read ON review_actions FOR SELECT
  USING (organization_id = app_org() AND resident_id = app_resident());
CREATE POLICY strict_insert ON review_actions FOR INSERT
  WITH CHECK (organization_id = app_org() AND resident_id = app_resident());
-- Deliberately no UPDATE or DELETE policy.

GRANT SELECT, INSERT ON review_actions TO copilot_app;

CREATE FUNCTION review_actions_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'review_actions is append-only' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER review_actions_no_update BEFORE UPDATE OR DELETE ON review_actions
  FOR EACH ROW EXECUTE FUNCTION review_actions_append_only();
CREATE TRIGGER review_actions_no_truncate BEFORE TRUNCATE ON review_actions
  FOR EACH STATEMENT EXECUTE FUNCTION review_actions_append_only();
