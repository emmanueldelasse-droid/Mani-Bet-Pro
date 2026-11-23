-- Prospective, observed sportsbook prices only. Historical Winamax trades keep their separate rule.
CREATE TABLE IF NOT EXISTS odds_study_rules (
  id TEXT PRIMARY KEY, activated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT OR IGNORE INTO odds_study_rules(id) VALUES ('published-sportsbook-markets-v1');
CREATE TRIGGER IF NOT EXISTS odds_rule_frozen_u BEFORE UPDATE ON odds_study_rules BEGIN SELECT RAISE(ABORT,'ODDS_RULE_FROZEN'); END;
CREATE TRIGGER IF NOT EXISTS odds_rule_frozen_d BEFORE DELETE ON odds_study_rules BEGIN SELECT RAISE(ABORT,'ODDS_RULE_FROZEN'); END;
CREATE TRIGGER IF NOT EXISTS odds_rule_frozen_r BEFORE INSERT ON odds_study_rules
WHEN EXISTS(SELECT 1 FROM odds_study_rules WHERE id=NEW.id) BEGIN SELECT RAISE(IGNORE); END;

CREATE TABLE IF NOT EXISTS odds_study_quotes (
  id INTEGER PRIMARY KEY, rule_id TEXT NOT NULL REFERENCES odds_study_rules(id),
  edition_id INTEGER NOT NULL REFERENCES published_forecasts(id), match_id TEXT NOT NULL,
  bookmaker TEXT NOT NULL, market TEXT NOT NULL, subject TEXT NOT NULL, group_key TEXT NOT NULL,
  observed_at TEXT NOT NULL, received_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  side TEXT NOT NULL, decimal_odds REAL NOT NULL CHECK(decimal_odds>1), payload TEXT NOT NULL CHECK(json_valid(payload)),
  UNIQUE(rule_id,match_id,bookmaker,market,subject,group_key,observed_at,side,decimal_odds,payload)
);
CREATE INDEX IF NOT EXISTS odds_quote_match ON odds_study_quotes(match_id,observed_at);
CREATE TABLE IF NOT EXISTS odds_study_decisions (
  id INTEGER PRIMARY KEY, rule_id TEXT NOT NULL REFERENCES odds_study_rules(id),
  edition_id INTEGER NOT NULL REFERENCES published_forecasts(id), match_id TEXT NOT NULL,
  bookmaker TEXT NOT NULL, market TEXT NOT NULL, subject TEXT NOT NULL, quote_id INTEGER REFERENCES odds_study_quotes(id),
  decided_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')), payload TEXT NOT NULL CHECK(json_valid(payload)),
  UNIQUE(rule_id,match_id,bookmaker,market,subject)
);
CREATE TABLE IF NOT EXISTS odds_study_settlements (
  id INTEGER PRIMARY KEY, decision_id INTEGER NOT NULL REFERENCES odds_study_decisions(id),
  observed_at TEXT NOT NULL, settled_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  status TEXT NOT NULL CHECK(status IN('WON','LOST','PUSH','VOID','UNSETTLEABLE')), actual REAL, net_units REAL,
  source_url TEXT NOT NULL, UNIQUE(decision_id,observed_at), CHECK(observed_at<=settled_at)
);
CREATE TRIGGER IF NOT EXISTS odds_quote_frozen_u BEFORE UPDATE ON odds_study_quotes BEGIN SELECT RAISE(ABORT,'ODDS_QUOTE_FROZEN'); END;
CREATE TRIGGER IF NOT EXISTS odds_quote_frozen_d BEFORE DELETE ON odds_study_quotes BEGIN SELECT RAISE(ABORT,'ODDS_QUOTE_FROZEN'); END;
CREATE TRIGGER IF NOT EXISTS odds_decision_frozen_u BEFORE UPDATE ON odds_study_decisions BEGIN SELECT RAISE(ABORT,'ODDS_DECISION_FROZEN'); END;
CREATE TRIGGER IF NOT EXISTS odds_decision_frozen_d BEFORE DELETE ON odds_study_decisions BEGIN SELECT RAISE(ABORT,'ODDS_DECISION_FROZEN'); END;
CREATE TRIGGER IF NOT EXISTS odds_settlement_frozen_u BEFORE UPDATE ON odds_study_settlements BEGIN SELECT RAISE(ABORT,'ODDS_RESULT_FROZEN'); END;
CREATE TRIGGER IF NOT EXISTS odds_settlement_frozen_d BEFORE DELETE ON odds_study_settlements BEGIN SELECT RAISE(ABORT,'ODDS_RESULT_FROZEN'); END;

CREATE TRIGGER IF NOT EXISTS odds_quote_clock BEFORE INSERT ON odds_study_quotes
WHEN NEW.received_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS (
 SELECT 1 FROM published_forecasts p JOIN odds_study_rules r ON r.id=NEW.rule_id WHERE p.id=NEW.edition_id
 AND p.match_id=NEW.match_id AND r.activated_at<=NEW.observed_at AND p.published_at<=NEW.received_at
 AND NEW.observed_at<=NEW.received_at AND NEW.received_at<p.tip)
BEGIN SELECT RAISE(ABORT,'ODDS_CLOCK_OR_EDITION'); END;
CREATE TRIGGER IF NOT EXISTS odds_decision_clock BEFORE INSERT ON odds_study_decisions
WHEN NEW.decided_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS (
 SELECT 1 FROM published_forecasts p JOIN odds_study_rules r ON r.id=NEW.rule_id WHERE p.id=NEW.edition_id
 AND p.match_id=NEW.match_id AND r.activated_at<=p.published_at AND p.published_at<=NEW.decided_at AND NEW.decided_at<p.tip)
 OR (json_extract(NEW.payload,'$.selected')=1 AND NOT EXISTS (SELECT 1 FROM odds_study_quotes q WHERE q.id=NEW.quote_id
 AND q.match_id=NEW.match_id AND q.rule_id=NEW.rule_id AND q.market=NEW.market AND q.subject=NEW.subject AND q.bookmaker=NEW.bookmaker
 AND q.received_at<=NEW.decided_at AND q.decimal_odds=json_extract(NEW.payload,'$.decimal_odds')
 AND q.side=json_extract(NEW.payload,'$.side')))
BEGIN SELECT RAISE(ABORT,'ODDS_DECISION_CLOCK_OR_QUOTE'); END;
CREATE TRIGGER IF NOT EXISTS odds_settlement_clock BEFORE INSERT ON odds_study_settlements
WHEN NEW.settled_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS (
 SELECT 1 FROM odds_study_decisions d JOIN published_forecasts p ON p.id=d.edition_id
 WHERE d.id=NEW.decision_id AND p.tip<NEW.observed_at AND NEW.observed_at<=NEW.settled_at)
BEGIN SELECT RAISE(ABORT,'ODDS_RESULT_CLOCK'); END;
CREATE TRIGGER IF NOT EXISTS odds_quote_keep_id BEFORE INSERT ON odds_study_quotes
WHEN EXISTS(SELECT 1 FROM odds_study_quotes WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'ODDS_QUOTE_FROZEN'); END;
CREATE TRIGGER IF NOT EXISTS odds_quote_first BEFORE INSERT ON odds_study_quotes
WHEN EXISTS(SELECT 1 FROM odds_study_quotes WHERE rule_id=NEW.rule_id AND match_id=NEW.match_id AND bookmaker=NEW.bookmaker
 AND market=NEW.market AND subject=NEW.subject AND group_key=NEW.group_key AND observed_at=NEW.observed_at AND side=NEW.side AND payload=NEW.payload)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER IF NOT EXISTS odds_decision_first BEFORE INSERT ON odds_study_decisions
WHEN EXISTS(SELECT 1 FROM odds_study_decisions WHERE id=NEW.id OR (rule_id=NEW.rule_id AND match_id=NEW.match_id
 AND bookmaker=NEW.bookmaker AND market=NEW.market AND subject=NEW.subject)) BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER IF NOT EXISTS odds_settlement_first BEFORE INSERT ON odds_study_settlements
WHEN EXISTS(SELECT 1 FROM odds_study_settlements WHERE id=NEW.id OR (decision_id=NEW.decision_id AND observed_at=NEW.observed_at))
BEGIN SELECT RAISE(IGNORE); END;

-- Immutable prospective parameters, including the declared odds bands. A changed rule needs a new ID.
CREATE TABLE IF NOT EXISTS odds_study_protocols (
  rule_id TEXT PRIMARY KEY REFERENCES odds_study_rules(id), parameters TEXT NOT NULL CHECK(json_valid(parameters)),
  frozen_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER IF NOT EXISTS odds_parameters_first BEFORE INSERT ON odds_study_protocols
WHEN EXISTS(SELECT 1 FROM odds_study_protocols WHERE rule_id=NEW.rule_id) BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER IF NOT EXISTS odds_parameters_keep_u BEFORE UPDATE ON odds_study_protocols BEGIN SELECT RAISE(ABORT,'ODDS_RULE_FROZEN'); END;
CREATE TRIGGER IF NOT EXISTS odds_parameters_keep_d BEFORE DELETE ON odds_study_protocols BEGIN SELECT RAISE(ABORT,'ODDS_RULE_FROZEN'); END;
INSERT OR IGNORE INTO odds_study_protocols(rule_id,parameters) VALUES ('published-sportsbook-markets-v1','{"rule":{"id":"published-sportsbook-markets-v1","stake_units":1,"max_quote_age_minutes":60,"window_minutes":360,"min_odds":1,"band_min_dates":30,"band_min_settled":50,"band_min_wins_and_losses":5,"min_moneyline_return":0.05,"total_edge":3,"spread_edge":2,"player_edge":2,"simulation_only":true,"description":"Premier relevé complet et récent de chaque bookmaker dans les six heures avant le match. Une unité virtuelle. Vainqueur prévu si probabilité × cote ≥ 1,05. Pour un total, un handicap ou les points d’un joueur, il faut respectivement 3, 2 ou 2 points d’écart avec la ligne. Une seule décision par match, bookmaker, marché et joueur. Prolongations incluses."},"bands":[{"id":"1-1.5","label":"1,00 à moins de 1,50","min":1,"max":1.5},{"id":"1.5-2","label":"1,50 à moins de 2,00","min":1.5,"max":2},{"id":"2-3","label":"2,00 à moins de 3,00","min":2,"max":3},{"id":"3+","label":"3,00 et plus","min":3,"max":null}]}');

-- Preserve both failed and successful direct-site observations, including a technical retry.
CREATE TABLE IF NOT EXISTS odds_first_party_checks(
 checked_at TEXT PRIMARY KEY, retry_of TEXT UNIQUE REFERENCES odds_first_party_checks(checked_at), payload TEXT NOT NULL CHECK(json_valid(payload))
);
CREATE TRIGGER IF NOT EXISTS odds_board_keep_u BEFORE UPDATE ON odds_first_party_checks BEGIN SELECT RAISE(ABORT,'ODDS_OBSERVATION_FROZEN'); END;
CREATE TRIGGER IF NOT EXISTS odds_board_keep_d BEFORE DELETE ON odds_first_party_checks BEGIN SELECT RAISE(ABORT,'ODDS_OBSERVATION_FROZEN'); END;
