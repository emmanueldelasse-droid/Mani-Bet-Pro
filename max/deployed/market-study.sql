-- Install after research-journal.sql. The first installation is the prospective start.
CREATE TABLE IF NOT EXISTS market_study_rules (
  rule_id TEXT PRIMARY KEY, activated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO market_study_rules(rule_id) VALUES('winamax-moneyline-ot-primary-v1')
  ON CONFLICT(rule_id) DO NOTHING;
CREATE TRIGGER IF NOT EXISTS market_rules_no_update BEFORE UPDATE ON market_study_rules
BEGIN SELECT RAISE(ABORT,'MARKET_RULE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS market_rules_no_delete BEFORE DELETE ON market_study_rules
BEGIN SELECT RAISE(ABORT,'MARKET_RULE_IMMUTABLE'); END;

CREATE TABLE IF NOT EXISTS market_study_decisions (
  match_id TEXT NOT NULL, rule_id TEXT NOT NULL REFERENCES market_study_rules(rule_id),
  version_id INTEGER NOT NULL REFERENCES max_forecast_versions(id),
  tip TEXT NOT NULL, cutoff TEXT NOT NULL, decided_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(match_id, rule_id),
  CHECK(cutoff <= decided_at AND decided_at < tip),
  CHECK(json_extract(payload,'$.gameId') IS match_id AND json_extract(payload,'$.ruleId') IS rule_id
    AND json_extract(payload,'$.decidedAt') IS decided_at AND json_extract(payload,'$.forecastVersionId') IS version_id
    AND json_extract(payload,'$.simulationOnly') IS 1)
);
CREATE TRIGGER IF NOT EXISTS market_decisions_server_time BEFORE INSERT ON market_study_decisions
WHEN NEW.decided_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ','now')
BEGIN SELECT RAISE(ABORT,'MARKET_DECISION_SERVER_TIME_REQUIRED'); END;
CREATE TRIGGER IF NOT EXISTS market_decisions_no_update BEFORE UPDATE ON market_study_decisions
BEGIN SELECT RAISE(ABORT,'MARKET_DECISION_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS market_decisions_no_delete BEFORE DELETE ON market_study_decisions
BEGIN SELECT RAISE(ABORT,'MARKET_DECISION_IMMUTABLE'); END;

CREATE TABLE IF NOT EXISTS market_study_finals (
  id INTEGER PRIMARY KEY, match_id TEXT NOT NULL, rule_id TEXT NOT NULL,
  observed_at TEXT NOT NULL, settled_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  home_score INTEGER NOT NULL CHECK(home_score >= 0), away_score INTEGER NOT NULL CHECK(away_score >= 0),
  source_url TEXT NOT NULL, CHECK(home_score <> away_score AND observed_at <= settled_at),
  FOREIGN KEY(match_id,rule_id) REFERENCES market_study_decisions(match_id,rule_id)
);
CREATE INDEX IF NOT EXISTS market_final_game ON market_study_finals(match_id,rule_id,id);
CREATE TRIGGER IF NOT EXISTS market_finals_no_update BEFORE UPDATE ON market_study_finals
BEGIN SELECT RAISE(ABORT,'MARKET_FINAL_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS market_finals_no_delete BEFORE DELETE ON market_study_finals
BEGIN SELECT RAISE(ABORT,'MARKET_FINAL_IMMUTABLE'); END;
-- In SQLite, REPLACE may skip delete triggers. Preserve the first freeze even on a replay.
CREATE TRIGGER IF NOT EXISTS market_rules_keep_first BEFORE INSERT ON market_study_rules
WHEN EXISTS (SELECT 1 FROM market_study_rules WHERE rule_id=NEW.rule_id)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER IF NOT EXISTS market_decisions_keep_first BEFORE INSERT ON market_study_decisions
WHEN EXISTS (SELECT 1 FROM market_study_decisions WHERE match_id=NEW.match_id AND rule_id=NEW.rule_id)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER IF NOT EXISTS market_finals_keep_history BEFORE INSERT ON market_study_finals
WHEN EXISTS (SELECT 1 FROM market_study_finals WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'MARKET_FINAL_IMMUTABLE'); END;
