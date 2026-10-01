-- Mani Bet Pro · NBA engine/versioned analysis identity
-- Enables calibration/backtests to isolate homogeneous engine generations.

ALTER TABLE nba_analysis_history ADD COLUMN engine_version TEXT;
ALTER TABLE nba_analysis_history ADD COLUMN analysis_schema_version TEXT;

CREATE INDEX IF NOT EXISTS idx_nba_analysis_engine_version
  ON nba_analysis_history (engine_version, season_id, analyzed_at);
