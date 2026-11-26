import { authorize, branchFilter, fullNameKey, validateStudent, STUDENT_STATUSES, type Assignment, type StudentInput, type StudentIssue, type StudentStatus } from '@mishkat/domain';
import { appendAudit, newId, nowIso, type Db } from './index';

/** Student use cases (REQ-010, 013, 014; BR-014, 019, 021, 022, 023). Every function re-checks authorization from the
 *  caller's assignments; records outside the caller's branches look like they do not exist (SEC-021). */
export interface Ctx { db: Db; tenantId: string; actorId: string; assignments: Assignment[]; now?: () => string }

export interface StudentRow {
  id: string; studentNo: string; givenName: string; familyName: string; birthDate: string | null; phone: string | null;
  branchId: string; branchName: string; status: StudentStatus; joinedOn: string | null;
  archivedAt: string | null; archiveReason: string | null; version: number;
}
export type Fail = 'forbidden' | 'not_found' | 'invalid' | 'duplicate_number' | 'duplicates' | 'branch_not_found' | 'conflict' | 'has_enrollments' | 'archived' | 'already_archived' | 'not_archived' | 'reason_required';
export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: Fail; issues?: StudentIssue[]; duplicates?: StudentRow[] };

const SELECT = `SELECT s.id, s.student_no AS studentNo, p.given_name AS givenName, p.family_name AS familyName, p.birth_date AS birthDate, p.phone AS phone,
  s.branch_id AS branchId, b.name AS branchName, s.status AS status, s.joined_on AS joinedOn, s.archived_at AS archivedAt, s.archive_reason AS archiveReason, s.version AS version
  FROM student s JOIN person p ON p.id = s.person_id JOIN branch b ON b.id = s.branch_id`;

const clock = (c: Ctx) => (c.now ?? nowIso)();
const roleOf = (c: Ctx) => c.assignments.map((a) => a.role).join(',') || 'none';
const like = (s: string) => '%' + s.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

export interface ListQuery { search?: string; branchId?: string; status?: StudentStatus; archived?: 'active' | 'archived' | 'all'; limit?: number; offset?: number }

export function listStudents(c: Ctx, q: ListQuery = {}): { rows: StudentRow[]; total: number } {
  const f = branchFilter(c.assignments, 'student.view');
  if (f.kind === 'none') return { rows: [], total: 0 };
  const where = ['s.deleted_at IS NULL', 's.tenant_id = ?']; const p: unknown[] = [c.tenantId];
  if (f.kind === 'branches') { where.push(`s.branch_id IN (${f.ids.map(() => '?').join(',')})`); p.push(...f.ids); }
  if (q.branchId) {
    if (f.kind === 'branches' && !f.ids.includes(q.branchId)) return { rows: [], total: 0 };
    where.push('s.branch_id = ?'); p.push(q.branchId);
  }
  if (q.status && (STUDENT_STATUSES as readonly string[]).includes(q.status)) { where.push('s.status = ?'); p.push(q.status); }
  const arch = q.archived ?? 'active';
  if (arch === 'active') where.push('s.archived_at IS NULL'); else if (arch === 'archived') where.push('s.archived_at IS NOT NULL');
  const term = q.search?.trim();
  if (term) {
    // every word must appear (in any order) in the normalized name, or the whole term is part of the student number
    const words = fullNameKey(term, '').split(' ').filter(Boolean);
    const nameMatch = words.map(() => "p.search_key LIKE ? ESCAPE '\\'").join(' AND ') || '1=1';
    where.push(`((${nameMatch}) OR s.student_no LIKE ? ESCAPE '\\')`); p.push(...words.map(like), like(term));
  }
  const w = where.join(' AND ');
  const total = (c.db.prepare(`SELECT count(*) n FROM student s JOIN person p ON p.id = s.person_id WHERE ${w}`).get(...p) as { n: number }).n;
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 500), offset = Math.max(q.offset ?? 0, 0);
  const rows = c.db.prepare(`${SELECT} WHERE ${w} ORDER BY p.search_key, s.student_no LIMIT ? OFFSET ?`).all(...p, limit, offset) as StudentRow[];
  return { rows, total };
}

export function studentCounts(c: Ctx, branchId?: string): { active: number; archived: number } {
  const f = branchFilter(c.assignments, 'student.view');
  if (f.kind === 'none') return { active: 0, archived: 0 };
  if (branchId && f.kind === 'branches' && !f.ids.includes(branchId)) return { active: 0, archived: 0 };
  const scope = (f.kind === 'branches' ? ` AND branch_id IN (${f.ids.map(() => '?').join(',')})` : '') + (branchId ? ' AND branch_id = ?' : '');
  const args: string[] = [...(f.kind === 'branches' ? f.ids : []), ...(branchId ? [branchId] : [])];
  const r = c.db.prepare(`SELECT sum(archived_at IS NULL) a, sum(archived_at IS NOT NULL) z FROM student WHERE deleted_at IS NULL AND tenant_id = ?${scope}`).get(c.tenantId, ...args) as { a: number | null; z: number | null };
  return { active: r.a ?? 0, archived: r.z ?? 0 };
}

function load(c: Ctx, id: string): StudentRow | null {
  const r = c.db.prepare(`${SELECT} WHERE s.id = ? AND s.tenant_id = ? AND s.deleted_at IS NULL`).get(id, c.tenantId) as StudentRow | undefined;
  if (!r || !authorize(c.assignments, 'student.view', r.branchId).allowed) return null; // out of scope = not found
  return r;
}
export const getStudent = (c: Ctx, id: string): StudentRow | null => load(c, id);

/** Next free numeric student number, offered as a default; the user may type another one. */
export function nextStudentNo(c: Ctx): string {
  const r = c.db.prepare("SELECT max(CAST(student_no AS INTEGER)) m FROM student WHERE tenant_id = ? AND student_no NOT GLOB '*[^0-9]*' AND student_no <> ''").get(c.tenantId) as { m: number | null };
  return String((r.m ?? 0) + 1).padStart(4, '0');
}

/** BR-023: same normalized name and birth date among students the caller may see (never reveals other branches). */
export function findDuplicates(c: Ctx, i: Pick<StudentInput, 'givenName' | 'familyName' | 'birthDate'>, excludeId?: string): StudentRow[] {
  if (!i.birthDate) return [];
  const f = branchFilter(c.assignments, 'student.view'); if (f.kind === 'none') return [];
  const scope = f.kind === 'branches' ? ` AND s.branch_id IN (${f.ids.map(() => '?').join(',')})` : '';
  const args = f.kind === 'branches' ? f.ids : [];
  return c.db.prepare(`${SELECT} WHERE s.tenant_id = ? AND s.deleted_at IS NULL AND p.search_key = ? AND p.birth_date = ? AND s.id <> ?${scope}`)
    .all(c.tenantId, fullNameKey(i.givenName, i.familyName), i.birthDate, excludeId ?? '', ...args) as StudentRow[];
}

const branchOk = (c: Ctx, branchId: string) => !!c.db.prepare('SELECT 1 FROM branch WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL AND active = 1').get(branchId, c.tenantId);
const numberTaken = (c: Ctx, no: string, exceptId?: string) => !!c.db.prepare('SELECT 1 FROM student WHERE tenant_id = ? AND student_no = ? AND deleted_at IS NULL AND id <> ?').get(c.tenantId, no, exceptId ?? '');
const clean = (i: StudentInput): StudentInput => ({ ...i, givenName: i.givenName.trim(), familyName: i.familyName.trim(), studentNo: i.studentNo.trim(), birthDate: blank(i.birthDate), phone: blank(i.phone), joinedOn: blank(i.joinedOn) });

export function createStudent(c: Ctx, raw: StudentInput, o: { ignoreDuplicates?: boolean } = {}): Result<{ id: string }> {
  const i = clean(raw); const now = clock(c);
  if (!authorize(c.assignments, 'student.edit', i.branchId).allowed) return { ok: false, error: 'forbidden' };
  const issues = validateStudent(i, now.slice(0, 10)); if (issues.length) return { ok: false, error: 'invalid', issues };
  if (!branchOk(c, i.branchId)) return { ok: false, error: 'branch_not_found' };
  if (numberTaken(c, i.studentNo)) return { ok: false, error: 'duplicate_number' };
  const dups = findDuplicates(c, i); if (dups.length && !o.ignoreDuplicates) return { ok: false, error: 'duplicates', duplicates: dups };
  const personId = newId(), id = newId();
  c.db.transaction(() => {
    const env = [now, now, c.actorId, c.actorId] as const;
    c.db.prepare('INSERT INTO person(id,tenant_id,created_at,updated_at,created_by,updated_by,given_name,family_name,birth_date,phone,search_key) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(personId, c.tenantId, ...env, i.givenName, i.familyName, i.birthDate, i.phone, fullNameKey(i.givenName, i.familyName));
    c.db.prepare('INSERT INTO student(id,tenant_id,created_at,updated_at,created_by,updated_by,person_id,student_no,branch_id,status,joined_on) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, c.tenantId, ...env, personId, i.studentNo, i.branchId, i.status, i.joinedOn);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: i.branchId, action: 'student.create', entity_type: 'student', entity_id: id, before_json: null, after_json: JSON.stringify(i), reason: o.ignoreDuplicates && dups.length ? 'duplicate warning acknowledged' : null });
  })();
  return { ok: true, id };
}

export function updateStudent(c: Ctx, id: string, expectedVersion: number, raw: StudentInput, o: { ignoreDuplicates?: boolean } = {}): Result {
  const cur = load(c, id); if (!cur) return { ok: false, error: 'not_found' };
  if (!authorize(c.assignments, 'student.edit', cur.branchId).allowed) return { ok: false, error: 'forbidden' };
  if (cur.archivedAt) return { ok: false, error: 'archived' };
  const i = clean(raw); const now = clock(c);
  const issues = validateStudent(i, now.slice(0, 10)); if (issues.length) return { ok: false, error: 'invalid', issues };
  if (cur.version !== expectedVersion) return { ok: false, error: 'conflict' };
  if (i.branchId !== cur.branchId) { // moving a student to another branch = cross-branch transfer: Director only, and only before any enrollment exists
    if (!authorize(c.assignments, 'enrollment.transfer_cross_branch', null).allowed) return { ok: false, error: 'forbidden' };
    if (!branchOk(c, i.branchId)) return { ok: false, error: 'branch_not_found' };
    if (c.db.prepare('SELECT 1 FROM enrollment WHERE student_id = ? AND deleted_at IS NULL').get(id)) return { ok: false, error: 'has_enrollments' };
  }
  if (numberTaken(c, i.studentNo, id)) return { ok: false, error: 'duplicate_number' };
  const dups = findDuplicates(c, i, id); if (dups.length && !o.ignoreDuplicates) return { ok: false, error: 'duplicates', duplicates: dups };
  const before = { givenName: cur.givenName, familyName: cur.familyName, birthDate: cur.birthDate, phone: cur.phone, branchId: cur.branchId, status: cur.status, joinedOn: cur.joinedOn, studentNo: cur.studentNo };
  c.db.transaction(() => {
    const personId = (c.db.prepare('SELECT person_id p FROM student WHERE id = ?').get(id) as { p: string }).p;
    c.db.prepare('UPDATE person SET given_name=?, family_name=?, birth_date=?, phone=?, search_key=?, updated_at=?, updated_by=?, version=version+1 WHERE id=?')
      .run(i.givenName, i.familyName, i.birthDate, i.phone, fullNameKey(i.givenName, i.familyName), now, c.actorId, personId);
    c.db.prepare('UPDATE student SET student_no=?, branch_id=?, status=?, joined_on=?, updated_at=?, updated_by=?, version=version+1 WHERE id=?')
      .run(i.studentNo, i.branchId, i.status, i.joinedOn, now, c.actorId, id);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: i.branchId, action: 'student.update', entity_type: 'student', entity_id: id, before_json: JSON.stringify(before), after_json: JSON.stringify(i), reason: null });
  })();
  return { ok: true };
}

/** BR-019: students are archived with a reason, never deleted. History stays queryable. */
export function archiveStudent(c: Ctx, id: string, reason: string): Result {
  const cur = load(c, id); if (!cur) return { ok: false, error: 'not_found' };
  if (!authorize(c.assignments, 'student.edit', cur.branchId).allowed) return { ok: false, error: 'forbidden' };
  const why = reason.trim(); if (!why || [...why].length > 300) return { ok: false, error: 'reason_required' };
  if (cur.archivedAt) return { ok: false, error: 'already_archived' };
  const now = clock(c);
  c.db.transaction(() => {
    c.db.prepare('UPDATE student SET archived_at=?, archive_reason=?, updated_at=?, updated_by=?, version=version+1 WHERE id=?').run(now, why, now, c.actorId, id);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: cur.branchId, action: 'student.archive', entity_type: 'student', entity_id: id, before_json: null, after_json: null, reason: why });
  })();
  return { ok: true };
}
export function unarchiveStudent(c: Ctx, id: string): Result {
  const cur = load(c, id); if (!cur) return { ok: false, error: 'not_found' };
  if (!authorize(c.assignments, 'student.edit', cur.branchId).allowed) return { ok: false, error: 'forbidden' };
  if (!cur.archivedAt) return { ok: false, error: 'not_archived' };
  const now = clock(c);
  c.db.transaction(() => {
    c.db.prepare('UPDATE student SET archived_at=NULL, archive_reason=NULL, updated_at=?, updated_by=?, version=version+1 WHERE id=?').run(now, c.actorId, id);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: cur.branchId, action: 'student.unarchive', entity_type: 'student', entity_id: id, before_json: JSON.stringify({ archiveReason: cur.archiveReason }), after_json: null, reason: null });
  })();
  return { ok: true };
}
