-- Mani Bet Pro · NBA recent-form EMA shadow observability
-- Observation only: does not drive prediction or decision.

ALTER TABLE nba_analysis_history ADD COLUMN recent_form_ema_legacy REAL;
ALTER TABLE nba_analysis_history ADD COLUMN recent_form_ema_decay_shadow REAL;
ALTER TABLE nba_analysis_history ADD COLUMN recent_form_ema_shadow_delta REAL;
ALTER TABLE nba_analysis_history ADD COLUMN recent_form_ema_lambda REAL;
