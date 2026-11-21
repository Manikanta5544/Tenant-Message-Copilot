#!/usr/bin/env bash
# Local Postgres 16 for development and tests. Assumes a running server reachable as superuser.
# Usage: PGHOST=/tmp PGPORT=5433 PGUSER=postgres scripts/setup-local-db.sh
set -euo pipefail
psql -v ON_ERROR_STOP=1 -d postgres <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='copilot_owner') THEN
    CREATE ROLE copilot_owner LOGIN PASSWORD 'owner' BYPASSRLS CREATEROLE;
  END IF;
END $$;
SQL
for db in copilot copilot_test; do
  psql -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 \
    || psql -d postgres -c "CREATE DATABASE $db OWNER copilot_owner"
  psql -d "$db" -c "GRANT ALL ON SCHEMA public TO copilot_owner"
done
