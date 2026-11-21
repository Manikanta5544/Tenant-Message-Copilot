-- 0005: allow runs produced by the labelled mock provider (tests and local development only).
ALTER TABLE runs DROP CONSTRAINT runs_mode_check;
ALTER TABLE runs ADD CONSTRAINT runs_mode_check CHECK (mode IN ('live','replay','fallback','template','mock'));
