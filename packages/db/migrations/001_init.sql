-- 001_init: Phase 1 foundation schema. Forward-only. Row envelope per DATABASE_DESIGN section 2.
-- Dates YYYY-MM-DD, timestamps UTC ISO-8601 with milliseconds.

CREATE TABLE schema_migration (
  version INTEGER NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  checksum TEXT NOT NULL
) STRICT;

CREATE TABLE association (
  id TEXT NOT NULL PRIMARY KEY CHECK(length(id) = 36 AND id = lower(id)),
  tenant_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL CHECK(created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at TEXT NOT NULL CHECK(updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at TEXT CHECK(deleted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  deleted_by TEXT,
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  timezone TEXT NOT NULL DEFAULT 'Africa/Algiers',
  logo_ref TEXT, address TEXT, contact TEXT,
  CHECK(id = tenant_id),
  CHECK((deleted_at IS NULL) = (deleted_by IS NULL))
) STRICT;

CREATE TABLE branch (
  id TEXT NOT NULL PRIMARY KEY CHECK(length(id) = 36 AND id = lower(id)),
  tenant_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL CHECK(created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at TEXT NOT NULL CHECK(updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at TEXT CHECK(deleted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  deleted_by TEXT,
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  label TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  FOREIGN KEY (tenant_id) REFERENCES association(id),
  CHECK((deleted_at IS NULL) = (deleted_by IS NULL))
) STRICT;
CREATE UNIQUE INDEX ux_branch_name ON branch(tenant_id, name) WHERE deleted_at IS NULL;

CREATE TABLE academic_year (
  id TEXT NOT NULL PRIMARY KEY CHECK(length(id) = 36 AND id = lower(id)),
  tenant_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL CHECK(created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at TEXT NOT NULL CHECK(updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at TEXT CHECK(deleted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  deleted_by TEXT,
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  start_date TEXT NOT NULL CHECK(start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  end_date TEXT NOT NULL CHECK(end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','active','closed')),
  CHECK(start_date < end_date),
  FOREIGN KEY (tenant_id) REFERENCES association(id),
  CHECK((deleted_at IS NULL) = (deleted_by IS NULL))
) STRICT;
CREATE UNIQUE INDEX ux_year_one_active ON academic_year(tenant_id) WHERE status = 'active' AND deleted_at IS NULL; -- BR-016
CREATE UNIQUE INDEX ux_year_name ON academic_year(tenant_id, name) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_year_no_overlap_ins BEFORE INSERT ON academic_year
WHEN NEW.deleted_at IS NULL AND EXISTS (SELECT 1 FROM academic_year y WHERE y.tenant_id = NEW.tenant_id AND y.deleted_at IS NULL AND y.start_date <= NEW.end_date AND NEW.start_date <= y.end_date)
BEGIN SELECT RAISE(ABORT, 'academic_year overlaps an existing year'); END;
CREATE TRIGGER trg_year_no_overlap_upd BEFORE UPDATE OF start_date, end_date, deleted_at ON academic_year
WHEN NEW.deleted_at IS NULL AND EXISTS (SELECT 1 FROM academic_year y WHERE y.tenant_id = NEW.tenant_id AND y.id <> NEW.id AND y.deleted_at IS NULL AND y.start_date <= NEW.end_date AND NEW.start_date <= y.end_date)
BEGIN SELECT RAISE(ABORT, 'academic_year overlaps an existing year'); END;

CREATE TABLE person (
  id TEXT NOT NULL PRIMARY KEY CHECK(length(id) = 36 AND id = lower(id)),
  tenant_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL CHECK(created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at TEXT NOT NULL CHECK(updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at TEXT CHECK(deleted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  deleted_by TEXT,
  given_name TEXT NOT NULL CHECK(length(trim(given_name)) > 0),
  family_name TEXT NOT NULL CHECK(length(trim(family_name)) > 0),
  display_name_latin TEXT,
  gender TEXT CHECK(gender IN ('male','female')),
  birth_date TEXT CHECK(birth_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  phone TEXT, address TEXT,
  FOREIGN KEY (tenant_id) REFERENCES association(id),
  CHECK((deleted_at IS NULL) = (deleted_by IS NULL))
) STRICT;

CREATE TABLE student (
  id TEXT NOT NULL PRIMARY KEY CHECK(length(id) = 36 AND id = lower(id)),
  tenant_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL CHECK(created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at TEXT NOT NULL CHECK(updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at TEXT CHECK(deleted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  deleted_by TEXT,
  person_id TEXT NOT NULL REFERENCES person(id),
  student_no TEXT NOT NULL CHECK(length(trim(student_no)) > 0),
  branch_id TEXT NOT NULL REFERENCES branch(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('applicant','active','suspended','completed','withdrawn')),
  joined_on TEXT CHECK(joined_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  archived_at TEXT CHECK(archived_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  archive_reason TEXT,
  CHECK((archived_at IS NULL) = (archive_reason IS NULL)),
  FOREIGN KEY (tenant_id) REFERENCES association(id),
  CHECK((deleted_at IS NULL) = (deleted_by IS NULL))
) STRICT;
CREATE UNIQUE INDEX ux_student_person ON student(person_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_student_no ON student(tenant_id, student_no) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_student_id_branch ON student(id, branch_id);

CREATE TABLE staff_member (
  id TEXT NOT NULL PRIMARY KEY CHECK(length(id) = 36 AND id = lower(id)),
  tenant_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL CHECK(created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at TEXT NOT NULL CHECK(updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at TEXT CHECK(deleted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  deleted_by TEXT,
  person_id TEXT NOT NULL REFERENCES person(id),
  kind TEXT NOT NULL CHECK(kind IN ('employee','volunteer')),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  FOREIGN KEY (tenant_id) REFERENCES association(id),
  CHECK((deleted_at IS NULL) = (deleted_by IS NULL))
) STRICT;
CREATE UNIQUE INDEX ux_staff_person ON staff_member(person_id) WHERE deleted_at IS NULL;

CREATE TABLE user_account (
  id TEXT NOT NULL PRIMARY KEY CHECK(length(id) = 36 AND id = lower(id)),
  tenant_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL CHECK(created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at TEXT NOT NULL CHECK(updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at TEXT CHECK(deleted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  deleted_by TEXT,
  staff_member_id TEXT NOT NULL REFERENCES staff_member(id),
  username TEXT NOT NULL CHECK(length(trim(username)) > 0),
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK(failed_attempts >= 0),
  locked_until TEXT CHECK(locked_until GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  last_login_at TEXT CHECK(last_login_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  FOREIGN KEY (tenant_id) REFERENCES association(id),
  CHECK((deleted_at IS NULL) = (deleted_by IS NULL))
) STRICT;
CREATE UNIQUE INDEX ux_user_username ON user_account(tenant_id, lower(username)) WHERE deleted_at IS NULL;

CREATE TABLE role (
  id TEXT NOT NULL PRIMARY KEY CHECK(length(id) = 36 AND id = lower(id)),
  tenant_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL CHECK(created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at TEXT NOT NULL CHECK(updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at TEXT CHECK(deleted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  deleted_by TEXT,
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  is_system INTEGER NOT NULL DEFAULT 0 CHECK(is_system IN (0,1)),
  FOREIGN KEY (tenant_id) REFERENCES association(id),
  CHECK((deleted_at IS NULL) = (deleted_by IS NULL))
) STRICT;
CREATE UNIQUE INDEX ux_role_name ON role(tenant_id, name) WHERE deleted_at IS NULL;

CREATE TABLE role_permission (
  id TEXT NOT NULL PRIMARY KEY CHECK(length(id) = 36 AND id = lower(id)),
  tenant_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL CHECK(created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at TEXT NOT NULL CHECK(updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at TEXT CHECK(deleted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  deleted_by TEXT,
  role_id TEXT NOT NULL REFERENCES role(id),
  permission_code TEXT NOT NULL CHECK(length(trim(permission_code)) > 0),
  FOREIGN KEY (tenant_id) REFERENCES association(id),
  CHECK((deleted_at IS NULL) = (deleted_by IS NULL))
) STRICT;
CREATE UNIQUE INDEX ux_role_perm ON role_permission(role_id, permission_code) WHERE deleted_at IS NULL;

CREATE TABLE user_role_assignment (
  id TEXT NOT NULL PRIMARY KEY CHECK(length(id) = 36 AND id = lower(id)),
  tenant_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL CHECK(created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at TEXT NOT NULL CHECK(updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at TEXT CHECK(deleted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  deleted_by TEXT,
  user_id TEXT NOT NULL REFERENCES user_account(id),
  role_id TEXT NOT NULL REFERENCES role(id),
  branch_id TEXT REFERENCES branch(id), -- NULL = all branches (Director only; enforced in the domain, OD-003)
  FOREIGN KEY (tenant_id) REFERENCES association(id),
  CHECK((deleted_at IS NULL) = (deleted_by IS NULL))
) STRICT;
CREATE UNIQUE INDEX ux_ura ON user_role_assignment(user_id, role_id, ifnull(branch_id, '')) WHERE deleted_at IS NULL;

CREATE TABLE study_group (
  id TEXT NOT NULL PRIMARY KEY CHECK(length(id) = 36 AND id = lower(id)),
  tenant_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL CHECK(created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at TEXT NOT NULL CHECK(updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at TEXT CHECK(deleted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  deleted_by TEXT,
  branch_id TEXT NOT NULL REFERENCES branch(id),
  academic_year_id TEXT NOT NULL REFERENCES academic_year(id),
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  level TEXT,
  capacity INTEGER NOT NULL CHECK(capacity > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed')),
  FOREIGN KEY (tenant_id) REFERENCES association(id),
  CHECK((deleted_at IS NULL) = (deleted_by IS NULL))
) STRICT;
CREATE UNIQUE INDEX ux_group_name ON study_group(branch_id, academic_year_id, name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_group_id_branch ON study_group(id, branch_id);
CREATE UNIQUE INDEX ux_group_id_year ON study_group(id, academic_year_id);

CREATE TABLE session (
  id TEXT NOT NULL PRIMARY KEY CHECK(length(id) = 36 AND id = lower(id)),
  tenant_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL CHECK(created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at TEXT NOT NULL CHECK(updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at TEXT CHECK(deleted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  deleted_by TEXT,
  group_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  session_date TEXT NOT NULL CHECK(session_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  start_time TEXT NOT NULL CHECK(start_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  end_time TEXT NOT NULL CHECK(end_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','held','cancelled')),
  cancel_reason TEXT,
  confirmed_at TEXT CHECK(confirmed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  confirmed_by TEXT,
  CHECK(start_time < end_time),
  CHECK(status <> 'cancelled' OR length(trim(ifnull(cancel_reason, ''))) > 0),
  FOREIGN KEY (group_id, branch_id) REFERENCES study_group(id, branch_id),
  FOREIGN KEY (tenant_id) REFERENCES association(id),
  CHECK((deleted_at IS NULL) = (deleted_by IS NULL))
) STRICT;
CREATE UNIQUE INDEX ux_session_slot ON session(group_id, session_date, start_time) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_session_id_group ON session(id, group_id);

CREATE TABLE enrollment (
  id TEXT NOT NULL PRIMARY KEY CHECK(length(id) = 36 AND id = lower(id)),
  tenant_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL CHECK(created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at TEXT NOT NULL CHECK(updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at TEXT CHECK(deleted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  deleted_by TEXT,
  student_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  academic_year_id TEXT NOT NULL,
  start_date TEXT NOT NULL CHECK(start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  end_date TEXT CHECK(end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  end_reason TEXT,
  transferred_to_id TEXT REFERENCES enrollment(id),
  CHECK(end_date IS NULL OR end_date >= start_date),
  FOREIGN KEY (student_id, branch_id) REFERENCES student(id, branch_id),
  FOREIGN KEY (group_id, branch_id) REFERENCES study_group(id, branch_id),
  FOREIGN KEY (group_id, academic_year_id) REFERENCES study_group(id, academic_year_id),
  FOREIGN KEY (tenant_id) REFERENCES association(id),
  CHECK((deleted_at IS NULL) = (deleted_by IS NULL))
) STRICT;
-- BR-001: at most one open enrollment per student per academic year.
CREATE UNIQUE INDEX ux_enrollment_one_open ON enrollment(student_id, academic_year_id) WHERE end_date IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX ux_enrollment_composite ON enrollment(id, student_id, group_id);
-- BR-002: no overlapping date ranges for the same student and year.
CREATE TRIGGER trg_enrollment_no_overlap_ins BEFORE INSERT ON enrollment
WHEN NEW.deleted_at IS NULL AND EXISTS (SELECT 1 FROM enrollment e WHERE e.student_id = NEW.student_id AND e.academic_year_id = NEW.academic_year_id AND e.deleted_at IS NULL
  AND e.start_date <= ifnull(NEW.end_date, '9999-12-31') AND NEW.start_date <= ifnull(e.end_date, '9999-12-31'))
BEGIN SELECT RAISE(ABORT, 'enrollment date range overlaps another enrollment of this student'); END;
CREATE TRIGGER trg_enrollment_no_overlap_upd BEFORE UPDATE OF start_date, end_date, deleted_at ON enrollment
WHEN NEW.deleted_at IS NULL AND EXISTS (SELECT 1 FROM enrollment e WHERE e.id <> NEW.id AND e.student_id = NEW.student_id AND e.academic_year_id = NEW.academic_year_id AND e.deleted_at IS NULL
  AND e.start_date <= ifnull(NEW.end_date, '9999-12-31') AND NEW.start_date <= ifnull(e.end_date, '9999-12-31'))
BEGIN SELECT RAISE(ABORT, 'enrollment date range overlaps another enrollment of this student'); END;

CREATE TABLE attendance_record (
  id TEXT NOT NULL PRIMARY KEY CHECK(length(id) = 36 AND id = lower(id)),
  tenant_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL CHECK(created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at TEXT NOT NULL CHECK(updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at TEXT CHECK(deleted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  deleted_by TEXT,
  session_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  enrollment_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('present','absent','late','excused')),
  late_minutes INTEGER CHECK(late_minutes IS NULL OR late_minutes > 0),
  note TEXT,
  entered_late INTEGER NOT NULL DEFAULT 0 CHECK(entered_late IN (0,1)),
  recorded_by TEXT NOT NULL,
  CHECK(late_minutes IS NULL OR status = 'late'),
  FOREIGN KEY (session_id, group_id) REFERENCES session(id, group_id),
  FOREIGN KEY (enrollment_id, student_id, group_id) REFERENCES enrollment(id, student_id, group_id),
  FOREIGN KEY (group_id, branch_id) REFERENCES study_group(id, branch_id),
  FOREIGN KEY (tenant_id) REFERENCES association(id),
  CHECK((deleted_at IS NULL) = (deleted_by IS NULL))
) STRICT;
-- BR-011 is enforced by the two composite foreign keys above; BR-027 by this index.
CREATE UNIQUE INDEX ux_attendance_once ON attendance_record(session_id, student_id) WHERE deleted_at IS NULL;
-- BR-028: the session date must lie inside the enrollment's date range.
CREATE TRIGGER trg_attendance_in_range BEFORE INSERT ON attendance_record
WHEN NOT EXISTS (SELECT 1 FROM session s JOIN enrollment e ON e.id = NEW.enrollment_id
  WHERE s.id = NEW.session_id AND s.session_date >= e.start_date AND s.session_date <= ifnull(e.end_date, '9999-12-31'))
BEGIN SELECT RAISE(ABORT, 'session date is outside the enrollment range'); END;

CREATE TABLE attendance_correction (
  id TEXT NOT NULL PRIMARY KEY CHECK(length(id) = 36 AND id = lower(id)),
  tenant_id TEXT NOT NULL,
  attendance_id TEXT NOT NULL REFERENCES attendance_record(id),
  old_status TEXT NOT NULL CHECK(old_status IN ('present','absent','late','excused')),
  new_status TEXT NOT NULL CHECK(new_status IN ('present','absent','late','excused')),
  reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
  corrected_by TEXT NOT NULL,
  corrected_at TEXT NOT NULL CHECK(corrected_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  CHECK(old_status <> new_status)
) STRICT;
CREATE TRIGGER trg_attcorr_no_update BEFORE UPDATE ON attendance_correction BEGIN SELECT RAISE(ABORT, 'attendance_correction is append-only'); END;
CREATE TRIGGER trg_attcorr_no_delete BEFORE DELETE ON attendance_correction BEGIN SELECT RAISE(ABORT, 'attendance_correction is append-only'); END;

CREATE TABLE audit_log (
  seq INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, -- local ordering key only (DATABASE_DESIGN section 2 exception)
  id TEXT NOT NULL UNIQUE CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL,
  at TEXT NOT NULL CHECK(at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  branch_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  prev_hash TEXT NOT NULL CHECK(length(prev_hash) = 64),
  hash TEXT NOT NULL CHECK(length(hash) = 64)
) STRICT;
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END; -- BR-047
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

CREATE TRIGGER trg_association_no_delete BEFORE DELETE ON association BEGIN SELECT RAISE(ABORT, 'association: physical delete not allowed, use a tombstone'); END;
CREATE TRIGGER trg_association_envelope BEFORE UPDATE ON association
WHEN NEW.tenant_id <> OLD.tenant_id OR NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at OR NEW.created_by <> OLD.created_by OR NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'association: envelope violation (tenant, id and created_* are immutable; version must increase by 1)'); END;
CREATE TRIGGER trg_branch_no_delete BEFORE DELETE ON branch BEGIN SELECT RAISE(ABORT, 'branch: physical delete not allowed, use a tombstone'); END;
CREATE TRIGGER trg_branch_envelope BEFORE UPDATE ON branch
WHEN NEW.tenant_id <> OLD.tenant_id OR NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at OR NEW.created_by <> OLD.created_by OR NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'branch: envelope violation (tenant, id and created_* are immutable; version must increase by 1)'); END;
CREATE TRIGGER trg_academic_year_no_delete BEFORE DELETE ON academic_year BEGIN SELECT RAISE(ABORT, 'academic_year: physical delete not allowed, use a tombstone'); END;
CREATE TRIGGER trg_academic_year_envelope BEFORE UPDATE ON academic_year
WHEN NEW.tenant_id <> OLD.tenant_id OR NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at OR NEW.created_by <> OLD.created_by OR NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'academic_year: envelope violation (tenant, id and created_* are immutable; version must increase by 1)'); END;
CREATE TRIGGER trg_person_no_delete BEFORE DELETE ON person BEGIN SELECT RAISE(ABORT, 'person: physical delete not allowed, use a tombstone'); END;
CREATE TRIGGER trg_person_envelope BEFORE UPDATE ON person
WHEN NEW.tenant_id <> OLD.tenant_id OR NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at OR NEW.created_by <> OLD.created_by OR NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'person: envelope violation (tenant, id and created_* are immutable; version must increase by 1)'); END;
CREATE TRIGGER trg_student_no_delete BEFORE DELETE ON student BEGIN SELECT RAISE(ABORT, 'student: physical delete not allowed, use a tombstone'); END;
CREATE TRIGGER trg_student_envelope BEFORE UPDATE ON student
WHEN NEW.tenant_id <> OLD.tenant_id OR NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at OR NEW.created_by <> OLD.created_by OR NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'student: envelope violation (tenant, id and created_* are immutable; version must increase by 1)'); END;
CREATE TRIGGER trg_staff_member_no_delete BEFORE DELETE ON staff_member BEGIN SELECT RAISE(ABORT, 'staff_member: physical delete not allowed, use a tombstone'); END;
CREATE TRIGGER trg_staff_member_envelope BEFORE UPDATE ON staff_member
WHEN NEW.tenant_id <> OLD.tenant_id OR NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at OR NEW.created_by <> OLD.created_by OR NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'staff_member: envelope violation (tenant, id and created_* are immutable; version must increase by 1)'); END;
CREATE TRIGGER trg_user_account_no_delete BEFORE DELETE ON user_account BEGIN SELECT RAISE(ABORT, 'user_account: physical delete not allowed, use a tombstone'); END;
CREATE TRIGGER trg_user_account_envelope BEFORE UPDATE ON user_account
WHEN NEW.tenant_id <> OLD.tenant_id OR NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at OR NEW.created_by <> OLD.created_by OR NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'user_account: envelope violation (tenant, id and created_* are immutable; version must increase by 1)'); END;
CREATE TRIGGER trg_role_no_delete BEFORE DELETE ON role BEGIN SELECT RAISE(ABORT, 'role: physical delete not allowed, use a tombstone'); END;
CREATE TRIGGER trg_role_envelope BEFORE UPDATE ON role
WHEN NEW.tenant_id <> OLD.tenant_id OR NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at OR NEW.created_by <> OLD.created_by OR NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'role: envelope violation (tenant, id and created_* are immutable; version must increase by 1)'); END;
CREATE TRIGGER trg_role_permission_no_delete BEFORE DELETE ON role_permission BEGIN SELECT RAISE(ABORT, 'role_permission: physical delete not allowed, use a tombstone'); END;
CREATE TRIGGER trg_role_permission_envelope BEFORE UPDATE ON role_permission
WHEN NEW.tenant_id <> OLD.tenant_id OR NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at OR NEW.created_by <> OLD.created_by OR NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'role_permission: envelope violation (tenant, id and created_* are immutable; version must increase by 1)'); END;
CREATE TRIGGER trg_user_role_assignment_no_delete BEFORE DELETE ON user_role_assignment BEGIN SELECT RAISE(ABORT, 'user_role_assignment: physical delete not allowed, use a tombstone'); END;
CREATE TRIGGER trg_user_role_assignment_envelope BEFORE UPDATE ON user_role_assignment
WHEN NEW.tenant_id <> OLD.tenant_id OR NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at OR NEW.created_by <> OLD.created_by OR NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'user_role_assignment: envelope violation (tenant, id and created_* are immutable; version must increase by 1)'); END;
CREATE TRIGGER trg_study_group_no_delete BEFORE DELETE ON study_group BEGIN SELECT RAISE(ABORT, 'study_group: physical delete not allowed, use a tombstone'); END;
CREATE TRIGGER trg_study_group_envelope BEFORE UPDATE ON study_group
WHEN NEW.tenant_id <> OLD.tenant_id OR NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at OR NEW.created_by <> OLD.created_by OR NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'study_group: envelope violation (tenant, id and created_* are immutable; version must increase by 1)'); END;
CREATE TRIGGER trg_session_no_delete BEFORE DELETE ON session BEGIN SELECT RAISE(ABORT, 'session: physical delete not allowed, use a tombstone'); END;
CREATE TRIGGER trg_session_envelope BEFORE UPDATE ON session
WHEN NEW.tenant_id <> OLD.tenant_id OR NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at OR NEW.created_by <> OLD.created_by OR NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'session: envelope violation (tenant, id and created_* are immutable; version must increase by 1)'); END;
CREATE TRIGGER trg_enrollment_no_delete BEFORE DELETE ON enrollment BEGIN SELECT RAISE(ABORT, 'enrollment: physical delete not allowed, use a tombstone'); END;
CREATE TRIGGER trg_enrollment_envelope BEFORE UPDATE ON enrollment
WHEN NEW.tenant_id <> OLD.tenant_id OR NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at OR NEW.created_by <> OLD.created_by OR NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'enrollment: envelope violation (tenant, id and created_* are immutable; version must increase by 1)'); END;
CREATE TRIGGER trg_attendance_record_no_delete BEFORE DELETE ON attendance_record BEGIN SELECT RAISE(ABORT, 'attendance_record: physical delete not allowed, use a tombstone'); END;
CREATE TRIGGER trg_attendance_record_envelope BEFORE UPDATE ON attendance_record
WHEN NEW.tenant_id <> OLD.tenant_id OR NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at OR NEW.created_by <> OLD.created_by OR NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'attendance_record: envelope violation (tenant, id and created_* are immutable; version must increase by 1)'); END;
