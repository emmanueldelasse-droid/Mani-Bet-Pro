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

-- The immutable registry also contains versions waiting for the single active slot.
-- Original v23 experiment rows and their foreign keys are preserved.
CREATE TABLE IF NOT EXISTS prompt_lab_versions (
  id TEXT PRIMARY KEY REFERENCES prompt_lab_inbox(id),
  family_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version>=1),
  parent_id TEXT UNIQUE REFERENCES prompt_lab_versions(id),
  registered_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  change_reason TEXT NOT NULL,
  plan_json TEXT NOT NULL CHECK(json_valid(plan_json) AND json_extract(plan_json,'$.id') IS id),
  review_at TEXT,
  UNIQUE(family_id,version),
  CHECK((version=1 AND family_id=id AND parent_id IS NULL) OR (version>1 AND parent_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS prompt_lab_status_history (
  seq INTEGER PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES prompt_lab_versions(id),
  status TEXT NOT NULL CHECK(status IN('REGISTERED','QUEUED','ACTIVE','NO_PROMPT','INCONCLUSIVE','ABANDON','PROPOSE_ADOPTION')),
  at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reason TEXT NOT NULL CHECK(length(reason)>0),
  UNIQUE(experiment_id,status)
);
CREATE INDEX IF NOT EXISTS prompt_lab_history_by_experiment ON prompt_lab_status_history(experiment_id,seq);

-- Recover historical transitions only from timestamps actually recorded by the original Worker.
INSERT OR IGNORE INTO prompt_lab_versions(id,family_id,version,registered_at,change_reason,plan_json,review_at)
SELECT id,id,1,created_at,'Version initiale enregistrée par MacFly.',plan_json,
  coalesce(json_extract(plan_json,'$.review_at'),json_extract(plan_json,'$.cohort.end'))
FROM prompt_lab_experiments;
INSERT OR IGNORE INTO prompt_lab_status_history(experiment_id,status,at,reason)
SELECT id,CASE WHEN status='NO_PROMPT' THEN 'NO_PROMPT' ELSE 'ACTIVE' END,created_at,
  coalesce(json_extract(plan_json,'$.reason'),json_extract(plan_json,'$.hypothesis'),'Enregistrement initial.')
FROM prompt_lab_experiments;
INSERT OR IGNORE INTO prompt_lab_status_history(experiment_id,status,at,reason)
SELECT id,CASE WHEN json_extract(decision_json,'$.decision')='NON_CONCLUANTE' THEN 'INCONCLUSIVE' ELSE status END,closed_at,
  coalesce(json_extract(decision_json,'$.reason'),'Décision de clôture enregistrée.')
FROM prompt_lab_experiments WHERE closed_at IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS prompt_lab_version_clock BEFORE INSERT ON prompt_lab_versions
WHEN NOT EXISTS(SELECT 1 FROM prompt_lab_versions WHERE id=NEW.id)
 AND NEW.registered_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ','now')
 AND NOT EXISTS(SELECT 1 FROM prompt_lab_experiments WHERE id=NEW.id AND created_at=NEW.registered_at)
BEGIN SELECT RAISE(ABORT,'PROMPT_VERSION_SERVER_TIME_REQUIRED'); END;
CREATE TRIGGER IF NOT EXISTS prompt_lab_version_chain BEFORE INSERT ON prompt_lab_versions
WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM prompt_lab_versions
 WHERE id=NEW.parent_id AND family_id=NEW.family_id AND version=NEW.version-1)
BEGIN SELECT RAISE(ABORT,'INVALID_PROMPT_VERSION_CHAIN'); END;
CREATE TRIGGER IF NOT EXISTS prompt_lab_version_repeat BEFORE INSERT ON prompt_lab_versions
WHEN EXISTS(SELECT 1 FROM prompt_lab_versions WHERE id=NEW.id OR (family_id=NEW.family_id AND version=NEW.version)
 OR (parent_id IS NOT NULL AND parent_id=NEW.parent_id))
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER IF NOT EXISTS prompt_lab_version_immutable BEFORE UPDATE ON prompt_lab_versions
BEGIN SELECT RAISE(ABORT,'PROMPT_VERSION_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS prompt_lab_version_preserve BEFORE DELETE ON prompt_lab_versions
BEGIN SELECT RAISE(ABORT,'PROMPT_VERSION_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS prompt_lab_history_clock BEFORE INSERT ON prompt_lab_status_history
WHEN NOT EXISTS(SELECT 1 FROM prompt_lab_status_history WHERE experiment_id=NEW.experiment_id AND status=NEW.status)
 AND NEW.at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ','now')
 AND NOT EXISTS(SELECT 1 FROM prompt_lab_experiments WHERE id=NEW.experiment_id AND
  ((NEW.status IN('ACTIVE','NO_PROMPT') AND NEW.at=created_at) OR (NEW.status IN('INCONCLUSIVE','ABANDON','PROPOSE_ADOPTION') AND NEW.at=closed_at)))
BEGIN SELECT RAISE(ABORT,'PROMPT_EVENT_SERVER_TIME_REQUIRED'); END;
CREATE TRIGGER IF NOT EXISTS prompt_lab_history_repeat BEFORE INSERT ON prompt_lab_status_history
WHEN EXISTS(SELECT 1 FROM prompt_lab_status_history WHERE experiment_id=NEW.experiment_id AND status=NEW.status)
 OR EXISTS(SELECT 1 FROM prompt_lab_status_history WHERE seq=NEW.seq)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER IF NOT EXISTS prompt_lab_history_immutable BEFORE UPDATE ON prompt_lab_status_history
BEGIN SELECT RAISE(ABORT,'PROMPT_HISTORY_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS prompt_lab_history_preserve BEFORE DELETE ON prompt_lab_status_history
BEGIN SELECT RAISE(ABORT,'PROMPT_HISTORY_IMMUTABLE'); END;

-- These transitions are in the same transaction as the experiment itself.
CREATE TRIGGER IF NOT EXISTS prompt_lab_log_activation AFTER INSERT ON prompt_lab_experiments BEGIN
 INSERT OR IGNORE INTO prompt_lab_versions(id,family_id,version,registered_at,change_reason,plan_json,review_at)
 VALUES(NEW.id,NEW.id,1,NEW.created_at,'Version initiale enregistrée par MacFly.',NEW.plan_json,
 coalesce(json_extract(NEW.plan_json,'$.review_at'),json_extract(NEW.plan_json,'$.cohort.end')));
 INSERT OR IGNORE INTO prompt_lab_status_history(experiment_id,status,at,reason) VALUES(NEW.id,NEW.status,NEW.created_at,
 coalesce(json_extract(NEW.plan_json,'$.reason'),json_extract(NEW.plan_json,'$.hypothesis'),'Activation sur la cohorte préenregistrée.'));
END;
CREATE TRIGGER IF NOT EXISTS prompt_lab_log_verdict AFTER UPDATE OF status ON prompt_lab_experiments BEGIN
 INSERT INTO prompt_lab_status_history(experiment_id,status,at,reason) VALUES(NEW.id,
 CASE WHEN json_extract(NEW.decision_json,'$.decision')='NON_CONCLUANTE' THEN 'INCONCLUSIVE' ELSE NEW.status END,NEW.closed_at,
 coalesce(json_extract(NEW.decision_json,'$.reason'),'Décision de clôture enregistrée.'));
END;
