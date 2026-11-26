import { describe, it, expect } from 'vitest';
import type { Assignment } from '@mishkat/domain';
import {
  openDb, migrate, verifyAuditLog, runSetup, generateRecoveryKey, createStudent, createStaff, createGroup, assignTeacher, enrollStudent, leaveGroup, archiveStudent, listGroups, getGroup, studentGroups, unassignedStudents,
  yearOverview, startNewYear, carryOverPlan, carryOver, saveSheet, recordMemorization, studentProgress, type Ctx,
} from '../src';

const FAST = { memoryKiB: 8, passes: 1, parallelism: 1 };
const ok = <R extends { ok: boolean }>(r: R): Extract<R, { ok: true }> => { if (!r.ok) throw new Error('expected ok: ' + JSON.stringify(r)); return r as Extract<R, { ok: true }>; };
const NEW = { name: '2027-2028', startDate: '2027-09-01', endDate: '2028-06-30', copyGroups: true };

function world() {
  const db = openDb(':memory:'); migrate(db);
  const { tenantId } = runSetup(db, { admin: { givenName: 'مستخدم', familyName: 'البرنامج', username: 'user1', password: 'a-long-test-password' }, association: { name: 'جمعية' },
    branches: [{ name: 'فرع الرجال' }, { name: 'فرع النساء' }], year: { name: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30' } }, generateRecoveryKey().key, { argon2: FAST });
  const [men, women] = (db.prepare('SELECT id FROM branch ORDER BY position').all() as { id: string }[]).map((b) => b.id) as [string, string];
  let day = '2026-11-20';
  const ctx = (a: Assignment[]): Ctx => ({ db, tenantId, actorId: 'u1', assignments: a, now: () => day + 'T09:00:00.000Z' });
  const director = ctx([{ role: 'director', branchId: null }]);
  const stu = (b: string, n: number) => ok(createStudent(director, { givenName: 'طالب' + n, familyName: 'اختبار', birthDate: null, phone: null, branchId: b, status: 'active', joinedOn: null, studentNo: String(n) })).id;
  const group = (b: string, name: string) => ok(createGroup(director, { branchId: b, name, level: 'م', capacity: 10 })).id;
  return { db, men, women, director, stu, group, setDay: (d: string) => { day = d; }, regMen: ctx([{ role: 'registrar', branchId: men }]), supMen: ctx([{ role: 'branch_supervisor', branchId: men }]), acadMen: ctx([{ role: 'academic_supervisor', branchId: men }]), tenantId };
}

describe('closing a year and opening the next', () => {
  it('ends open enrollments at the year end, closes the year, opens the new one and copies groups with their teachers', () => {
    const w = world(); const g = w.group(w.men, 'فوج أ'); const gw = w.group(w.women, 'فوج ن'); const t = ok(createStaff(w.director, { givenName: 'أحمد', familyName: 'م', birthDate: null, phone: null, branchId: w.men, position: 'teacher', kind: 'employee' })).id; ok(assignTeacher(w.director, g, t));
    const a = w.stu(w.men, 1), b = w.stu(w.men, 2); ok(enrollStudent(w.director, g, a)); ok(enrollStudent(w.director, g, b)); w.setDay('2027-06-30');
    expect(yearOverview(w.director)).toMatchObject({ year: { name: '2026-2027' }, groups: 2, openEnrollments: 2 });
    const r = ok(startNewYear(w.director, NEW)); expect(r).toMatchObject({ copiedGroups: 2, endedEnrollments: 2 });
    expect(w.db.prepare("SELECT status FROM academic_year ORDER BY start_date").all()).toEqual([{ status: 'closed' }, { status: 'active' }]);
    expect(w.db.prepare('SELECT end_date e, end_reason r FROM enrollment').all()).toEqual([{ e: '2027-06-30', r: 'year_end' }, { e: '2027-06-30', r: 'year_end' }]);
    const gs = listGroups(w.director); expect(gs.map((x) => [x.name, x.members, x.yearName])).toEqual([['فوج أ', 0, '2027-2028'], ['فوج ن', 0, '2027-2028']]); expect(gs[0]!.teachers.map((x) => x.name)).toEqual(['أحمد م']);
    expect(studentGroups(w.director, a)!.current).toBeNull(); expect(unassignedStudents(w.regMen, w.men).map((s) => s.id).sort()).toEqual([a, b].sort()); void gw;
    expect(verifyAuditLog(w.db)).toEqual({ ok: true });
  });
  it('closing early ends enrollments today, and never before they started', () => {
    const w = world(); const g = w.group(w.men, 'فوج أ'); const a = w.stu(w.men, 1); ok(enrollStudent(w.director, g, a)); w.setDay('2027-03-01'); ok(startNewYear(w.director, { ...NEW, copyGroups: false }));
    expect(w.db.prepare('SELECT end_date e FROM enrollment').get()).toEqual({ e: '2027-03-01' }); expect(listGroups(w.director)).toEqual([]);
  });
  it('validates names, dates and overlap, and needs the right to manage settings', () => {
    const w = world();
    expect(startNewYear(w.director, { ...NEW, name: ' ' })).toEqual({ ok: false, error: 'invalid' }); expect(startNewYear(w.director, { ...NEW, endDate: '2027-01-01' })).toEqual({ ok: false, error: 'dates' }); expect(startNewYear(w.director, { ...NEW, startDate: 'x' })).toEqual({ ok: false, error: 'dates' });
    expect(startNewYear(w.director, { ...NEW, startDate: '2027-06-30' })).toEqual({ ok: false, error: 'overlap' }); expect(startNewYear(w.director, { ...NEW, name: '2026-2027' })).toEqual({ ok: false, error: 'duplicate_name' });
    expect(startNewYear(w.supMen, NEW)).toEqual({ ok: false, error: 'forbidden' }); expect(yearOverview(w.supMen)).toBeNull(); expect(w.db.prepare("SELECT count(*) c FROM academic_year WHERE status = 'active'").get()).toEqual({ c: 1 });
  });
  it('keeps history: attendance and memorization of the closed year survive', () => {
    const w = world(); const g = w.group(w.men, 'فوج أ'); const a = w.stu(w.men, 1); ok(enrollStudent(w.director, g, a));
    ok(saveSheet(w.director, g, '2026-11-20', { startTime: '16:00', endTime: '17:00' }, [{ studentId: a, status: 'present' }])); ok(recordMemorization(w.director, { studentId: a, date: '2026-11-20', type: 'new', range: { start: { surah: 1, ayah: 1 }, end: { surah: 1, ayah: 7 } }, evalRank: 4 }));
    w.setDay('2027-06-30'); ok(startNewYear(w.director, NEW)); expect(w.db.prepare('SELECT count(*) c FROM attendance_record').get()).toEqual({ c: 1 }); expect(studentProgress(w.director, a)!.summary.memorizedAyat).toBe(7);
  });
});

describe('carrying students over', () => {
  function closed() {
    const w = world(); const g = w.group(w.men, 'فوج أ'); const a = w.stu(w.men, 1), b = w.stu(w.men, 2), c3 = w.stu(w.men, 3);
    for (const s of [a, b, c3]) ok(enrollStudent(w.director, g, s)); ok(archiveStudent(w.director, c3, 'غادر')); w.setDay('2027-06-30'); ok(startNewYear(w.director, NEW)); return { ...w, g, a, b, c3 };
  }
  it('proposes the same-named group and counts only students who can be moved', () => {
    const w = closed(); const plan = carryOverPlan(w.regMen)!; expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ fromName: 'فوج أ', yearName: '2026-2027', candidates: 2, suggested: { name: 'فوج أ' } }); expect(carryOverPlan(w.regMen)![0]!.targets).toHaveLength(1);
  });
  it('enrolls them from the first day of the new year, once, and skips archived students', () => {
    const w = closed(); const to = listGroups(w.regMen)[0]!.id; expect(ok(carryOver(w.regMen, w.g, to))).toEqual({ ok: true, moved: 2, skipped: 1 });
    expect(getGroup(w.regMen, to)!.members.map((m) => m.since)).toEqual(['2027-09-01', '2027-09-01']); expect(ok(carryOver(w.regMen, w.g, to))).toMatchObject({ moved: 0 }); // nothing is duplicated
    expect(carryOverPlan(w.regMen)![0]!.candidates).toBe(0); expect(studentGroups(w.director, w.a)!.past.map((p) => p.name)).toEqual(['فوج أ']); expect(verifyAuditLog(w.db)).toEqual({ ok: true });
  });
  it('refuses wrong targets and wrong roles', () => {
    const w = closed(); const wom = w.group(w.women, 'فوج ن'); const to = listGroups(w.regMen)[0]!.id;
    expect(carryOver(w.director, w.g, wom)).toEqual({ ok: false, error: 'branch_mismatch' }); expect(carryOver(w.director, to, to)).toEqual({ ok: false, error: 'not_closed_year' }); expect(carryOver(w.director, w.g, w.g)).toEqual({ ok: false, error: 'not_found' }); expect(carryOver(w.director, 'nope', to)).toEqual({ ok: false, error: 'not_found' });
    expect(carryOver(w.acadMen, w.g, to)).toEqual({ ok: false, error: 'forbidden' }); void leaveGroup;
  });
});
