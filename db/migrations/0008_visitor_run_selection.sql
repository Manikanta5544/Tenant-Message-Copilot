-- 0008: read path for visitor-scoped demo state (decision D3). The inbox picks, per message, the visitor's own latest run
-- if one exists, otherwise the shared baseline run (visitor_hash IS NULL). This index serves that lookup.
CREATE INDEX runs_message_visitor_idx ON runs (message_id, visitor_hash, created_at DESC);
