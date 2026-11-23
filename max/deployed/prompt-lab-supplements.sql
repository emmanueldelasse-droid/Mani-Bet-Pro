-- Experimental findings have their own ingress. Ordinary cards and simulation never read this table.
CREATE TABLE IF NOT EXISTS prompt_lab_supplements (
  id INTEGER PRIMARY KEY,
  envelope TEXT NOT NULL CHECK(json_valid(envelope) AND length(CAST(envelope AS BLOB)) BETWEEN 2 AND 98304),
  experiment_id TEXT GENERATED ALWAYS AS (json_extract(envelope,'$.experiment_id')) STORED NOT NULL REFERENCES prompt_lab_experiments(id),
  match_id TEXT GENERATED ALWAYS AS (CAST(json_extract(envelope,'$.report.match_id') AS TEXT)) STORED NOT NULL,
  baseline_receipt_id INTEGER GENERATED ALWAYS AS (json_extract(envelope,'$.baseline_receipt_id')) STORED NOT NULL REFERENCES macfly_inbox(id),
  generated_at TEXT GENERATED ALWAYS AS (strftime('%Y-%m-%dT%H:%M:%fZ',json_extract(envelope,'$.report.generated_at'))) STORED NOT NULL,
  outcome TEXT GENERATED ALWAYS AS (json_extract(envelope,'$.outcome')) STORED NOT NULL CHECK(outcome IN ('FOUND','NO_FINDING')),
  received_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(experiment_id,match_id,generated_at),
  CHECK(json_extract(envelope,'$.report.schema_version') IS 'max-research-v1'),
  CHECK(json_extract(envelope,'$.report.experiment_id') IS experiment_id),
  CHECK(generated_at<=received_at)
);
CREATE TRIGGER IF NOT EXISTS prompt_lab_supplement_keep_original BEFORE INSERT ON prompt_lab_supplements
WHEN EXISTS(SELECT 1 FROM prompt_lab_supplements WHERE experiment_id=NEW.experiment_id AND match_id=NEW.match_id AND generated_at=NEW.generated_at)
BEGIN
  SELECT RAISE(ABORT,'PROMPT_SUPPLEMENT_CONFLICT') WHERE EXISTS(SELECT 1 FROM prompt_lab_supplements WHERE experiment_id=NEW.experiment_id AND match_id=NEW.match_id AND generated_at=NEW.generated_at AND envelope<>NEW.envelope);
  SELECT RAISE(IGNORE);
END;
CREATE TRIGGER IF NOT EXISTS prompt_lab_supplement_admission BEFORE INSERT ON prompt_lab_supplements
WHEN NOT EXISTS(SELECT 1 FROM prompt_lab_supplements WHERE experiment_id=NEW.experiment_id AND match_id=NEW.match_id AND generated_at=NEW.generated_at)
AND (NEW.received_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS (
 SELECT 1 FROM prompt_lab_experiments e JOIN macfly_inbox b ON b.id=NEW.baseline_receipt_id AND b.match_id=NEW.match_id,
 json_each(e.plan_json,'$.targets') t
 WHERE e.id=NEW.experiment_id AND e.status='ACTIVE' AND json_extract(t.value,'$.match_id')=NEW.match_id
 AND e.created_at<=NEW.generated_at AND b.received_at<=NEW.generated_at
 AND strftime('%s',NEW.generated_at)-strftime('%s',b.received_at)<21600))
BEGIN SELECT RAISE(ABORT,'INVALID_EXPERIMENT_BASELINE_OR_TIME'); END;
CREATE TRIGGER IF NOT EXISTS prompt_lab_supplement_frozen BEFORE UPDATE ON prompt_lab_supplements
BEGIN SELECT RAISE(ABORT,'PROMPT_SUPPLEMENT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS prompt_lab_supplement_preserve BEFORE DELETE ON prompt_lab_supplements
BEGIN SELECT RAISE(ABORT,'PROMPT_SUPPLEMENT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS macfly_reject_experiment_on_primary BEFORE INSERT ON macfly_inbox
WHEN json_type(NEW.report_json,'$.experiment_id') IS NOT NULL OR json_type(NEW.report_json,'$.baseline_receipt_id') IS NOT NULL
 OR json_type(NEW.report_json,'$.experimental') IS NOT NULL
BEGIN SELECT RAISE(ABORT,'USE_PROMPT_LAB_SUPPLEMENT_INGRESS'); END;
