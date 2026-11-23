CREATE TABLE IF NOT EXISTS prompt_lab_pairs (
  id INTEGER PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES prompt_lab_experiments(id),
  match_id TEXT NOT NULL,
  tip TEXT NOT NULL,
  as_of TEXT NOT NULL,
  integrated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  delivery_key TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  UNIQUE(experiment_id,match_id,delivery_key),
  CHECK(as_of<=integrated_at AND integrated_at<tip)
);
CREATE INDEX IF NOT EXISTS prompt_lab_pairs_game ON prompt_lab_pairs(match_id,experiment_id,as_of DESC,id DESC);
CREATE TRIGGER IF NOT EXISTS prompt_lab_pairs_no_update BEFORE UPDATE ON prompt_lab_pairs
BEGIN SELECT RAISE(ABORT,'FROZEN_PROMPT_PAIR'); END;
CREATE TRIGGER IF NOT EXISTS prompt_lab_pairs_no_delete BEFORE DELETE ON prompt_lab_pairs
BEGIN SELECT RAISE(ABORT,'FROZEN_PROMPT_PAIR'); END;
CREATE TRIGGER IF NOT EXISTS prompt_lab_pairs_keep_first BEFORE INSERT ON prompt_lab_pairs
WHEN EXISTS (SELECT 1 FROM prompt_lab_pairs WHERE experiment_id=NEW.experiment_id AND match_id=NEW.match_id AND delivery_key=NEW.delivery_key)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TABLE IF NOT EXISTS prompt_lab_outcomes (
  experiment_id TEXT NOT NULL REFERENCES prompt_lab_experiments(id),
  match_id TEXT NOT NULL,
  pair_id INTEGER NOT NULL REFERENCES prompt_lab_pairs(id),
  tip TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  box_available INTEGER NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(experiment_id,match_id)
);
