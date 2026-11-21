-- 0002: append-only enforcement, duplicate flagging, posting rules.
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = '55000';
END $$;

CREATE TRIGGER payment_events_append_only BEFORE UPDATE OR DELETE ON payment_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER eval_runs_append_only BEFORE UPDATE OR DELETE ON eval_runs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER payment_events_no_truncate BEFORE TRUNCATE ON payment_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ledger_entries_no_truncate BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- A second event with the same organisation, reference and state is stored and flagged,
-- never merged and never posted.
CREATE OR REPLACE FUNCTION flag_duplicate_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE first_id uuid;
BEGIN
  SELECT id INTO first_id FROM payment_events
   WHERE organization_id = NEW.organization_id AND reference = NEW.reference AND state = NEW.state
   ORDER BY received_at, id LIMIT 1;
  IF first_id IS NOT NULL THEN
    NEW.is_duplicate := true;
    NEW.duplicate_of := first_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_events_flag_duplicate BEFORE INSERT ON payment_events
  FOR EACH ROW EXECUTE FUNCTION flag_duplicate_event();

-- A payment posting needs a settled, non-duplicate event of the same lease and amount;
-- a reversal must negate a payment of the same lease and amount.
CREATE OR REPLACE FUNCTION check_ledger_posting() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ev payment_events%ROWTYPE; orig ledger_entries%ROWTYPE;
BEGIN
  IF NEW.entry_type = 'payment' THEN
    SELECT * INTO ev FROM payment_events WHERE id = NEW.source_event_id;
    IF ev.state <> 'settled' THEN RAISE EXCEPTION 'only settled events may post (event is %)', ev.state; END IF;
    IF ev.is_duplicate THEN RAISE EXCEPTION 'a duplicate event may not post'; END IF;
    IF ev.lease_id <> NEW.lease_id OR ev.amount_paise <> -NEW.amount_paise THEN
      RAISE EXCEPTION 'posting does not match its source event';
    END IF;
  ELSIF NEW.entry_type = 'reversal' THEN
    SELECT * INTO orig FROM ledger_entries WHERE id = NEW.reverses_entry_id;
    IF orig.entry_type <> 'payment' OR orig.lease_id <> NEW.lease_id OR orig.amount_paise <> -NEW.amount_paise THEN
      RAISE EXCEPTION 'reversal must negate a payment of the same lease and amount';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ledger_entries_check_posting BEFORE INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION check_ledger_posting();
