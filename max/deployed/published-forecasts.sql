-- The pregame card is sealed in D1 before it can be served. No historical backfill.
CREATE TABLE IF NOT EXISTS published_forecasts (
  id INTEGER PRIMARY KEY,
  match_id TEXT NOT NULL CHECK(length(match_id) BETWEEN 5 AND 15 AND match_id NOT GLOB '*[^0-9]*'),
  tip TEXT NOT NULL,
  as_of TEXT NOT NULL,
  published_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64 AND content_hash NOT GLOB '*[^a-f0-9]*'),
  payload TEXT NOT NULL CHECK(json_valid(payload) AND json_type(payload)='object'),
  CHECK(CAST(json_extract(payload,'$.id') AS TEXT) IS match_id),
  CHECK(json_extract(payload,'$.status') IS 'STATUS_SCHEDULED'),
  CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',json_extract(payload,'$.start')) IS tip),
  CHECK(as_of IS strftime('%Y-%m-%dT%H:%M:%fZ',as_of) AND as_of<=published_at AND published_at<tip),
  UNIQUE(match_id,as_of)
);
CREATE INDEX IF NOT EXISTS published_forecasts_by_game ON published_forecasts(match_id,id DESC);

-- Reobserving the same card advances the watermark even when no new edition is needed.
CREATE TABLE IF NOT EXISTS published_forecast_heads (
  match_id TEXT PRIMARY KEY,
  edition_id INTEGER NOT NULL UNIQUE REFERENCES published_forecasts(id),
  latest_as_of TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS published_forecasts_clock BEFORE INSERT ON published_forecasts
WHEN NEW.published_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ','now')
BEGIN SELECT RAISE(ABORT,'PUBLICATION_SERVER_TIME_REQUIRED'); END;
CREATE TRIGGER IF NOT EXISTS published_forecasts_immutable_update BEFORE UPDATE ON published_forecasts
BEGIN SELECT RAISE(ABORT,'PUBLICATION_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS published_forecasts_immutable_delete BEFORE DELETE ON published_forecasts
BEGIN SELECT RAISE(ABORT,'PUBLICATION_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS published_forecasts_no_replace BEFORE INSERT ON published_forecasts
WHEN EXISTS(SELECT 1 FROM published_forecasts WHERE id=NEW.id OR (match_id=NEW.match_id AND as_of=NEW.as_of))
BEGIN SELECT RAISE(ABORT,'PUBLICATION_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS published_forecasts_forward BEFORE INSERT ON published_forecasts
WHEN EXISTS(SELECT 1 FROM published_forecast_heads h JOIN published_forecasts p ON p.id=h.edition_id
  WHERE h.match_id=NEW.match_id AND (h.latest_as_of>=NEW.as_of OR (p.content_hash=NEW.content_hash AND p.tip=NEW.tip)))
BEGIN SELECT RAISE(ABORT,'DUPLICATE_OR_STALE_PUBLICATION'); END;
CREATE TRIGGER IF NOT EXISTS published_forecasts_set_head AFTER INSERT ON published_forecasts
BEGIN
  INSERT INTO published_forecast_heads(match_id,edition_id,latest_as_of) VALUES(NEW.match_id,NEW.id,NEW.as_of)
  ON CONFLICT(match_id) DO UPDATE SET edition_id=excluded.edition_id,latest_as_of=excluded.latest_as_of;
END;
