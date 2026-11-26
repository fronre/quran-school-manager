import { authorize, type Permission } from '@mishkat/domain';
import { appendAudit, newId, nowIso } from './index';
import type { Ctx } from './students';

/** Groups (الأفواج): a group belongs to one branch and one academic year, has capacity, any number of teachers, and students enrolled in it.
 *  Invariants live in the schema (BR-001/002/011); this module adds authorization, validation and audit.
 *  Capacity is advisory: going over it is allowed but reported (OD-041). Closing a group needs it to be empty (OD-041). */
export type GroupFail = 'forbidden' | 'not_found' | 'invalid' | 'no_active_year' | 'duplicate_name' | 'conflict' | 'closed' | 'has_members'
  | 'student_not_found' | 'student_not_active' | 'already_enrolled' | 'not_enrolled' | 'same_group' | 'same_day' | 'staff_not_found' | 'already_assigned' | 'not_assigned' | 'reason_required';
export type GroupResult<T = object> = ({ ok: true } & T) | { ok: false; error: GroupFail };

export interface GroupInput { branchId: string; name: string; level: string | null; capacity: number }
export interface GroupRow {
  id: string; branchId: string; branchName: string; yearName: string; name: string; level: string | null; capacity: number; status: 'active' | 'closed';
  members: number; teachers: { id: string; name: string }[]; version: number;
}
export interface MemberRow { enrollmentId: string; studentId: string; studentNo: string; name: string; since: string }

const clock = (c: Ctx) => (c.now ?? nowIso)();
const today = (c: Ctx) => clock(c).slice(0, 10);
const roleOf = (c: Ctx) => c.assignments.map((a) => a.role).join(',') || 'none';
const canSee = (c: Ctx, branch: string) => (['group.view', 'enrollment.manage', 'group.edit'] as Permission[]).some((p) => authorize(c.assignments, p, branch).allowed);
const dayBefore = (d: string) => new Date(Date.parse(d + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);

const activeYear = (c: Ctx) => c.db.prepare("SELECT id, name FROM academic_year WHERE tenant_id = ? AND status = 'active' AND deleted_at IS NULL").get(c.tenantId) as { id: string; name: string } | undefined;

const BASE = `SELECT g.id, g.branch_id AS branchId, b.name AS branchName, y.name AS yearName, g.name, g.level, g.capacity, g.status, g.version,
  (SELECT count(*) FROM enrollment e WHERE e.group_id = g.id AND e.end_date IS NULL AND e.deleted_at IS NULL) AS members
  FROM study_group g JOIN branch b ON b.id = g.branch_id JOIN academic_year y ON y.id = g.academic_year_id`;
type Raw = Omit<GroupRow, 'teachers'>;
function withTeachers(c: Ctx, rows: Raw[]): GroupRow[] {
  const q = c.db.prepare(`SELECT m.id, p.given_name || ' ' || p.family_name AS name FROM group_teacher t JOIN staff_member m ON m.id = t.staff_member_id JOIN person p ON p.id = m.person_id
    WHERE t.group_id = ? AND t.deleted_at IS NULL ORDER BY p.search_key`);
  return rows.map((r) => ({ ...r, teachers: q.all(r.id) as { id: string; name: string }[] }));
}

/** Groups of the active year in the caller's branches. */
export function listGroups(c: Ctx, q: { branchId?: string; status?: 'active' | 'closed' | 'all' } = {}): GroupRow[] {
  const y = activeYear(c); if (!y) return [];
  const where = ['g.deleted_at IS NULL', 'g.tenant_id = ?', 'g.academic_year_id = ?']; const p: unknown[] = [c.tenantId, y.id];
  if (q.branchId) { where.push('g.branch_id = ?'); p.push(q.branchId); }
  if ((q.status ?? 'active') !== 'all') { where.push('g.status = ?'); p.push(q.status ?? 'active'); }
  const rows = (c.db.prepare(`${BASE} WHERE ${where.join(' AND ')} ORDER BY b.position, g.name`).all(...p) as Raw[]).filter((r) => canSee(c, r.branchId));
  return withTeachers(c, rows);
}

export function getGroup(c: Ctx, id: string): { group: GroupRow; members: MemberRow[] } | null {
  const r = c.db.prepare(`${BASE} WHERE g.id = ? AND g.tenant_id = ? AND g.deleted_at IS NULL`).get(id, c.tenantId) as Raw | undefined;
  if (!r || !canSee(c, r.branchId)) return null; // out of scope looks absent
  const members = c.db.prepare(`SELECT e.id AS enrollmentId, s.id AS studentId, s.student_no AS studentNo, p.given_name || ' ' || p.family_name AS name, e.start_date AS since
    FROM enrollment e JOIN student s ON s.id = e.student_id JOIN person p ON p.id = s.person_id
    WHERE e.group_id = ? AND e.end_date IS NULL AND e.deleted_at IS NULL ORDER BY p.search_key`).all(id) as MemberRow[];
  return { group: withTeachers(c, [r])[0]!, members };
}

function validate(i: GroupInput): boolean {
  const name = i.name.trim();
  return name.length > 0 && [...name].length <= 120 && (i.level === null || [...i.level.trim()].length <= 120) && Number.isInteger(i.capacity) && i.capacity >= 1 && i.capacity <= 500;
}

export function createGroup(c: Ctx, i: GroupInput): GroupResult<{ id: string }> {
  if (!authorize(c.assignments, 'group.edit', i.branchId).allowed) return { ok: false, error: 'forbidden' };
  if (!validate(i)) return { ok: false, error: 'invalid' };
  const y = activeYear(c); if (!y) return { ok: false, error: 'no_active_year' };
  if (!c.db.prepare('SELECT 1 FROM branch WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL AND active = 1').get(i.branchId, c.tenantId)) return { ok: false, error: 'not_found' };
  const name = i.name.trim(), level = i.level?.trim() || null;
  if (c.db.prepare('SELECT 1 FROM study_group WHERE branch_id = ? AND academic_year_id = ? AND name = ? AND deleted_at IS NULL').get(i.branchId, y.id, name)) return { ok: false, error: 'duplicate_name' };
  const id = newId(), now = clock(c);
  c.db.transaction(() => {
    c.db.prepare('INSERT INTO study_group(id,tenant_id,created_at,updated_at,created_by,updated_by,branch_id,academic_year_id,name,level,capacity) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, c.tenantId, now, now, c.actorId, c.actorId, i.branchId, y.id, name, level, i.capacity);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: i.branchId, action: 'group.create', entity_type: 'study_group', entity_id: id, before_json: null, after_json: JSON.stringify({ name, level, capacity: i.capacity }), reason: null });
  })();
  return { ok: true, id };
}

export function updateGroup(c: Ctx, id: string, expectedVersion: number, i: { name: string; level: string | null; capacity: number }): GroupResult {
  const cur = getGroup(c, id)?.group; if (!cur) return { ok: false, error: 'not_found' };
  if (!authorize(c.assignments, 'group.edit', cur.branchId).allowed) return { ok: false, error: 'forbidden' };
  if (!validate({ ...i, branchId: cur.branchId })) return { ok: false, error: 'invalid' };
  if (cur.version !== expectedVersion) return { ok: false, error: 'conflict' };
  const name = i.name.trim(), level = i.level?.trim() || null;
  if (c.db.prepare('SELECT 1 FROM study_group g WHERE g.branch_id = ? AND g.academic_year_id = (SELECT academic_year_id FROM study_group WHERE id = ?) AND g.name = ? AND g.id <> ? AND g.deleted_at IS NULL').get(cur.branchId, id, name, id)) return { ok: false, error: 'duplicate_name' };
  const now = clock(c);
  c.db.transaction(() => {
    c.db.prepare('UPDATE study_group SET name=?, level=?, capacity=?, updated_at=?, updated_by=?, version=version+1 WHERE id=?').run(name, level, i.capacity, now, c.actorId, id);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: cur.branchId, action: 'group.update', entity_type: 'study_group', entity_id: id,
      before_json: JSON.stringify({ name: cur.name, level: cur.level, capacity: cur.capacity }), after_json: JSON.stringify({ name, level, capacity: i.capacity }), reason: null });
  })();
  return { ok: true };
}

/** Close or reopen a group. Closing requires an empty group so no student is left in a group that no longer meets. */
export function setGroupStatus(c: Ctx, id: string, status: 'active' | 'closed'): GroupResult {
  const g = getGroup(c, id); if (!g) return { ok: false, error: 'not_found' };
  if (!authorize(c.assignments, 'group.edit', g.group.branchId).allowed) return { ok: false, error: 'forbidden' };
  if (g.group.status === status) return { ok: true };
  if (status === 'closed' && g.members.length) return { ok: false, error: 'has_members' };
  const now = clock(c);
  c.db.transaction(() => {
    c.db.prepare('UPDATE study_group SET status=?, updated_at=?, updated_by=?, version=version+1 WHERE id=?').run(status, now, c.actorId, id);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: g.group.branchId, action: status === 'closed' ? 'group.close' : 'group.reopen', entity_type: 'study_group', entity_id: id, before_json: null, after_json: null, reason: null });
  })();
  return { ok: true };
}

// ---------------- teachers ----------------
export function assignTeacher(c: Ctx, groupId: string, staffId: string): GroupResult {
  const g = getGroup(c, groupId)?.group; if (!g) return { ok: false, error: 'not_found' };
  if (!authorize(c.assignments, 'group.edit', g.branchId).allowed) return { ok: false, error: 'forbidden' };
  if (g.status === 'closed') return { ok: false, error: 'closed' };
  const s = c.db.prepare("SELECT 1 FROM staff_member WHERE id = ? AND tenant_id = ? AND branch_id = ? AND position = 'teacher' AND archived_at IS NULL AND deleted_at IS NULL").get(staffId, c.tenantId, g.branchId);
  if (!s) return { ok: false, error: 'staff_not_found' }; // wrong branch, not a teacher or archived all look the same
  if (c.db.prepare('SELECT 1 FROM group_teacher WHERE group_id = ? AND staff_member_id = ? AND deleted_at IS NULL').get(groupId, staffId)) return { ok: false, error: 'already_assigned' };
  const id = newId(), now = clock(c);
  c.db.transaction(() => {
    c.db.prepare('INSERT INTO group_teacher(id,tenant_id,created_at,updated_at,created_by,updated_by,group_id,staff_member_id,branch_id) VALUES (?,?,?,?,?,?,?,?,?)').run(id, c.tenantId, now, now, c.actorId, c.actorId, groupId, staffId, g.branchId);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: g.branchId, action: 'group.teacher_add', entity_type: 'study_group', entity_id: groupId, before_json: null, after_json: JSON.stringify({ staffId }), reason: null });
  })();
  return { ok: true };
}

export function removeTeacher(c: Ctx, groupId: string, staffId: string): GroupResult {
  const g = getGroup(c, groupId)?.group; if (!g) return { ok: false, error: 'not_found' };
  if (!authorize(c.assignments, 'group.edit', g.branchId).allowed) return { ok: false, error: 'forbidden' };
  const row = c.db.prepare('SELECT id FROM group_teacher WHERE group_id = ? AND staff_member_id = ? AND deleted_at IS NULL').get(groupId, staffId) as { id: string } | undefined;
  if (!row) return { ok: false, error: 'not_assigned' };
  const now = clock(c);
  c.db.transaction(() => {
    c.db.prepare('UPDATE group_teacher SET deleted_at=?, deleted_by=?, updated_at=?, updated_by=?, version=version+1 WHERE id=?').run(now, c.actorId, now, c.actorId, row.id);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: g.branchId, action: 'group.teacher_remove', entity_type: 'study_group', entity_id: groupId, before_json: JSON.stringify({ staffId }), after_json: null, reason: null });
  })();
  return { ok: true };
}

/** Teachers a group of this branch can take (active teachers of the branch not yet on it). */
export function assignableTeachers(c: Ctx, groupId: string): { id: string; name: string }[] {
  const g = getGroup(c, groupId)?.group; if (!g || !authorize(c.assignments, 'group.edit', g.branchId).allowed) return [];
  return c.db.prepare(`SELECT m.id, p.given_name || ' ' || p.family_name AS name FROM staff_member m JOIN person p ON p.id = m.person_id
    WHERE m.tenant_id = ? AND m.branch_id = ? AND m.position = 'teacher' AND m.archived_at IS NULL AND m.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM group_teacher t WHERE t.group_id = ? AND t.staff_member_id = m.id AND t.deleted_at IS NULL) ORDER BY p.search_key`).all(c.tenantId, g.branchId, groupId) as { id: string; name: string }[];
}

/** The groups a teacher leads (for the teacher's profile). */
export function groupsOfTeacher(c: Ctx, staffId: string): { id: string; name: string; branchName: string; members: number }[] {
  const mine = listGroups(c, { status: 'all' }); const ids = new Set((c.db.prepare('SELECT group_id AS g FROM group_teacher WHERE staff_member_id = ? AND deleted_at IS NULL').all(staffId) as { g: string }[]).map((r) => r.g));
  return mine.filter((g) => ids.has(g.id)).map((g) => ({ id: g.id, name: g.name, branchName: g.branchName, members: g.members }));
}

// ---------------- students ----------------
/** Active students of a branch with no open enrollment this year: the people still waiting for a group. */
export function unassignedStudents(c: Ctx, branchId: string, search = ''): { id: string; studentNo: string; name: string }[] {
  if (!authorize(c.assignments, 'enrollment.manage', branchId).allowed) return [];
  const y = activeYear(c); if (!y) return [];
  const words = search.trim().split(/\s+/).filter(Boolean);
  return c.db.prepare(`SELECT s.id, s.student_no AS studentNo, p.given_name || ' ' || p.family_name AS name FROM student s JOIN person p ON p.id = s.person_id
    WHERE s.tenant_id = ? AND s.branch_id = ? AND s.status = 'active' AND s.archived_at IS NULL AND s.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM enrollment e WHERE e.student_id = s.id AND e.academic_year_id = ? AND e.end_date IS NULL AND e.deleted_at IS NULL)
      ${words.map(() => "AND p.search_key LIKE ? ESCAPE '\\'").join(' ')} ORDER BY p.search_key LIMIT 200`)
    .all(c.tenantId, branchId, y.id, ...words.map((w) => '%' + w.replace(/[\\%_]/g, (m) => '\\' + m) + '%')) as { id: string; studentNo: string; name: string }[];
}

function openEnrollment(c: Ctx, studentId: string, yearId: string) {
  return c.db.prepare('SELECT id, group_id AS groupId, start_date AS startDate FROM enrollment WHERE student_id = ? AND academic_year_id = ? AND end_date IS NULL AND deleted_at IS NULL').get(studentId, yearId) as { id: string; groupId: string; startDate: string } | undefined;
}

/** Enrolls a student in a group, or moves him from his current group (history is kept: the old enrollment ends the day before). */
export function enrollStudent(c: Ctx, groupId: string, studentId: string, mode: 'enroll' | 'transfer' = 'enroll'): GroupResult<{ enrollmentId: string }> {
  const g = getGroup(c, groupId)?.group; if (!g) return { ok: false, error: 'not_found' };
  if (!authorize(c.assignments, 'enrollment.manage', g.branchId).allowed) return { ok: false, error: 'forbidden' };
  if (g.status === 'closed') return { ok: false, error: 'closed' };
  const s = c.db.prepare('SELECT status, archived_at AS archivedAt FROM student WHERE id = ? AND tenant_id = ? AND branch_id = ? AND deleted_at IS NULL').get(studentId, c.tenantId, g.branchId) as { status: string; archivedAt: string | null } | undefined;
  if (!s) return { ok: false, error: 'student_not_found' }; // other branch looks absent too
  if (s.archivedAt || s.status !== 'active') return { ok: false, error: 'student_not_active' };
  const y = activeYear(c); if (!y) return { ok: false, error: 'no_active_year' };
  const cur = openEnrollment(c, studentId, y.id); const now = clock(c), t = today(c); const id = newId();
  if (cur && cur.groupId === groupId) return { ok: false, error: 'same_group' };
  if (cur && mode === 'enroll') return { ok: false, error: 'already_enrolled' };
  const lastEnd = (c.db.prepare('SELECT max(end_date) AS d FROM enrollment WHERE student_id = ? AND academic_year_id = ? AND deleted_at IS NULL AND end_date IS NOT NULL').get(studentId, y.id) as { d: string | null }).d;
  if (!cur && lastEnd && lastEnd >= t) return { ok: false, error: 'same_day' }; // left a group today: enrolling again starts tomorrow (no overlapping ranges, BR-002)
  if (cur && cur.startDate >= t) return { ok: false, error: 'same_day' }; // would produce an empty or overlapping enrollment; try tomorrow
  c.db.transaction(() => {
    if (cur) {
      const to = dayBefore(t);
      c.db.prepare('UPDATE enrollment SET end_date=?, end_reason=?, transferred_to_id=NULL, updated_at=?, updated_by=?, version=version+1 WHERE id=?').run(to, 'transfer', now, c.actorId, cur.id);
    }
    c.db.prepare('INSERT INTO enrollment(id,tenant_id,created_at,updated_at,created_by,updated_by,student_id,group_id,branch_id,academic_year_id,start_date) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, c.tenantId, now, now, c.actorId, c.actorId, studentId, groupId, g.branchId, y.id, t);
    if (cur) c.db.prepare('UPDATE enrollment SET transferred_to_id=?, version=version+1 WHERE id=?').run(id, cur.id);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: g.branchId, action: cur ? 'enrollment.transfer' : 'enrollment.create', entity_type: 'student', entity_id: studentId,
      before_json: cur ? JSON.stringify({ groupId: cur.groupId }) : null, after_json: JSON.stringify({ groupId, enrollmentId: id }), reason: null });
  })();
  return { ok: true, enrollmentId: id };
}

/** Ends the student's membership in the group (the record stays; only an end date and a reason are added). */
export function leaveGroup(c: Ctx, groupId: string, studentId: string, reason: string): GroupResult {
  const g = getGroup(c, groupId)?.group; if (!g) return { ok: false, error: 'not_found' };
  if (!authorize(c.assignments, 'enrollment.manage', g.branchId).allowed) return { ok: false, error: 'forbidden' };
  const why = reason.trim(); if (!why || [...why].length > 300) return { ok: false, error: 'reason_required' };
  const e = c.db.prepare('SELECT id, start_date AS startDate FROM enrollment WHERE student_id = ? AND group_id = ? AND end_date IS NULL AND deleted_at IS NULL').get(studentId, groupId) as { id: string; startDate: string } | undefined;
  if (!e) return { ok: false, error: 'not_enrolled' };
  const now = clock(c); const end = today(c) > e.startDate ? dayBefore(today(c)) : e.startDate; // an enrollment never ends before it starts
  c.db.transaction(() => {
    c.db.prepare('UPDATE enrollment SET end_date=?, end_reason=?, updated_at=?, updated_by=?, version=version+1 WHERE id=?').run(end, why, now, c.actorId, e.id);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: g.branchId, action: 'enrollment.end', entity_type: 'student', entity_id: studentId, before_json: JSON.stringify({ groupId }), after_json: null, reason: why });
  })();
  return { ok: true };
}

/** The group a student is in now, plus past groups this year, for the student's profile. */
export function studentGroups(c: Ctx, studentId: string): { current: { groupId: string; name: string; since: string } | null; past: { name: string; from: string; to: string }[] } | null {
  const s = c.db.prepare('SELECT branch_id AS b FROM student WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(studentId, c.tenantId) as { b: string } | undefined;
  if (!s || !authorize(c.assignments, 'student.view', s.b).allowed) return null;
  const rows = c.db.prepare('SELECT g.id AS gid, g.name, e.start_date AS f, e.end_date AS t FROM enrollment e JOIN study_group g ON g.id = e.group_id WHERE e.student_id = ? AND e.deleted_at IS NULL ORDER BY e.start_date DESC').all(studentId) as { gid: string; name: string; f: string; t: string | null }[];
  const cur = rows.find((r) => r.t === null);
  return { current: cur ? { groupId: cur.gid, name: cur.name, since: cur.f } : null, past: rows.filter((r) => r.t !== null).map((r) => ({ name: r.name, from: r.f, to: r.t! })) };
}
