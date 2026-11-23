-- Only a final observed for the same teams, kickoff and last published edition qualifies.
-- Material corrections and a subsequently received box score produce a new review key.
CREATE VIEW IF NOT EXISTS learning_current_assessments AS
SELECT h.match_id,p.id AS edition_id,p.tip,f.id AS final_id,
  p.id || ':' || f.id || ':' || CASE WHEN json_extract(b.payload,'$.home_id')=json_extract(f.payload,'$.home.id')
    AND json_extract(b.payload,'$.away_id')=json_extract(f.payload,'$.away.id')
    AND json_extract(b.payload,'$.final_score.home')=json_extract(f.payload,'$.home.score')
    AND json_extract(b.payload,'$.final_score.away')=json_extract(f.payload,'$.away.score') THEN b.id ELSE 0 END AS assessment_key
FROM published_forecast_heads h JOIN published_forecasts p ON p.id=h.edition_id
JOIN published_final_observations f ON f.id=(SELECT o.id FROM published_final_observations o
  WHERE o.match_id=h.match_id AND o.tip=p.tip AND o.kind='FINAL' ORDER BY o.observed_at DESC LIMIT 1)
LEFT JOIN published_final_observations b ON b.id=(SELECT o.id FROM published_final_observations o
  WHERE o.match_id=h.match_id AND o.tip=p.tip AND o.kind='BOX' ORDER BY o.observed_at DESC LIMIT 1)
WHERE CAST(json_extract(p.payload,'$.home.id') AS TEXT)=json_extract(f.payload,'$.home.id')
  AND CAST(json_extract(p.payload,'$.away.id') AS TEXT)=json_extract(f.payload,'$.away.id');

CREATE TABLE IF NOT EXISTS learning_inbox (
  payload TEXT NOT NULL CHECK(json_valid(payload) AND length(CAST(payload AS BLOB)) BETWEEN 2 AND 32768),
  id TEXT GENERATED ALWAYS AS (json_extract(payload,'$.id')) STORED NOT NULL UNIQUE,
  match_id TEXT GENERATED ALWAYS AS (json_extract(payload,'$.match_id')) STORED NOT NULL,
  edition_id INTEGER GENERATED ALWAYS AS (json_extract(payload,'$.edition_id')) STORED NOT NULL,
  assessment_key TEXT GENERATED ALWAYS AS (json_extract(payload,'$.assessment_key')) STORED NOT NULL,
  received_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK(length(id) BETWEEN 3 AND 120 AND id NOT GLOB '*[^a-zA-Z0-9_.-]*')
);
CREATE INDEX IF NOT EXISTS learning_inbox_key ON learning_inbox(match_id,edition_id,assessment_key);
CREATE TABLE IF NOT EXISTS learning_reviews (
  id TEXT PRIMARY KEY REFERENCES learning_inbox(id),
  match_id TEXT NOT NULL,
  edition_id INTEGER NOT NULL REFERENCES published_forecasts(id),
  assessment_key TEXT NOT NULL,
  reviewed_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  UNIQUE(match_id,edition_id,assessment_key)
);
CREATE TABLE IF NOT EXISTS learning_rejections (
  id TEXT PRIMARY KEY REFERENCES learning_inbox(id),
  reason TEXT NOT NULL,
  checked_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER IF NOT EXISTS learning_inbox_clock BEFORE INSERT ON learning_inbox
WHEN NEW.received_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ','now')
BEGIN SELECT RAISE(ABORT,'LEARNING_SERVER_TIME_REQUIRED'); END;
CREATE TRIGGER IF NOT EXISTS learning_inbox_duplicate BEFORE INSERT ON learning_inbox
WHEN EXISTS(SELECT 1 FROM learning_inbox WHERE id=NEW.id AND payload=NEW.payload)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER IF NOT EXISTS learning_inbox_collision BEFORE INSERT ON learning_inbox
WHEN EXISTS(SELECT 1 FROM learning_inbox WHERE id=NEW.id AND payload<>NEW.payload)
 OR EXISTS(SELECT 1 FROM learning_inbox i LEFT JOIN learning_rejections r ON r.id=i.id WHERE i.match_id=NEW.match_id
  AND i.edition_id=NEW.edition_id AND i.assessment_key=NEW.assessment_key AND i.id<>NEW.id AND r.id IS NULL)
BEGIN SELECT RAISE(ABORT,'LEARNING_SUBMISSION_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS learning_inbox_keep BEFORE UPDATE ON learning_inbox BEGIN SELECT RAISE(ABORT,'LEARNING_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS learning_inbox_preserve BEFORE DELETE ON learning_inbox BEGIN SELECT RAISE(ABORT,'LEARNING_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS learning_reviews_guard BEFORE INSERT ON learning_reviews
WHEN NEW.reviewed_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ','now') OR EXISTS(SELECT 1 FROM learning_reviews
 WHERE id=NEW.id OR (match_id=NEW.match_id AND edition_id=NEW.edition_id AND assessment_key=NEW.assessment_key))
 OR NOT EXISTS(SELECT 1 FROM learning_inbox i JOIN learning_current_assessments c
  ON c.match_id=i.match_id AND c.edition_id=i.edition_id AND c.assessment_key=i.assessment_key
  WHERE i.id=NEW.id AND c.match_id=NEW.match_id AND c.edition_id=NEW.edition_id AND c.assessment_key=NEW.assessment_key)
BEGIN SELECT RAISE(ABORT,'LEARNING_REVIEW_NOT_CURRENT'); END;
CREATE TRIGGER IF NOT EXISTS learning_reviews_keep BEFORE UPDATE ON learning_reviews BEGIN SELECT RAISE(ABORT,'LEARNING_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS learning_reviews_preserve BEFORE DELETE ON learning_reviews BEGIN SELECT RAISE(ABORT,'LEARNING_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS learning_rejections_repeat BEFORE INSERT ON learning_rejections
WHEN EXISTS(SELECT 1 FROM learning_rejections WHERE id=NEW.id) BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER IF NOT EXISTS learning_rejections_clock BEFORE INSERT ON learning_rejections
WHEN NEW.checked_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ','now') BEGIN SELECT RAISE(ABORT,'LEARNING_SERVER_TIME_REQUIRED'); END;
CREATE TRIGGER IF NOT EXISTS learning_rejections_keep BEFORE UPDATE ON learning_rejections BEGIN SELECT RAISE(ABORT,'LEARNING_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS learning_rejections_preserve BEFORE DELETE ON learning_rejections BEGIN SELECT RAISE(ABORT,'LEARNING_IMMUTABLE'); END;
