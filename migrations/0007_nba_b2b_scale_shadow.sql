-- Mani Bet Pro · NBA back-to-back scale parity shadow
-- Observation only: compares backend ±0.6 with frontend ±1 counterfactual.

ALTER TABLE nba_analysis_history ADD COLUMN b2b_backend_value REAL;
ALTER TABLE nba_analysis_history ADD COLUMN b2b_frontend_scale_shadow REAL;
ALTER TABLE nba_analysis_history ADD COLUMN b2b_weighted_score_current REAL;
ALTER TABLE nba_analysis_history ADD COLUMN b2b_weighted_score_shadow REAL;
ALTER TABLE nba_analysis_history ADD COLUMN b2b_score_delta REAL;
