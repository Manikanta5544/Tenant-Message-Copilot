-- One pipeline per (message, visitor) at a time. A second POST while a run is still 'running' returns that run
-- instead of starting another (see createRun). This index is the backstop if two requests ever get past the app check.
CREATE UNIQUE INDEX IF NOT EXISTS runs_single_flight_idx
  ON runs (message_id, COALESCE(visitor_hash, ''))
  WHERE status = 'running';
