-- One six-hour pregame window per scheduled fixture, shared across cron and bootstrap.
CREATE TABLE IF NOT EXISTS player_odds_windows (
  match_id TEXT NOT NULL, tip TEXT NOT NULL, edition_id INTEGER NOT NULL REFERENCES published_forecasts(id),
  created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  status TEXT NOT NULL DEFAULT 'OPEN', mode TEXT NOT NULL DEFAULT 'AWAITING_INDEX',
  generation INTEGER NOT NULL DEFAULT 0, sent_generation INTEGER NOT NULL DEFAULT -1,
  lease TEXT, lease_until TEXT, index_status TEXT, index_url TEXT, index_at TEXT, index_json TEXT,
  PRIMARY KEY(match_id,tip), CHECK(created_at<tip)
);
CREATE TABLE IF NOT EXISTS player_odds_tasks (
  match_id TEXT NOT NULL, tip TEXT NOT NULL, player_id TEXT NOT NULL, team_id TEXT NOT NULL, player_name TEXT NOT NULL,
  ranking INTEGER NOT NULL, planned INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'PROJECTED',
  started_at TEXT, observed_at TEXT, recorded_at TEXT, source_url TEXT, staged_quotes TEXT, edition_id INTEGER,
  PRIMARY KEY(match_id,tip,player_id), FOREIGN KEY(match_id,tip) REFERENCES player_odds_windows(match_id,tip),
  CHECK(started_at IS NULL OR started_at<tip)
);
CREATE INDEX IF NOT EXISTS player_odds_task_work ON player_odds_tasks(match_id,tip,status,ranking);
CREATE TABLE IF NOT EXISTS player_odds_source_gate (
  id INTEGER PRIMARY KEY CHECK(id=1), token TEXT, next_at TEXT, backoff_until TEXT
);
INSERT OR IGNORE INTO player_odds_source_gate(id) VALUES(1);

-- Immutable before-image of the verified v25 pre-HTTP transport incident.
CREATE TABLE IF NOT EXISTS player_odds_transport_repairs (
  fix TEXT NOT NULL CHECK(fix='v25-workerd-redirect-error'),
  match_id TEXT NOT NULL, tip TEXT NOT NULL, token TEXT NOT NULL,
  captured_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  window_json TEXT NOT NULL CHECK(json_valid(window_json)),
  tasks_json TEXT NOT NULL CHECK(json_type(tasks_json)='array'),
  PRIMARY KEY(fix,match_id,tip), FOREIGN KEY(match_id,tip) REFERENCES player_odds_windows(match_id,tip)
);
CREATE TRIGGER IF NOT EXISTS player_odds_repair_clock BEFORE INSERT ON player_odds_transport_repairs
WHEN NEW.captured_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NEW.captured_at>=NEW.tip
BEGIN SELECT RAISE(ABORT,'INVALID_PLAYER_ODDS_REPAIR_TIME'); END;
CREATE TRIGGER IF NOT EXISTS player_odds_repair_first BEFORE INSERT ON player_odds_transport_repairs
WHEN EXISTS(SELECT 1 FROM player_odds_transport_repairs WHERE match_id=NEW.match_id AND tip=NEW.tip AND fix=NEW.fix)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER IF NOT EXISTS player_odds_repair_keep BEFORE UPDATE ON player_odds_transport_repairs
BEGIN SELECT RAISE(ABORT,'PLAYER_ODDS_REPAIR_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS player_odds_repair_preserve BEFORE DELETE ON player_odds_transport_repairs
BEGIN SELECT RAISE(ABORT,'PLAYER_ODDS_REPAIR_IMMUTABLE'); END;
