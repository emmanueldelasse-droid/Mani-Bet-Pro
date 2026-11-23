-- Stage the complete observations before sending any fan-out message.
CREATE TABLE IF NOT EXISTS odds_intake (
  id TEXT PRIMARY KEY CHECK(length(id)=64 AND id NOT GLOB '*[^a-f0-9]*'),
  edition_id INTEGER NOT NULL REFERENCES published_forecasts(id), match_id TEXT NOT NULL, tip TEXT NOT NULL,
  source TEXT NOT NULL, observed_from TEXT NOT NULL, observed_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  quotes_json TEXT NOT NULL CHECK(json_valid(quotes_json) AND json_array_length(quotes_json)>0),
  status TEXT NOT NULL DEFAULT 'STAGED' CHECK(status IN ('STAGED','WORKING','RETRY','SEALED','ISSUE','EXPIRED')),
  attempts INTEGER NOT NULL DEFAULT 0, ticket TEXT, available_at TEXT, reason TEXT, receipt_json TEXT,
  CHECK(observed_from<=observed_at AND observed_at<tip AND received_at<tip)
);
CREATE INDEX IF NOT EXISTS odds_intake_pending ON odds_intake(status,available_at,tip);
CREATE TABLE IF NOT EXISTS odds_intake_history (
  seq INTEGER PRIMARY KEY, intake_id TEXT NOT NULL REFERENCES odds_intake(id), attempt INTEGER NOT NULL,
  at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),status TEXT NOT NULL, reason TEXT, receipt_json TEXT
);
CREATE INDEX IF NOT EXISTS odds_intake_history_by_id ON odds_intake_history(intake_id,seq);
CREATE TRIGGER IF NOT EXISTS odds_intake_check_insert BEFORE INSERT ON odds_intake
WHEN NEW.received_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NEW.status<>'STAGED' OR NEW.attempts<>0
 OR NOT EXISTS(SELECT 1 FROM published_forecasts p WHERE p.id=NEW.edition_id AND p.match_id=NEW.match_id AND p.tip=NEW.tip AND p.published_at<=NEW.received_at)
BEGIN SELECT RAISE(ABORT,'INVALID_ODDS_INTAKE'); END;
CREATE TRIGGER IF NOT EXISTS odds_intake_first BEFORE INSERT ON odds_intake
WHEN EXISTS(SELECT 1 FROM odds_intake WHERE id=NEW.id)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER IF NOT EXISTS odds_intake_keep BEFORE UPDATE ON odds_intake
WHEN OLD.id IS NOT NEW.id OR OLD.edition_id IS NOT NEW.edition_id OR OLD.match_id IS NOT NEW.match_id OR OLD.tip IS NOT NEW.tip
 OR OLD.source IS NOT NEW.source OR OLD.observed_from IS NOT NEW.observed_from OR OLD.observed_at IS NOT NEW.observed_at
 OR OLD.received_at IS NOT NEW.received_at OR OLD.quotes_json IS NOT NEW.quotes_json OR OLD.status IN ('SEALED','EXPIRED')
BEGIN SELECT RAISE(ABORT,'ODDS_INTAKE_FROZEN'); END;
CREATE TRIGGER IF NOT EXISTS odds_intake_preserve BEFORE DELETE ON odds_intake BEGIN SELECT RAISE(ABORT,'ODDS_INTAKE_FROZEN'); END;
CREATE TRIGGER IF NOT EXISTS odds_intake_audit_insert AFTER INSERT ON odds_intake BEGIN
  INSERT INTO odds_intake_history(intake_id,attempt,status) VALUES(NEW.id,NEW.attempts,NEW.status);
END;
CREATE TRIGGER IF NOT EXISTS odds_intake_audit_change AFTER UPDATE ON odds_intake BEGIN
  INSERT INTO odds_intake_history(intake_id,attempt,status,reason,receipt_json) VALUES(NEW.id,NEW.attempts,NEW.status,NEW.reason,NEW.receipt_json);
END;
CREATE TRIGGER IF NOT EXISTS odds_intake_audit_duplicate BEFORE INSERT ON odds_intake_history
WHEN EXISTS(SELECT 1 FROM odds_intake_history WHERE seq=NEW.seq) BEGIN SELECT RAISE(ABORT,'ODDS_INTAKE_AUDIT_FROZEN'); END;
CREATE TRIGGER IF NOT EXISTS odds_intake_audit_keep BEFORE UPDATE ON odds_intake_history BEGIN SELECT RAISE(ABORT,'ODDS_INTAKE_AUDIT_FROZEN'); END;
CREATE TRIGGER IF NOT EXISTS odds_intake_audit_preserve BEFORE DELETE ON odds_intake_history BEGIN SELECT RAISE(ABORT,'ODDS_INTAKE_AUDIT_FROZEN'); END;
