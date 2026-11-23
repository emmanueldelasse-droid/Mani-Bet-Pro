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

-- Authenticated MacFly writes the exact instruction it read for an already sealed normal collection.
CREATE TABLE IF NOT EXISTS prompt_lab_reads (
  id INTEGER PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES prompt_lab_experiments(id),
  baseline_receipt_id INTEGER NOT NULL REFERENCES macfly_inbox(id),
  prompt_text TEXT NOT NULL,
  run_id TEXT NOT NULL CHECK(length(trim(run_id)) BETWEEN 1 AND 160),
  received_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(experiment_id,baseline_receipt_id)
);
CREATE TRIGGER IF NOT EXISTS prompt_lab_read_admission BEFORE INSERT ON prompt_lab_reads
WHEN NOT EXISTS(SELECT 1 FROM prompt_lab_reads WHERE experiment_id=NEW.experiment_id AND baseline_receipt_id=NEW.baseline_receipt_id)
AND (NEW.received_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS (
 SELECT 1 FROM prompt_lab_experiments e JOIN macfly_inbox b ON b.id=NEW.baseline_receipt_id,
 json_each(e.plan_json,'$.targets') t
 WHERE e.id=NEW.experiment_id AND e.status='ACTIVE' AND json_extract(e.plan_json,'$.prompt') IS NEW.prompt_text
 AND json_type(b.report_json,'$.collection_run_id')='text' AND json_extract(b.report_json,'$.collection_run_id')=NEW.run_id
 AND CAST(json_extract(t.value,'$.match_id') AS TEXT)=b.match_id
 AND NEW.received_at>=e.created_at AND NEW.received_at<json_extract(t.value,'$.tip')
 AND b.received_at<=NEW.received_at AND strftime('%s',NEW.received_at)-strftime('%s',b.received_at)<21600))
BEGIN SELECT RAISE(ABORT,'INVALID_EXPERIMENT_READ'); END;
CREATE TRIGGER IF NOT EXISTS prompt_lab_read_keep_original BEFORE INSERT ON prompt_lab_reads
WHEN EXISTS(SELECT 1 FROM prompt_lab_reads WHERE experiment_id=NEW.experiment_id AND baseline_receipt_id=NEW.baseline_receipt_id)
BEGIN
 SELECT RAISE(ABORT,'PROMPT_READ_CONFLICT') WHERE EXISTS(SELECT 1 FROM prompt_lab_reads WHERE experiment_id=NEW.experiment_id AND baseline_receipt_id=NEW.baseline_receipt_id AND (prompt_text<>NEW.prompt_text OR run_id<>NEW.run_id));
 SELECT RAISE(IGNORE);
END;
CREATE TRIGGER IF NOT EXISTS prompt_lab_read_frozen BEFORE UPDATE ON prompt_lab_reads
BEGIN SELECT RAISE(ABORT,'PROMPT_READ_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS prompt_lab_read_preserve BEFORE DELETE ON prompt_lab_reads
BEGIN SELECT RAISE(ABORT,'PROMPT_READ_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS prompt_lab_read_preserve_id BEFORE INSERT ON prompt_lab_reads
WHEN EXISTS(SELECT 1 FROM prompt_lab_reads WHERE id=NEW.id AND (experiment_id<>NEW.experiment_id OR baseline_receipt_id<>NEW.baseline_receipt_id))
BEGIN SELECT RAISE(ABORT,'PROMPT_READ_IMMUTABLE'); END;
CREATE TABLE IF NOT EXISTS prompt_lab_read_confirmations (
  read_id INTEGER PRIMARY KEY REFERENCES prompt_lab_reads(id),
  confirmed_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER IF NOT EXISTS prompt_lab_read_confirmation_clock BEFORE INSERT ON prompt_lab_read_confirmations
WHEN NEW.confirmed_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ','now')
 OR NOT EXISTS(SELECT 1 FROM prompt_lab_reads WHERE id=NEW.read_id AND received_at<=NEW.confirmed_at)
BEGIN SELECT RAISE(ABORT,'INVALID_PROMPT_READ_CONFIRMATION'); END;
CREATE TRIGGER IF NOT EXISTS prompt_lab_read_confirmation_keep BEFORE INSERT ON prompt_lab_read_confirmations
WHEN EXISTS(SELECT 1 FROM prompt_lab_read_confirmations WHERE read_id=NEW.read_id)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER IF NOT EXISTS prompt_lab_read_confirmation_frozen BEFORE UPDATE ON prompt_lab_read_confirmations
BEGIN SELECT RAISE(ABORT,'PROMPT_READ_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS prompt_lab_read_confirmation_preserve BEFORE DELETE ON prompt_lab_read_confirmations
BEGIN SELECT RAISE(ABORT,'PROMPT_READ_IMMUTABLE'); END;

-- A report signed for a previous game, prompt version or collection cannot acquire credit here.
-- Existing reports retain their original history; none receive a reconstructed acknowledgment.
CREATE TRIGGER IF NOT EXISTS prompt_lab_supplement_confirmed BEFORE INSERT ON prompt_lab_supplements
WHEN NOT EXISTS(SELECT 1 FROM prompt_lab_supplements WHERE experiment_id=NEW.experiment_id AND match_id=NEW.match_id AND generated_at=NEW.generated_at)
 AND NOT EXISTS(SELECT 1 FROM prompt_lab_reads r JOIN prompt_lab_read_confirmations c ON c.read_id=r.id
 WHERE json_type(NEW.envelope,'$.read_id')='integer' AND r.id=json_extract(NEW.envelope,'$.read_id')
 AND r.experiment_id=NEW.experiment_id AND r.baseline_receipt_id=NEW.baseline_receipt_id AND c.confirmed_at<=NEW.generated_at)
BEGIN SELECT RAISE(ABORT,'CONFIRMED_PROMPT_READ_REQUIRED'); END;

-- Protect the blinded control even if two normal deliveries and the read share one millisecond.
-- The ordinary report stays in Max. Only comparisons depending on this late-sealed input are excluded.
CREATE INDEX IF NOT EXISTS prompt_lab_reads_by_run ON prompt_lab_reads(run_id,id);
CREATE TABLE IF NOT EXISTS prompt_lab_unblinded_baselines (
  baseline_receipt_id INTEGER PRIMARY KEY REFERENCES macfly_inbox(id),
  first_read_id INTEGER NOT NULL REFERENCES prompt_lab_reads(id)
);
CREATE TRIGGER IF NOT EXISTS prompt_lab_record_unblinded AFTER INSERT ON macfly_inbox
WHEN json_type(NEW.report_json,'$.collection_run_id')='text'
BEGIN
 INSERT INTO prompt_lab_unblinded_baselines(baseline_receipt_id,first_read_id)
 SELECT NEW.id,r.id FROM prompt_lab_reads r WHERE r.run_id=json_extract(NEW.report_json,'$.collection_run_id')
 ORDER BY r.received_at,r.id LIMIT 1;
END;
CREATE TRIGGER IF NOT EXISTS prompt_lab_unblinded_read BEFORE INSERT ON prompt_lab_reads
WHEN EXISTS(SELECT 1 FROM prompt_lab_unblinded_baselines WHERE baseline_receipt_id=NEW.baseline_receipt_id)
BEGIN SELECT RAISE(ABORT,'BASELINE_AFTER_PROMPT_READ'); END;
CREATE TRIGGER IF NOT EXISTS prompt_lab_supplement_preserve_id BEFORE INSERT ON prompt_lab_supplements
WHEN EXISTS(SELECT 1 FROM prompt_lab_supplements WHERE id=NEW.id AND envelope<>NEW.envelope)
BEGIN SELECT RAISE(ABORT,'PROMPT_SUPPLEMENT_IMMUTABLE'); END;
