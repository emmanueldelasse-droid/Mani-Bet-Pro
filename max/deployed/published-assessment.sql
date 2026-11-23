-- Results are independent of the editions. A verified correction adds a dated observation.
CREATE TABLE IF NOT EXISTS published_final_observations (
  id INTEGER PRIMARY KEY,
  match_id TEXT NOT NULL,
  tip TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('FINAL','BOX')),
  observed_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  UNIQUE(match_id,tip,kind,observed_at),
  CHECK(tip<observed_at AND observed_at<=recorded_at)
);
CREATE INDEX IF NOT EXISTS published_observation_match
  ON published_final_observations(match_id,tip,kind,observed_at DESC);
CREATE TRIGGER IF NOT EXISTS published_observation_no_update BEFORE UPDATE ON published_final_observations
BEGIN SELECT RAISE(ABORT,'FROZEN_FINAL_OBSERVATION'); END;
CREATE TRIGGER IF NOT EXISTS published_observation_no_delete BEFORE DELETE ON published_final_observations
BEGIN SELECT RAISE(ABORT,'FROZEN_FINAL_OBSERVATION'); END;
