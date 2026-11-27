-- Per-network ceiling for run creation. net_hash is a salted hash of the client address a trusted proxy reported; it is NULL when no
-- proxy is trusted (then only the per-visitor limits apply and they are advisory). The index serves the two ceiling counts in createRun.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS net_hash text;
CREATE INDEX IF NOT EXISTS runs_net_created_idx ON runs (net_hash, created_at) WHERE net_hash IS NOT NULL;
