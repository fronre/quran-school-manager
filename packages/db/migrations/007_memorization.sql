-- 007_memorization: progress records (BR-032..BR-037). Reference data (surah names, ayah counts) ships in the domain package, not in the database.
-- A record is never edited: a wrong record is VOIDED with a reason and a new one is entered (explicit correction, no silent edits).

CREATE TABLE memorization_record (
  id TEXT NOT NULL PRIMARY KEY CHECK(length(id) = 36 AND id = lower(id)),
  tenant_id TEXT NOT NULL REFERENCES association(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL CHECK(created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at TEXT NOT NULL CHECK(updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at TEXT CHECK(deleted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  deleted_by TEXT,
  student_id TEXT NOT NULL,
  enrollment_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  record_date TEXT NOT NULL CHECK(record_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  type TEXT NOT NULL CHECK(type IN ('new','revision','consolidation')),
  start_surah INTEGER NOT NULL CHECK(start_surah BETWEEN 1 AND 114),
  start_ayah INTEGER NOT NULL CHECK(start_ayah >= 1),
  end_surah INTEGER NOT NULL CHECK(end_surah BETWEEN 1 AND 114),
  end_ayah INTEGER NOT NULL CHECK(end_ayah >= 1),
  start_ordinal INTEGER NOT NULL CHECK(start_ordinal BETWEEN 1 AND 6236),
  end_ordinal INTEGER NOT NULL CHECK(end_ordinal BETWEEN 1 AND 6236),
  dataset_version TEXT NOT NULL CHECK(length(dataset_version) > 0),
  eval_rank INTEGER CHECK(eval_rank IS NULL OR eval_rank BETWEEN 1 AND 5),
  eval_label TEXT,
  scale_version INTEGER,
  comment TEXT,
  voided_at TEXT CHECK(voided_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  voided_by TEXT,
  void_reason TEXT,
  CHECK(start_ordinal <= end_ordinal),
  CHECK((eval_rank IS NULL) = (eval_label IS NULL) AND (eval_rank IS NULL) = (scale_version IS NULL)),
  CHECK((voided_at IS NULL) = (voided_by IS NULL) AND (voided_at IS NULL) = (void_reason IS NULL)),
  FOREIGN KEY (enrollment_id, student_id, group_id) REFERENCES enrollment(id, student_id, group_id),
  FOREIGN KEY (group_id, branch_id) REFERENCES study_group(id, branch_id),
  CHECK((deleted_at IS NULL) = (deleted_by IS NULL))
) STRICT;
CREATE INDEX ix_memo_student ON memorization_record(student_id, record_date) WHERE deleted_at IS NULL;
CREATE INDEX ix_memo_group ON memorization_record(group_id, record_date) WHERE deleted_at IS NULL;
-- BR-037: the record date must lie inside the enrollment's date range.
CREATE TRIGGER trg_memo_in_range BEFORE INSERT ON memorization_record
WHEN NOT EXISTS (SELECT 1 FROM enrollment e WHERE e.id = NEW.enrollment_id AND NEW.record_date >= e.start_date AND NEW.record_date <= ifnull(e.end_date, '9999-12-31'))
BEGIN SELECT RAISE(ABORT, 'record date is outside the enrollment range'); END;
CREATE TRIGGER trg_memo_no_delete BEFORE DELETE ON memorization_record BEGIN SELECT RAISE(ABORT, 'memorization_record: physical delete not allowed, void it with a reason'); END;
-- Content is immutable; only voiding (once) is allowed.
CREATE TRIGGER trg_memo_immutable BEFORE UPDATE ON memorization_record
WHEN NEW.tenant_id <> OLD.tenant_id OR NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at OR NEW.created_by <> OLD.created_by OR NEW.version <> OLD.version + 1
  OR NEW.student_id <> OLD.student_id OR NEW.enrollment_id <> OLD.enrollment_id OR NEW.group_id <> OLD.group_id OR NEW.branch_id <> OLD.branch_id OR NEW.record_date <> OLD.record_date OR NEW.type <> OLD.type
  OR NEW.start_ordinal <> OLD.start_ordinal OR NEW.end_ordinal <> OLD.end_ordinal OR NEW.start_surah <> OLD.start_surah OR NEW.start_ayah <> OLD.start_ayah OR NEW.end_surah <> OLD.end_surah OR NEW.end_ayah <> OLD.end_ayah
  OR ifnull(NEW.eval_rank, 0) <> ifnull(OLD.eval_rank, 0) OR ifnull(NEW.comment, '') <> ifnull(OLD.comment, '') OR NEW.dataset_version <> OLD.dataset_version
  OR (OLD.voided_at IS NOT NULL AND (NEW.voided_at IS NOT OLD.voided_at OR NEW.void_reason IS NOT OLD.void_reason))
BEGIN SELECT RAISE(ABORT, 'memorization_record: content is immutable (void it with a reason and enter a new record)'); END;
