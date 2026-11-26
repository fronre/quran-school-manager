-- 006_groups: teachers assigned to groups (الأفواج). A teacher may lead several groups; a group may have several teachers.
-- study_group and enrollment already exist (001). A teacher can only be attached to a group of the SAME branch (composite FKs).

CREATE UNIQUE INDEX ux_staff_id_branch ON staff_member(id, branch_id);

CREATE TABLE group_teacher (
  id TEXT NOT NULL PRIMARY KEY CHECK(length(id) = 36 AND id = lower(id)),
  tenant_id TEXT NOT NULL REFERENCES association(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL CHECK(created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at TEXT NOT NULL CHECK(updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at TEXT CHECK(deleted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  deleted_by TEXT,
  group_id TEXT NOT NULL,
  staff_member_id TEXT NOT NULL,
  branch_id TEXT NOT NULL REFERENCES branch(id),
  FOREIGN KEY (group_id, branch_id) REFERENCES study_group(id, branch_id),
  FOREIGN KEY (staff_member_id, branch_id) REFERENCES staff_member(id, branch_id),
  CHECK((deleted_at IS NULL) = (deleted_by IS NULL))
) STRICT;
CREATE UNIQUE INDEX ux_group_teacher ON group_teacher(group_id, staff_member_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_group_teacher_staff ON group_teacher(staff_member_id) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_group_teacher_no_delete BEFORE DELETE ON group_teacher BEGIN SELECT RAISE(ABORT, 'group_teacher: physical delete not allowed, use a tombstone'); END;
CREATE TRIGGER trg_group_teacher_envelope BEFORE UPDATE ON group_teacher
WHEN NEW.tenant_id <> OLD.tenant_id OR NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at OR NEW.created_by <> OLD.created_by OR NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'group_teacher: envelope violation (tenant, id and created_* are immutable; version must increase by 1)'); END;
