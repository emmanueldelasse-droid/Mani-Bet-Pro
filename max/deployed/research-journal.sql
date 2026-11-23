-- Worker Max only. The producer supplies report_json as its sole input.
CREATE TABLE IF NOT EXISTS macfly_inbox (
  id INTEGER PRIMARY KEY,
  report_json TEXT NOT NULL CHECK (json_valid(report_json) AND length(report_json) <= 250000),
  match_id TEXT GENERATED ALWAYS AS (CAST(json_extract(report_json, '$.match_id') AS TEXT)) STORED NOT NULL,
  generated_at TEXT GENERATED ALWAYS AS (strftime('%Y-%m-%dT%H:%M:%fZ', json_extract(report_json, '$.generated_at'))) STORED NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (match_id, generated_at),
  CHECK (length(match_id) BETWEEN 5 AND 15 AND match_id NOT GLOB '*[^0-9]*'),
  CHECK (json_extract(report_json, '$.schema_version') IS 'max-research-v1')
);
CREATE TRIGGER IF NOT EXISTS macfly_inbox_collision BEFORE INSERT ON macfly_inbox
WHEN EXISTS (SELECT 1 FROM macfly_inbox WHERE match_id=NEW.match_id AND generated_at=NEW.generated_at AND report_json!=NEW.report_json)
BEGIN SELECT RAISE(ABORT, 'MACFLY_ID_CONTENT_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS macfly_inbox_same_delivery BEFORE INSERT ON macfly_inbox
WHEN EXISTS (SELECT 1 FROM macfly_inbox WHERE match_id=NEW.match_id AND generated_at=NEW.generated_at AND report_json=NEW.report_json)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER IF NOT EXISTS macfly_inbox_server_time BEFORE INSERT ON macfly_inbox
WHEN NEW.received_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
BEGIN SELECT RAISE(ABORT, 'MACFLY_SERVER_TIME_REQUIRED'); END;
CREATE TRIGGER IF NOT EXISTS macfly_inbox_no_update BEFORE UPDATE ON macfly_inbox
BEGIN SELECT RAISE(ABORT, 'MACFLY_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS macfly_inbox_no_delete BEFORE DELETE ON macfly_inbox
BEGIN SELECT RAISE(ABORT, 'MACFLY_IMMUTABLE'); END;
CREATE TABLE IF NOT EXISTS max_forecast_versions (
  id INTEGER PRIMARY KEY,
  match_id TEXT NOT NULL,
  as_of TEXT NOT NULL,
  tip TEXT NOT NULL,
  integrated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  UNIQUE (match_id, as_of),
  CHECK (as_of <= integrated_at AND integrated_at < tip)
);
CREATE TRIGGER IF NOT EXISTS max_forecast_versions_no_update BEFORE UPDATE ON max_forecast_versions
BEGIN SELECT RAISE(ABORT, 'FORECAST_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS max_forecast_versions_no_delete BEFORE DELETE ON max_forecast_versions
BEGIN SELECT RAISE(ABORT, 'FORECAST_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS max_forecast_version_duplicate BEFORE INSERT ON max_forecast_versions
WHEN EXISTS (SELECT 1 FROM max_forecast_versions WHERE match_id=NEW.match_id AND as_of=NEW.as_of)
BEGIN SELECT RAISE(IGNORE); END;
