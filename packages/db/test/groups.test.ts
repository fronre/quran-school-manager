import { describe, it, expect, beforeEach } from 'vitest';
import type { Assignment } from '@mishkat/domain';
import {
  openDb, migrate, verifyAuditLog, runSetup, generateRecoveryKey, createStudent, createStaff, archiveStudent, archiveStaff,
  createGroup, updateGroup, setGroupStatus, listGroups, getGroup, assignTeacher, removeTeacher, assignableTeachers, groupsOfTeacher,
  unassignedStudents, enrollStudent, leaveGroup, studentGroups, type Ctx,
} from '../src';

const FAST = { memoryKiB: 8, passes: 1, parallelism: 1 };
const ok = <R extends { ok: boolean }>(r: R): Extract<R, { ok: true }> => { if (!r.ok) throw new Error('expected ok: ' + JSON.stringify(r)); return r as Extract<R, { ok: true }>; };

function world() {
  const db = openDb(':memory:'); migrate(db);
  const { tenantId } = runSetup(db, { admin: { givenName: 'مستخدم', familyName: 'البرنامج', username: 'user1', password: 'a-long-test-password' }, association: { name: 'جمعية' },
    branches: [{ name: 'فرع الرجال' }, { name: 'فرع النساء' }], year: { name: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30' } }, generateRecoveryKey().key, { argon2: FAST });
  const [men, women] = (db.prepare('SELECT id FROM branch ORDER BY position').all() as { id: string }[]).map((b) => b.id) as [string, string];
  let day = '2026-11-20';
  const ctx = (a: Assignment[]): Ctx => ({ db, tenantId, actorId: 'u1', assignments: a, now: () => day + 'T09:00:00.000Z' });
  const director = ctx([{ role: 'director', branchId: null }]);
  const stu = (b: string, n: number) => ok(createStudent(director, { givenName: 'طالب' + n, familyName: 'اختبار', birthDate: null, phone: null, branchId: b, status: 'active', joinedOn: '2026-09-05', studentNo: 'S' + n })).id;
  const teacher = (b: string, g: string, position = 'teacher') => ok(createStaff(director, { givenName: g, familyName: 'معلم', birthDate: null, phone: null, branchId: b, position: position as 'teacher', kind: 'employee' })).id;
  return { db, tenantId, men, women, director, supMen: ctx([{ role: 'branch_supervisor', branchId: men }]), regMen: ctx([{ role: 'registrar', branchId: men }]), acadMen: ctx([{ role: 'academic_supervisor', branchId: men }]), supWomen: ctx([{ role: 'branch_supervisor', branchId: women }]),
    stu, teacher, setDay: (d: string) => { day = d; } };
}
const gi = (b: string, name = 'فوج أ') => ({ branchId: b, name, level: 'مبتدئ', capacity: 2 });

describe('groups: create, list, scope', () => {
  let w: ReturnType<typeof world>; beforeEach(() => { w = world(); });
  it('creates a group in the active year, with audit', () => {
    const { id } = ok(createGroup(w.supMen, gi(w.men)));
    expect(getGroup(w.supMen, id)?.group).toMatchObject({ name: 'فوج أ', level: 'مبتدئ', capacity: 2, status: 'active', members: 0, branchName: 'فرع الرجال', yearName: '2026-2027', teachers: [] });
    expect(w.db.prepare("SELECT count(*) c FROM audit_log WHERE action='group.create'").get()).toEqual({ c: 1 }); expect(verifyAuditLog(w.db)).toEqual({ ok: true });
  });
  it('validates input and rejects duplicate names within a branch and year', () => {
    for (const bad of [{ ...gi(w.men), name: '  ' }, { ...gi(w.men), capacity: 0 }, { ...gi(w.men), capacity: 2.5 }, { ...gi(w.men), capacity: 501 }]) expect(createGroup(w.director, bad)).toEqual({ ok: false, error: 'invalid' });
    ok(createGroup(w.director, gi(w.men))); expect(createGroup(w.director, gi(w.men))).toEqual({ ok: false, error: 'duplicate_name' });
    expect(createGroup(w.director, gi(w.women)).ok).toBe(true); // same name in the other branch is fine
    expect(createGroup(w.director, gi('nope'))).toEqual({ ok: false, error: 'not_found' });
  });
  it('enforces roles and branch scope; invisible groups look absent', () => {
    expect(createGroup(w.supWomen, gi(w.men))).toEqual({ ok: false, error: 'forbidden' }); expect(createGroup(w.regMen, gi(w.men))).toEqual({ ok: false, error: 'forbidden' }); expect(createGroup(w.acadMen, gi(w.men))).toEqual({ ok: false, error: 'forbidden' });
    const { id } = ok(createGroup(w.director, gi(w.men)));
    expect(getGroup(w.supWomen, id)).toBeNull(); expect(listGroups(w.supWomen)).toEqual([]); expect(listGroups(w.supMen)).toHaveLength(1); expect(listGroups(w.regMen)).toHaveLength(1);
    expect(updateGroup(w.supWomen, id, 1, { name: 'x', level: null, capacity: 5 })).toEqual({ ok: false, error: 'not_found' });
    expect(updateGroup(w.acadMen, id, 1, { name: 'x', level: null, capacity: 5 })).toEqual({ ok: false, error: 'forbidden' });
  });
  it('updates with optimistic locking and records before/after', () => {
    const { id } = ok(createGroup(w.supMen, gi(w.men)));
    ok(updateGroup(w.supMen, id, 1, { name: 'فوج ب', level: null, capacity: 10 }));
    expect(updateGroup(w.supMen, id, 1, { name: 'z', level: null, capacity: 10 })).toEqual({ ok: false, error: 'conflict' });
    expect(getGroup(w.supMen, id)?.group).toMatchObject({ name: 'فوج ب', level: null, capacity: 10, version: 2 });
    ok(createGroup(w.supMen, gi(w.men, 'فوج ج'))); expect(updateGroup(w.supMen, id, 2, { name: 'فوج ج', level: null, capacity: 10 })).toEqual({ ok: false, error: 'duplicate_name' });
  });
  it('fails cleanly without an active year', () => {
    w.db.prepare("UPDATE academic_year SET status='closed', version=version+1").run(); expect(createGroup(w.director, gi(w.men))).toEqual({ ok: false, error: 'no_active_year' }); expect(listGroups(w.director)).toEqual([]);
  });
});

describe('teachers on groups', () => {
  let w: ReturnType<typeof world>; let g: string; beforeEach(() => { w = world(); g = ok(createGroup(w.supMen, gi(w.men))).id; });
  it('one teacher may lead several groups and a group may have several teachers', () => {
    const g2 = ok(createGroup(w.supMen, gi(w.men, 'فوج ب'))).id; const t1 = w.teacher(w.men, 'أحمد'), t2 = w.teacher(w.men, 'يوسف');
    ok(assignTeacher(w.supMen, g, t1)); ok(assignTeacher(w.supMen, g2, t1)); ok(assignTeacher(w.supMen, g, t2));
    expect(getGroup(w.supMen, g)?.group.teachers.map((t) => t.name).sort()).toEqual(['أحمد معلم', 'يوسف معلم']);
    expect(groupsOfTeacher(w.supMen, t1).map((x) => x.name).sort()).toEqual(['فوج أ', 'فوج ب']);
    expect(assignTeacher(w.supMen, g, t1)).toEqual({ ok: false, error: 'already_assigned' });
  });
  it('only active teachers of the same branch can be assigned', () => {
    const other = w.teacher(w.women, 'خديجة'), sup = w.teacher(w.men, 'مشرف', 'supervisor'), gone = w.teacher(w.men, 'قديم'); ok(archiveStaff(w.director, gone, 'غادر'));
    for (const id of [other, sup, gone, 'nope']) expect(assignTeacher(w.supMen, g, id)).toEqual({ ok: false, error: 'staff_not_found' });
    expect(assignableTeachers(w.supMen, g)).toEqual([]);
  });
  it('the schema itself refuses a cross-branch assignment', () => {
    const other = w.teacher(w.women, 'خديجة'); const now = '2026-11-20T09:00:00.000Z';
    expect(() => w.db.prepare('INSERT INTO group_teacher(id,tenant_id,created_at,updated_at,created_by,updated_by,group_id,staff_member_id,branch_id) VALUES (?,?,?,?,?,?,?,?,?)').run('00000000-0000-7000-8000-000000000001', w.tenantId, now, now, 'u', 'u', g, other, w.men)).toThrow(/FOREIGN KEY/);
  });
  it('removal keeps a tombstone and allows re-assigning later; roles are enforced', () => {
    const t = w.teacher(w.men, 'أحمد'); ok(assignTeacher(w.supMen, g, t));
    expect(assignTeacher(w.regMen, g, w.teacher(w.men, 'آخر'))).toEqual({ ok: false, error: 'forbidden' }); expect(removeTeacher(w.acadMen, g, t)).toEqual({ ok: false, error: 'forbidden' });
    ok(removeTeacher(w.supMen, g, t)); expect(removeTeacher(w.supMen, g, t)).toEqual({ ok: false, error: 'not_assigned' });
    expect(w.db.prepare('SELECT count(*) c FROM group_teacher WHERE deleted_at IS NOT NULL').get()).toEqual({ c: 1 }); ok(assignTeacher(w.supMen, g, t));
  });
  it('a closed group takes no new teacher', () => { ok(setGroupStatus(w.supMen, g, 'closed')); expect(assignTeacher(w.supMen, g, w.teacher(w.men, 'أحمد'))).toEqual({ ok: false, error: 'closed' }); });
});

describe('enrolling students (BR-001, BR-002, BR-011)', () => {
  let w: ReturnType<typeof world>; let g: string; beforeEach(() => { w = world(); g = ok(createGroup(w.supMen, gi(w.men))).id; });
  it('enrolls active students; count and members follow; capacity is advisory', () => {
    const [a, b, c] = [w.stu(w.men, 1), w.stu(w.men, 2), w.stu(w.men, 3)] as [string, string, string];
    ok(enrollStudent(w.regMen, g, a)); ok(enrollStudent(w.regMen, g, b)); ok(enrollStudent(w.regMen, g, c)); // capacity is 2: allowed, shown as over
    const got = getGroup(w.regMen, g)!; expect(got.group.members).toBe(3); expect(got.members.map((m) => m.studentNo)).toEqual(['S1', 'S2', 'S3']);
    expect(studentGroups(w.regMen, a)).toEqual({ current: { groupId: g, name: 'فوج أ', since: '2026-11-20' }, past: [] });
  });
  it('one open enrollment per student per year', () => {
    const s = w.stu(w.men, 1), g2 = ok(createGroup(w.supMen, gi(w.men, 'فوج ب'))).id; ok(enrollStudent(w.regMen, g, s));
    expect(enrollStudent(w.regMen, g, s)).toEqual({ ok: false, error: 'same_group' }); expect(enrollStudent(w.regMen, g2, s)).toEqual({ ok: false, error: 'already_enrolled' });
    expect(w.db.prepare('SELECT count(*) c FROM enrollment WHERE student_id = ? AND end_date IS NULL').get(s)).toEqual({ c: 1 });
  });
  it('rejects students of the other branch, archived or non-active students, and unknown ids', () => {
    const wm = w.stu(w.women, 1), s = w.stu(w.men, 2), sus = w.stu(w.men, 3), arch = w.stu(w.men, 4);
    w.db.prepare("UPDATE student SET status='suspended', version=version+1 WHERE id = ?").run(sus); ok(archiveStudent(w.director, arch, 'غادر'));
    expect(enrollStudent(w.director, g, wm)).toEqual({ ok: false, error: 'student_not_found' }); expect(enrollStudent(w.director, g, 'nope')).toEqual({ ok: false, error: 'student_not_found' });
    expect(enrollStudent(w.director, g, sus)).toEqual({ ok: false, error: 'student_not_active' }); expect(enrollStudent(w.director, g, arch)).toEqual({ ok: false, error: 'student_not_active' });
    expect(enrollStudent(w.acadMen, g, s)).toEqual({ ok: false, error: 'forbidden' }); expect(enrollStudent(w.supWomen, g, s)).toEqual({ ok: false, error: 'not_found' });
  });
  it('transfer keeps history: the old enrollment ends the day before and points to the new one', () => {
    const s = w.stu(w.men, 1), g2 = ok(createGroup(w.supMen, gi(w.men, 'فوج ب'))).id; ok(enrollStudent(w.regMen, g, s));
    expect(enrollStudent(w.regMen, g2, s, 'transfer')).toEqual({ ok: false, error: 'same_day' }); // enrolled today: cannot move the same day
    w.setDay('2026-11-25'); const t = ok(enrollStudent(w.regMen, g2, s, 'transfer'));
    expect(w.db.prepare('SELECT start_date s, end_date e, end_reason r, transferred_to_id t FROM enrollment WHERE group_id = ?').get(g)).toEqual({ s: '2026-11-20', e: '2026-11-24', r: 'transfer', t: t.enrollmentId });
    expect(studentGroups(w.regMen, s)).toEqual({ current: { groupId: g2, name: 'فوج ب', since: '2026-11-25' }, past: [{ name: 'فوج أ', from: '2026-11-20', to: '2026-11-24' }] });
    expect(getGroup(w.regMen, g)?.group.members).toBe(0); expect(verifyAuditLog(w.db)).toEqual({ ok: true });
  });
  it('leaving needs a reason, ends the enrollment and frees the student', () => {
    const s = w.stu(w.men, 1); ok(enrollStudent(w.regMen, g, s));
    expect(leaveGroup(w.regMen, g, s, '  ')).toEqual({ ok: false, error: 'reason_required' }); expect(leaveGroup(w.regMen, g, w.stu(w.men, 2), 'x')).toEqual({ ok: false, error: 'not_enrolled' });
    w.setDay('2026-11-22'); ok(leaveGroup(w.regMen, g, s, 'انتقل للسكن في مدينة أخرى'));
    expect(w.db.prepare('SELECT end_date e, end_reason r FROM enrollment WHERE student_id = ?').get(s)).toEqual({ e: '2026-11-21', r: 'انتقل للسكن في مدينة أخرى' });
    expect(unassignedStudents(w.regMen, w.men).map((x) => x.id)).toContain(s); ok(enrollStudent(w.regMen, g, s)); // can come back
  });
  it('same-day leave never produces an end before the start', () => {
    const s = w.stu(w.men, 1); ok(enrollStudent(w.regMen, g, s)); ok(leaveGroup(w.regMen, g, s, 'خطأ في التسجيل'));
    expect(w.db.prepare('SELECT start_date s, end_date e FROM enrollment').get()).toEqual({ s: '2026-11-20', e: '2026-11-20' });
  });
  it('closing needs an empty group; a closed group takes no students; reopening works', () => {
    const s = w.stu(w.men, 1); ok(enrollStudent(w.regMen, g, s));
    expect(setGroupStatus(w.supMen, g, 'closed')).toEqual({ ok: false, error: 'has_members' }); ok(leaveGroup(w.regMen, g, s, 'سبب'));
    ok(setGroupStatus(w.supMen, g, 'closed')); expect(enrollStudent(w.regMen, g, s)).toEqual({ ok: false, error: 'closed' }); expect(listGroups(w.supMen)).toEqual([]); expect(listGroups(w.supMen, { status: 'all' })).toHaveLength(1);
    ok(setGroupStatus(w.supMen, g, 'active')); expect(enrollStudent(w.regMen, g, s)).toEqual({ ok: false, error: 'same_day' }); w.setDay('2026-11-21'); ok(enrollStudent(w.regMen, g, s));
  });
  it('unassigned list shows only this branch, active, free students and honours search', () => {
    const a = w.stu(w.men, 1); w.stu(w.women, 2); const c = w.stu(w.men, 3); ok(enrollStudent(w.regMen, g, c));
    expect(unassignedStudents(w.regMen, w.men).map((x) => x.id)).toEqual([a]); expect(unassignedStudents(w.regMen, w.men, 'طالب1').map((x) => x.id)).toEqual([a]); expect(unassignedStudents(w.regMen, w.men, 'غير موجود')).toEqual([]);
    expect(unassignedStudents(w.supWomen, w.men)).toEqual([]); expect(unassignedStudents(w.acadMen, w.men)).toEqual([]);
  });
  it('the student profile history is hidden from other branches', () => { const s = w.stu(w.men, 1); expect(studentGroups(w.supWomen, s)).toBeNull(); });
});
