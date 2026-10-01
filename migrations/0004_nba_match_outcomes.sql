-- Mani Bet Pro · canonical NBA match outcomes
--
-- One official result/closing snapshot per match_id.
-- Every immutable checkpoint analysis can join this table through match_id,
-- avoiding the false assumption that the latest KV analysis represents H6/H4/H2/H1.

CREATE TABLE IF NOT EXISTS nba_match_outcomes (
  match_id TEXT PRIMARY KEY NOT NULL,
  season_id TEXT,
  event_type TEXT,
  season_type INTEGER,
  nba_phase TEXT,
  game_datetime TEXT,
  status TEXT,
  settled_at TEXT NOT NULL,
  result_home_score INTEGER,
  result_away_score INTEGER,
  result_winner TEXT,
  result_margin INTEGER,
  result_total INTEGER,
  live_status TEXT,
  settlement_source TEXT,
  result_fetch_latency INTEGER,
  closing_snapshot_at TEXT,
  closing_snapshot_age_minutes REAL,
  closing_source TEXT,
  closing_provider_name TEXT,
  closing_home_ml INTEGER,
  closing_away_ml INTEGER,
  payload_json TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_nba_match_outcomes_season
  ON nba_match_outcomes (season_id, settled_at);

CREATE INDEX IF NOT EXISTS idx_nba_match_outcomes_status
  ON nba_match_outcomes (status, settled_at);
