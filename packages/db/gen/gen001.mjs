// One-off generator for migrations/001_init.sql (the SQL file is the source of truth; this is kept for review only).
import fs from 'node:fs';
const TS = (c) => `CHECK(${c} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')`;
const D = (c) => `CHECK(${c} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')`;
const ENV = `  id TEXT NOT NULL PRIMARY KEY CHECK(length(id) = 36 AND id = lower(id)),
  tenant_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL ${TS('created_at')},
  updated_at TEXT NOT NULL ${TS('updated_at')},
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at TEXT ${TS('deleted_at')},
  deleted_by TEXT`;
const TOMB = `  CHECK((deleted_at IS NULL) = (deleted_by IS NULL))`;
const tables = [];
const T = (name, cols) => { tables.push(name); return `CREATE TABLE ${name} (\n${ENV},\n${cols},\n${TOMB}\n) STRICT;\n`; };
const A = `FOREIGN KEY (tenant_id) REFERENCES association(id)`;

let sql = `-- 001_init: Phase 1 foundation schema. Forward-only. Row envelope per DATABASE_DESIGN section 2.
-- Dates YYYY-MM-DD, timestamps UTC ISO-8601 with milliseconds.

CREATE TABLE schema_migration (
  version INTEGER NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  checksum TEXT NOT NULL
) STRICT;

`;
sql += T('association', `  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  timezone TEXT NOT NULL DEFAULT 'Africa/Algiers',
  logo_ref TEXT, address TEXT, contact TEXT,
  CHECK(id = tenant_id)`) + '\n';

sql += T('branch', `  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  label TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  ${A}`) + `CREATE UNIQUE INDEX ux_branch_name ON branch(tenant_id, name) WHERE deleted_at IS NULL;\n\n`;

sql += T('academic_year', `  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  start_date TEXT NOT NULL ${D('start_date')},
  end_date TEXT NOT NULL ${D('end_date')},
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','active','closed')),
  CHECK(start_date < end_date),
  ${A}`) + `CREATE UNIQUE INDEX ux_year_one_active ON academic_year(tenant_id) WHERE status = 'active' AND deleted_at IS NULL; -- BR-016
CREATE UNIQUE INDEX ux_year_name ON academic_year(tenant_id, name) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_year_no_overlap_ins BEFORE INSERT ON academic_year
WHEN NEW.deleted_at IS NULL AND EXISTS (SELECT 1 FROM academic_year y WHERE y.tenant_id = NEW.tenant_id AND y.deleted_at IS NULL AND y.start_date <= NEW.end_date AND NEW.start_date <= y.end_date)
BEGIN SELECT RAISE(ABORT, 'academic_year overlaps an existing year'); END;
CREATE TRIGGER trg_year_no_overlap_upd BEFORE UPDATE OF start_date, end_date, deleted_at ON academic_year
WHEN NEW.deleted_at IS NULL AND EXISTS (SELECT 1 FROM academic_year y WHERE y.tenant_id = NEW.tenant_id AND y.id <> NEW.id AND y.deleted_at IS NULL AND y.start_date <= NEW.end_date AND NEW.start_date <= y.end_date)
BEGIN SELECT RAISE(ABORT, 'academic_year overlaps an existing year'); END;

`;

sql += T('person', `  given_name TEXT NOT NULL CHECK(length(trim(given_name)) > 0),
  family_name TEXT NOT NULL CHECK(length(trim(family_name)) > 0),
  display_name_latin TEXT,
  gender TEXT CHECK(gender IN ('male','female')),
  birth_date TEXT ${D('birth_date')},
  phone TEXT, address TEXT,
  ${A}`) + '\n';

sql += T('student', `  person_id TEXT NOT NULL REFERENCES person(id),
  student_no TEXT NOT NULL CHECK(length(trim(student_no)) > 0),
  branch_id TEXT NOT NULL REFERENCES branch(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('applicant','active','suspended','completed','withdrawn')),
  joined_on TEXT ${D('joined_on')},
  archived_at TEXT ${TS('archived_at')},
  archive_reason TEXT,
  CHECK((archived_at IS NULL) = (archive_reason IS NULL)),
  ${A}`) + `CREATE UNIQUE INDEX ux_student_person ON student(person_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_student_no ON student(tenant_id, student_no) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_student_id_branch ON student(id, branch_id);

`;

sql += T('staff_member', `  person_id TEXT NOT NULL REFERENCES person(id),
  kind TEXT NOT NULL CHECK(kind IN ('employee','volunteer')),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  ${A}`) + `CREATE UNIQUE INDEX ux_staff_person ON staff_member(person_id) WHERE deleted_at IS NULL;\n\n`;

sql += T('user_account', `  staff_member_id TEXT NOT NULL REFERENCES staff_member(id),
  username TEXT NOT NULL CHECK(length(trim(username)) > 0),
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK(failed_attempts >= 0),
  locked_until TEXT ${TS('locked_until')},
  last_login_at TEXT ${TS('last_login_at')},
  ${A}`) + `CREATE UNIQUE INDEX ux_user_username ON user_account(tenant_id, lower(username)) WHERE deleted_at IS NULL;\n\n`;

sql += T('role', `  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  is_system INTEGER NOT NULL DEFAULT 0 CHECK(is_system IN (0,1)),
  ${A}`) + `CREATE UNIQUE INDEX ux_role_name ON role(tenant_id, name) WHERE deleted_at IS NULL;\n\n`;

sql += T('role_permission', `  role_id TEXT NOT NULL REFERENCES role(id),
  permission_code TEXT NOT NULL CHECK(length(trim(permission_code)) > 0),
  ${A}`) + `CREATE UNIQUE INDEX ux_role_perm ON role_permission(role_id, permission_code) WHERE deleted_at IS NULL;\n\n`;

sql += T('user_role_assignment', `  user_id TEXT NOT NULL REFERENCES user_account(id),
  role_id TEXT NOT NULL REFERENCES role(id),
  branch_id TEXT REFERENCES branch(id), -- NULL = all branches (Director only; enforced in the domain, OD-003)
  ${A}`) + `CREATE UNIQUE INDEX ux_ura ON user_role_assignment(user_id, role_id, ifnull(branch_id, '')) WHERE deleted_at IS NULL;\n\n`;

sql += T('study_group', `  branch_id TEXT NOT NULL REFERENCES branch(id),
  academic_year_id TEXT NOT NULL REFERENCES academic_year(id),
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  level TEXT,
  capacity INTEGER NOT NULL CHECK(capacity > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed')),
  ${A}`) + `CREATE UNIQUE INDEX ux_group_name ON study_group(branch_id, academic_year_id, name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_group_id_branch ON study_group(id, branch_id);
CREATE UNIQUE INDEX ux_group_id_year ON study_group(id, academic_year_id);

`;

sql += T('session', `  group_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  session_date TEXT NOT NULL ${D('session_date')},
  start_time TEXT NOT NULL CHECK(start_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  end_time TEXT NOT NULL CHECK(end_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','held','cancelled')),
  cancel_reason TEXT,
  confirmed_at TEXT ${TS('confirmed_at')},
  confirmed_by TEXT,
  CHECK(start_time < end_time),
  CHECK(status <> 'cancelled' OR length(trim(ifnull(cancel_reason, ''))) > 0),
  FOREIGN KEY (group_id, branch_id) REFERENCES study_group(id, branch_id),
  ${A}`) + `CREATE UNIQUE INDEX ux_session_slot ON session(group_id, session_date, start_time) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_session_id_group ON session(id, group_id);

`;

const overlap = (pfx) => `WHEN NEW.deleted_at IS NULL AND EXISTS (SELECT 1 FROM enrollment e WHERE ${pfx}e.student_id = NEW.student_id AND e.academic_year_id = NEW.academic_year_id AND e.deleted_at IS NULL
  AND e.start_date <= ifnull(NEW.end_date, '9999-12-31') AND NEW.start_date <= ifnull(e.end_date, '9999-12-31'))
BEGIN SELECT RAISE(ABORT, 'enrollment date range overlaps another enrollment of this student'); END;`;
sql += T('enrollment', `  student_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  academic_year_id TEXT NOT NULL,
  start_date TEXT NOT NULL ${D('start_date')},
  end_date TEXT ${D('end_date')},
  end_reason TEXT,
  transferred_to_id TEXT REFERENCES enrollment(id),
  CHECK(end_date IS NULL OR end_date >= start_date),
  FOREIGN KEY (student_id, branch_id) REFERENCES student(id, branch_id),
  FOREIGN KEY (group_id, branch_id) REFERENCES study_group(id, branch_id),
  FOREIGN KEY (group_id, academic_year_id) REFERENCES study_group(id, academic_year_id),
  ${A}`) + `-- BR-001: at most one open enrollment per student per academic year.
CREATE UNIQUE INDEX ux_enrollment_one_open ON enrollment(student_id, academic_year_id) WHERE end_date IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX ux_enrollment_composite ON enrollment(id, student_id, group_id);
-- BR-002: no overlapping date ranges for the same student and year.
CREATE TRIGGER trg_enrollment_no_overlap_ins BEFORE INSERT ON enrollment
${overlap('')}
CREATE TRIGGER trg_enrollment_no_overlap_upd BEFORE UPDATE OF start_date, end_date, deleted_at ON enrollment
${overlap('e.id <> NEW.id AND ')}

`;

sql += T('attendance_record', `  session_id TEXT NOT NULL,
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
  ${A}`) + `-- BR-011 is enforced by the two composite foreign keys above; BR-027 by this index.
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
  corrected_at TEXT NOT NULL ${TS('corrected_at')},
  CHECK(old_status <> new_status)
) STRICT;
CREATE TRIGGER trg_attcorr_no_update BEFORE UPDATE ON attendance_correction BEGIN SELECT RAISE(ABORT, 'attendance_correction is append-only'); END;
CREATE TRIGGER trg_attcorr_no_delete BEFORE DELETE ON attendance_correction BEGIN SELECT RAISE(ABORT, 'attendance_correction is append-only'); END;

CREATE TABLE audit_log (
  seq INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, -- local ordering key only (DATABASE_DESIGN section 2 exception)
  id TEXT NOT NULL UNIQUE CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL,
  at TEXT NOT NULL ${TS('at')},
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

`;

for (const t of tables) {
  sql += `CREATE TRIGGER trg_${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, '${t}: physical delete not allowed, use a tombstone'); END;
CREATE TRIGGER trg_${t}_envelope BEFORE UPDATE ON ${t}
WHEN NEW.tenant_id <> OLD.tenant_id OR NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at OR NEW.created_by <> OLD.created_by OR NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT, '${t}: envelope violation (tenant, id and created_* are immutable; version must increase by 1)'); END;
`;
}
fs.writeFileSync(new URL('../migrations/001_init.sql', import.meta.url), sql);
console.log('tables with envelope:', tables.length, 'bytes:', sql.length);
