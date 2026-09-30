-- Mani Bet Pro · NBA immutable analysis history
-- D1 / SQLite
--
-- nba_analysis_history is append-only by design:
-- - one row per analysis_id
-- - INSERT OR IGNORE in Worker for retry idempotence
-- - UPDATE/DELETE triggers reject mutation
--
-- Settlement is intentionally separate because results can be corrected/replayed
-- without mutating the original pre-match analysis snapshot.

CREATE TABLE IF NOT EXISTS nba_analysis_history (
  analysis_id TEXT PRIMARY KEY NOT NULL,
  match_id TEXT NOT NULL,
  season_id TEXT,
  event_type TEXT,
  season_type INTEGER,
  nba_phase TEXT,
  game_datetime TEXT,
  analyzed_at TEXT NOT NULL,
  home_team TEXT,
  away_team TEXT,
  status TEXT,
  motor_prob INTEGER,
  model_raw_score REAL,
  decision_prob REAL,
  probability_status TEXT,
  confidence_level TEXT,
  data_quality REAL,
  data_quality_observed REAL,
  best_edge REAL,
  best_market TEXT,
  best_side TEXT,
  payload_json TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_nba_analysis_match
  ON nba_analysis_history (match_id, analyzed_at);

CREATE INDEX IF NOT EXISTS idx_nba_analysis_season
  ON nba_analysis_history (season_id, analyzed_at);

CREATE INDEX IF NOT EXISTS idx_nba_analysis_datetime
  ON nba_analysis_history (game_datetime);

CREATE TRIGGER IF NOT EXISTS trg_nba_analysis_history_no_update
BEFORE UPDATE ON nba_analysis_history
BEGIN
  SELECT RAISE(ABORT, 'nba_analysis_history is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_nba_analysis_history_no_delete
BEFORE DELETE ON nba_analysis_history
BEGIN
  SELECT RAISE(ABORT, 'nba_analysis_history is immutable');
END;

CREATE TABLE IF NOT EXISTS nba_analysis_settlements (
  analysis_id TEXT PRIMARY KEY NOT NULL,
  match_id TEXT,
  status TEXT,
  settled_at TEXT NOT NULL,
  result_home_score INTEGER,
  result_away_score INTEGER,
  result_winner TEXT,
  result_margin INTEGER,
  result_total INTEGER,
  motor_was_right INTEGER,
  spread_was_right INTEGER,
  ou_was_right INTEGER,
  ou_model_was_right INTEGER,
  clv_post_match REAL,
  clv_status TEXT,
  clv_method TEXT,
  settlement_source TEXT,
  payload_json TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_nba_settlement_match
  ON nba_analysis_settlements (match_id, settled_at);

CREATE INDEX IF NOT EXISTS idx_nba_settlement_status
  ON nba_analysis_settlements (status, settled_at);
