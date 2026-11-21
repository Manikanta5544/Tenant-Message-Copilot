-- 0006: abuse limits. Messages remember which visitor wrote them (a salted hash of the IP, never the IP),
-- and the daily budget row also counts runs so free-tier quota has a hard, atomic ceiling.
ALTER TABLE messages ADD COLUMN visitor_hash text;
CREATE INDEX messages_visitor_recent ON messages (visitor_hash, created_at) WHERE visitor_hash IS NOT NULL;
CREATE INDEX runs_visitor_recent ON runs (visitor_hash, created_at) WHERE visitor_hash IS NOT NULL;
ALTER TABLE budget_days ADD COLUMN runs_used integer NOT NULL DEFAULT 0 CHECK (runs_used >= 0);
