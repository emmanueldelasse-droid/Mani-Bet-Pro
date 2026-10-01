-- Mani Bet Pro · weighted data-quality decision shadow
-- Observation only: current data_quality gate remains legacy coverage at threshold 0.55.

ALTER TABLE nba_analysis_history ADD COLUMN dq_weighted_confidence_shadow TEXT;
ALTER TABLE nba_analysis_history ADD COLUMN dq_weighted_below_gate INTEGER;
ALTER TABLE nba_analysis_history ADD COLUMN dq_gate_would_change INTEGER;
ALTER TABLE nba_analysis_history ADD COLUMN dq_confidence_would_change INTEGER;

CREATE INDEX IF NOT EXISTS idx_nba_analysis_dq_shadow_gate
  ON nba_analysis_history (dq_gate_would_change, season_id, analyzed_at);
