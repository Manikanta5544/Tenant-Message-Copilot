-- 0001: extensions, runtime role, scope helpers, the eleven tables.
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'copilot_app') THEN
    CREATE ROLE copilot_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

-- Scope readers. missing_ok = true and nullif('') make an unset scope NULL, so every policy
-- comparison is NULL and matches no rows (fail closed). Pooled connections leave '' behind
-- after a transaction-local set_config, hence the nullif.
CREATE OR REPLACE FUNCTION app_org() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION app_resident() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.resident_id', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION app_view() RETURNS text LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.view', true), '') $$;

CREATE TABLE organizations (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE residents (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  unit text NOT NULL,
  preferred_language text NOT NULL CHECK (preferred_language IN ('English','Hinglish','Hindi','Telugu')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, unit)
);

CREATE TABLE leases (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  resident_id uuid NOT NULL,
  rent_paise bigint NOT NULL CHECK (rent_paise > 0),
  due_day int NOT NULL CHECK (due_day BETWEEN 1 AND 28),
  grace_days int NOT NULL CHECK (grace_days >= 0),
  late_fee_rule text NOT NULL,
  deposit_paise bigint NOT NULL CHECK (deposit_paise >= 0),
  start_date date NOT NULL,
  end_date date,
  active boolean NOT NULL DEFAULT true,
  FOREIGN KEY (organization_id, resident_id) REFERENCES residents(organization_id, id),
  UNIQUE (organization_id, resident_id, id)
);
CREATE UNIQUE INDEX leases_one_active_per_resident ON leases (resident_id) WHERE active;

CREATE TABLE lease_clauses (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  resident_id uuid NOT NULL,
  lease_id uuid NOT NULL,
  number int NOT NULL,
  heading text NOT NULL,
  text text NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', heading || ' ' || text)) STORED,
  version int NOT NULL CHECK (version >= 1),
  effective_from date NOT NULL,
  effective_to date,
  amendment_ref text,
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  FOREIGN KEY (organization_id, resident_id, lease_id) REFERENCES leases(organization_id, resident_id, id),
  UNIQUE (lease_id, number, version),
  EXCLUDE USING gist (lease_id WITH =, number WITH =, daterange(effective_from, effective_to) WITH &&)
);
CREATE INDEX lease_clauses_tsv_idx ON lease_clauses USING gin (tsv);

CREATE TABLE payment_events (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  resident_id uuid NOT NULL,
  lease_id uuid NOT NULL,
  reference text NOT NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  state text NOT NULL CHECK (state IN ('pending','settled','failed')),
  method text NOT NULL DEFAULT 'UPI',
  received_at timestamptz NOT NULL,
  is_duplicate boolean NOT NULL DEFAULT false,
  duplicate_of uuid REFERENCES payment_events(id),
  note text,
  FOREIGN KEY (organization_id, resident_id, lease_id) REFERENCES leases(organization_id, resident_id, id)
);
CREATE INDEX payment_events_lease_idx ON payment_events (lease_id, received_at);

CREATE TABLE ledger_entries (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  resident_id uuid NOT NULL,
  lease_id uuid NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('charge','fee','payment','reversal','adjustment')),
  -- Signed integer paise: positive increases what the resident owes, negative reduces it.
  amount_paise bigint NOT NULL,
  currency char(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  description text NOT NULL,
  external_reference text,
  idempotency_key text NOT NULL,
  occurred_on date NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  source_event_id uuid REFERENCES payment_events(id),
  reverses_entry_id uuid REFERENCES ledger_entries(id),
  FOREIGN KEY (organization_id, resident_id, lease_id) REFERENCES leases(organization_id, resident_id, id),
  UNIQUE (organization_id, idempotency_key),
  CHECK (
    (entry_type IN ('charge','fee') AND amount_paise > 0)
    OR (entry_type = 'payment' AND amount_paise < 0 AND source_event_id IS NOT NULL)
    OR (entry_type = 'reversal' AND amount_paise > 0 AND reverses_entry_id IS NOT NULL)
    OR (entry_type = 'adjustment' AND amount_paise <> 0)
  )
);
CREATE UNIQUE INDEX ledger_one_posting_per_event ON ledger_entries (source_event_id) WHERE source_event_id IS NOT NULL;
CREATE UNIQUE INDEX ledger_one_reversal_per_entry ON ledger_entries (reverses_entry_id) WHERE reverses_entry_id IS NOT NULL;
CREATE INDEX ledger_lease_idx ON ledger_entries (lease_id, occurred_on);

CREATE TABLE messages (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  resident_id uuid NOT NULL,
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 2000),
  detected_language text,
  source text NOT NULL CHECK (source IN ('seeded','live')),
  scenario_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, resident_id) REFERENCES residents(organization_id, id),
  UNIQUE (organization_id, resident_id, id)
);

CREATE TABLE runs (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  resident_id uuid NOT NULL,
  message_id uuid NOT NULL,
  prompt_version text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('live','replay','fallback','template')),
  intent text,
  urgency text,
  language text,
  route text CHECK (route IS NULL OR route IN ('draft_ready','needs_review','escalate_only')),
  route_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  segments jsonb NOT NULL DEFAULT '[]'::jsonb,
  facts jsonb NOT NULL DEFAULT '[]'::jsonb,
  verification jsonb NOT NULL DEFAULT '[]'::jsonb,
  flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('running','completed','failed')),
  idempotency_key text NOT NULL,
  visitor_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  FOREIGN KEY (organization_id, resident_id, message_id) REFERENCES messages(organization_id, resident_id, id),
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (organization_id, resident_id, id)
);
CREATE INDEX runs_visitor_idx ON runs (visitor_hash, created_at);
CREATE INDEX runs_message_idx ON runs (message_id, created_at DESC);

CREATE TABLE trace_events (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  resident_id uuid NOT NULL,
  run_id uuid NOT NULL,
  seq int NOT NULL,
  stage text NOT NULL,
  model text,
  tokens_in int NOT NULL DEFAULT 0,
  tokens_out int NOT NULL DEFAULT 0,
  cost_micro_usd bigint NOT NULL DEFAULT 0,
  latency_ms int NOT NULL DEFAULT 0,
  outcome text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, resident_id, run_id) REFERENCES runs(organization_id, resident_id, id),
  UNIQUE (run_id, seq)
);

CREATE TABLE eval_runs (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  prompt_version text NOT NULL,
  git_commit text,
  mode text NOT NULL CHECK (mode IN ('live','replay','mock')),
  summary jsonb NOT NULL,
  results jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE budget_days (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  day date NOT NULL,
  cap_micro_usd bigint NOT NULL CHECK (cap_micro_usd >= 0),
  reserved_micro_usd bigint NOT NULL DEFAULT 0 CHECK (reserved_micro_usd >= 0),
  spent_micro_usd bigint NOT NULL DEFAULT 0 CHECK (spent_micro_usd >= 0),
  PRIMARY KEY (organization_id, day),
  CHECK (reserved_micro_usd + spent_micro_usd <= cap_micro_usd)
);
