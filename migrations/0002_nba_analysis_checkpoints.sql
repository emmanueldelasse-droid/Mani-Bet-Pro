-- Mani Bet Pro · NBA analysis checkpoints
-- Queryable checkpoint metadata for immutable history.

ALTER TABLE nba_analysis_history ADD COLUMN checkpoint_id TEXT;
ALTER TABLE nba_analysis_history ADD COLUMN checkpoint_minutes_to_tip INTEGER;

CREATE INDEX IF NOT EXISTS idx_nba_analysis_checkpoint
  ON nba_analysis_history (season_id, checkpoint_id, analyzed_at);
