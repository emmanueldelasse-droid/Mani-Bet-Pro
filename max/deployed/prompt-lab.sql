-- MacFly sends one exact proposal document. Client timestamps cannot activate an experiment.
CREATE TABLE IF NOT EXISTS prompt_lab_inbox (
  payload TEXT NOT NULL CHECK(json_valid(payload) AND length(CAST(payload AS BLOB)) BETWEEN 2 AND 98304),
  id TEXT GENERATED ALWAYS AS (json_extract(payload,'$.id')) STORED NOT NULL UNIQUE,
  received_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK(length(id) BETWEEN 3 AND 96 AND id NOT GLOB '*[^a-zA-Z0-9._-]*')
);
CREATE TRIGGER IF NOT EXISTS prompt_lab_inbox_server BEFORE INSERT ON prompt_lab_inbox
WHEN NEW.received_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ','now')
BEGIN SELECT RAISE(ABORT,'PROMPT_TIME_SERVER'); END;
CREATE TRIGGER IF NOT EXISTS prompt_lab_inbox_conflict BEFORE INSERT ON prompt_lab_inbox
WHEN EXISTS(SELECT 1 FROM prompt_lab_inbox WHERE id=NEW.id AND payload<>NEW.payload)
BEGIN SELECT RAISE(ABORT,'PROMPT_ID_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS prompt_lab_inbox_repeat BEFORE INSERT ON prompt_lab_inbox
WHEN EXISTS(SELECT 1 FROM prompt_lab_inbox WHERE id=NEW.id AND payload=NEW.payload)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER IF NOT EXISTS prompt_lab_inbox_immutable BEFORE UPDATE ON prompt_lab_inbox
BEGIN SELECT RAISE(ABORT,'PROMPT_INBOX_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS prompt_lab_inbox_preserve BEFORE DELETE ON prompt_lab_inbox
BEGIN SELECT RAISE(ABORT,'PROMPT_INBOX_IMMUTABLE'); END;

CREATE TABLE IF NOT EXISTS prompt_lab_experiments (
  id TEXT PRIMARY KEY REFERENCES prompt_lab_inbox(id),
  status TEXT NOT NULL CHECK(status IN ('NO_PROMPT','ACTIVE','ABANDON','PROPOSE_ADOPTION')),
  received_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  plan_json TEXT NOT NULL CHECK(json_valid(plan_json) AND json_extract(plan_json,'$.id') IS id),
  closed_at TEXT,
  decision_json TEXT CHECK(decision_json IS NULL OR json_valid(decision_json)),
  CHECK(received_at<=created_at),
  CHECK((status IN ('NO_PROMPT','ACTIVE') AND closed_at IS NULL AND decision_json IS NULL)
    OR (status IN ('ABANDON','PROPOSE_ADOPTION') AND closed_at>=created_at AND decision_json IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS prompt_lab_one_active ON prompt_lab_experiments(status) WHERE status='ACTIVE';
CREATE TRIGGER IF NOT EXISTS prompt_lab_experiment_insert BEFORE INSERT ON prompt_lab_experiments
WHEN NEW.created_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ','now')
  OR NEW.received_at IS NOT (SELECT received_at FROM prompt_lab_inbox WHERE id=NEW.id)
  OR NEW.status NOT IN ('ACTIVE','NO_PROMPT')
  OR (NEW.status='ACTIVE' AND (SELECT min(json_extract(value,'$.tip')) FROM json_each(NEW.plan_json,'$.targets'))<=NEW.created_at)
BEGIN SELECT RAISE(ABORT,'INVALID_REGISTRATION_TIME_OR_STATE'); END;
CREATE TRIGGER IF NOT EXISTS prompt_lab_experiment_duplicate BEFORE INSERT ON prompt_lab_experiments
WHEN EXISTS(SELECT 1 FROM prompt_lab_experiments WHERE id=NEW.id)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER IF NOT EXISTS prompt_lab_frozen_plan BEFORE UPDATE ON prompt_lab_experiments
WHEN NEW.id IS NOT OLD.id OR NEW.plan_json IS NOT OLD.plan_json OR NEW.created_at IS NOT OLD.created_at
  OR NEW.received_at IS NOT OLD.received_at OR OLD.status<>'ACTIVE' OR NEW.status NOT IN ('ABANDON','PROPOSE_ADOPTION')
  OR NEW.closed_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ','now')
BEGIN SELECT RAISE(ABORT,'PROMPT_PLAN_FROZEN'); END;
CREATE TRIGGER IF NOT EXISTS prompt_lab_experiment_preserve BEFORE DELETE ON prompt_lab_experiments
BEGIN SELECT RAISE(ABORT,'PROMPT_PLAN_FROZEN'); END;

CREATE TABLE IF NOT EXISTS prompt_lab_rejections (
  id TEXT PRIMARY KEY REFERENCES prompt_lab_inbox(id),
  reason TEXT NOT NULL,
  checked_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER IF NOT EXISTS prompt_lab_rejection_repeat BEFORE INSERT ON prompt_lab_rejections
WHEN EXISTS(SELECT 1 FROM prompt_lab_rejections WHERE id=NEW.id)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER IF NOT EXISTS prompt_lab_rejection_immutable BEFORE UPDATE ON prompt_lab_rejections
BEGIN SELECT RAISE(ABORT,'PROMPT_REJECTION_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS prompt_lab_rejection_preserve BEFORE DELETE ON prompt_lab_rejections
BEGIN SELECT RAISE(ABORT,'PROMPT_REJECTION_IMMUTABLE'); END;
