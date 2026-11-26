-- 008_guardians: guardians of students and their phone numbers (OD-037). A guardian is linked to one or several students (siblings share one guardian).
-- Visibility always goes through the student link, so a guardian is never visible outside the branches of their students.

CREATE TABLE guardian (
  id TEXT NOT NULL PRIMARY KEY CHECK(length(id) = 36 AND id = lower(id)),
  tenant_id TEXT NOT NULL REFERENCES association(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL CHECK(created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at TEXT NOT NULL CHECK(updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at TEXT CHECK(deleted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  deleted_by TEXT,
  full_name TEXT NOT NULL CHECK(length(trim(full_name)) > 0),
  name_key TEXT NOT NULL,
  phone TEXT NOT NULL CHECK(length(phone) BETWEEN 8 AND 16),   -- normalized: national "0550123456" or international "+33612345678"
  e164 TEXT NOT NULL CHECK(length(e164) BETWEEN 8 AND 15),
  whatsapp INTEGER NOT NULL CHECK(whatsapp IN (0,1)),
  CHECK((deleted_at IS NULL) = (deleted_by IS NULL))
) STRICT;
CREATE INDEX ix_guardian_phone ON guardian(tenant_id, phone) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_guardian_no_delete BEFORE DELETE ON guardian BEGIN SELECT RAISE(ABORT, 'guardian: physical delete not allowed, use a tombstone'); END;
CREATE TRIGGER trg_guardian_envelope BEFORE UPDATE ON guardian
WHEN NEW.tenant_id <> OLD.tenant_id OR NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at OR NEW.created_by <> OLD.created_by OR NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'guardian: envelope violation (tenant, id and created_* are immutable; version must increase by 1)'); END;

CREATE TABLE student_guardian (
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
  guardian_id TEXT NOT NULL REFERENCES guardian(id),
  branch_id TEXT NOT NULL REFERENCES branch(id),
  relation TEXT NOT NULL CHECK(relation IN ('father','mother','brother','sister','uncle','aunt','grandfather','grandmother','other')),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1)),
  FOREIGN KEY (student_id, branch_id) REFERENCES student(id, branch_id),
  CHECK((deleted_at IS NULL) = (deleted_by IS NULL))
) STRICT;
CREATE UNIQUE INDEX ux_student_guardian ON student_guardian(student_id, guardian_id) WHERE deleted_at IS NULL;
-- at most one primary contact per student
CREATE UNIQUE INDEX ux_student_primary_guardian ON student_guardian(student_id) WHERE is_primary = 1 AND deleted_at IS NULL;
CREATE INDEX ix_sg_guardian ON student_guardian(guardian_id) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_student_guardian_no_delete BEFORE DELETE ON student_guardian BEGIN SELECT RAISE(ABORT, 'student_guardian: physical delete not allowed, use a tombstone'); END;
CREATE TRIGGER trg_student_guardian_envelope BEFORE UPDATE ON student_guardian
WHEN NEW.tenant_id <> OLD.tenant_id OR NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at OR NEW.created_by <> OLD.created_by OR NEW.version <> OLD.version + 1 OR NEW.student_id <> OLD.student_id OR NEW.guardian_id <> OLD.guardian_id
BEGIN SELECT RAISE(ABORT, 'student_guardian: envelope violation (tenant, id, student, guardian and created_* are immutable; version must increase by 1)'); END;
