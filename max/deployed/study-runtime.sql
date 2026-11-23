CREATE TABLE IF NOT EXISTS study_context (
  match_id TEXT PRIMARY KEY, source_at TEXT NOT NULL, tip TEXT NOT NULL, context TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS study_results (
  match_id TEXT PRIMARY KEY, tip TEXT NOT NULL, box_available INTEGER NOT NULL, result TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS study_display (
  match_id TEXT PRIMARY KEY, version_id INTEGER NOT NULL, card TEXT NOT NULL, report TEXT
);
