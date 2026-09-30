-- Mani Bet Pro · NBA verified closing quote metadata

ALTER TABLE nba_analysis_settlements ADD COLUMN closing_snapshot_at TEXT;
ALTER TABLE nba_analysis_settlements ADD COLUMN closing_snapshot_age_minutes REAL;
ALTER TABLE nba_analysis_settlements ADD COLUMN closing_source TEXT;
ALTER TABLE nba_analysis_settlements ADD COLUMN closing_provider_name TEXT;
ALTER TABLE nba_analysis_settlements ADD COLUMN closing_home_ml INTEGER;
ALTER TABLE nba_analysis_settlements ADD COLUMN closing_away_ml INTEGER;

CREATE INDEX IF NOT EXISTS idx_nba_settlement_clv_status
  ON nba_analysis_settlements (clv_status, settled_at);
