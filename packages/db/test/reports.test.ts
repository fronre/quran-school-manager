import { describe, it, expect } from 'vitest';
import type { Assignment } from '@mishkat/domain';
import {
  openDb, migrate, runSetup, generateRecoveryKey, createStudent, createStaff, createGroup, assignTeacher, enrollStudent, saveSheet, cancelSession,
  enrollmentReport, attendanceReport, activityReport, type Ctx,
} from '../src';

const FAST = { memoryKiB: 8, passes: 1, parallelism: 1 };
const ok = <R extends { ok: boolean }>(r: R): Extract<R, { ok: true }> => { if (!r.ok) throw new Error('expected ok: ' + JSON.stringify(r)); return r as Extract<R, { ok: true }>; };
const T = { startTime: '16:00', endTime: '17:00' };

function world() {
  const db = openDb(':memory:'); migrate(db);
  const { tenantId } = runSetup(db, { admin: { givenName: 'مستخدم', familyName: 'البرنامج', username: 'user1', password: 'a-long-test-password' }, association: { name: 'جمعية' },
    branches: [{ name: 'فرع الرجال' }, { name: 'فرع النساء' }], year: { name: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30' } }, generateRecoveryKey().key, { argon2: FAST });
  const [men, women] = (db.prepare('SELECT id FROM branch ORDER BY position').all() as { id: string }[]).map((b) => b.id) as [string, string];
  let day = '2026-11-20';
  const ctx = (a: Assignment[]): Ctx => ({ db, tenantId, actorId: 'u1', assignments: a, now: () => day + 'T09:00:00.000Z' });
  const director = ctx([{ role: 'director', branchId: null }]);
  const stu = (b: string, n: number) => ok(createStudent(director, { givenName: 'طالب' + n, familyName: 'اختبار', birthDate: null, phone: null, branchId: b, status: 'active', joinedOn: '2026-09-05', studentNo: 'S' + n })).id;
  return { db, men, women, director, stu, regMen: ctx([{ role: 'registrar', branchId: men }]), supMen: ctx([{ role: 'branch_supervisor', branchId: men }]), supWomen: ctx([{ role: 'branch_supervisor', branchId: women }]),
    acadMen: ctx([{ role: 'academic_supervisor', branchId: men }]), setDay: (d: string) => { day = d; },
    group: (b: string, name: string) => ok(createGroup(director, { branchId: b, name, level: null, capacity: 10 })).id,
    teacher: (b: string, n: string) => ok(createStaff(director, { givenName: n, familyName: 'معلم', birthDate: null, phone: null, branchId: b, position: 'teacher', kind: 'employee' })).id };
}

describe('enrollment report', () => {
  it('counts students per group with teachers, and unassigned students; scoped by branch and role', () => {
    const w = world(); const g1 = w.group(w.men, 'فوج أ'); w.group(w.women, 'فوج ن'); const t = w.teacher(w.men, 'أحمد'); ok(assignTeacher(w.director, g1, t));
    const a = w.stu(w.men, 1); w.stu(w.men, 2); w.stu(w.women, 3); ok(enrollStudent(w.director, g1, a));
    const all = ok(enrollmentReport(w.director)).report; expect(all.groups.map((g) => [g.groupName, g.students, g.teachers])).toEqual([['فوج أ', 1, 'أحمد معلم'], ['فوج ن', 0, '']]); expect(all.totals).toEqual({ students: 1, unassigned: 2, groups: 2 });
    expect(ok(enrollmentReport(w.supMen)).report.groups.map((g) => g.groupName)).toEqual(['فوج أ']); expect(ok(enrollmentReport(w.supMen)).report.totals.unassigned).toBe(1);
    expect(ok(enrollmentReport(w.regMen)).report.totals.groups).toBe(1); // the registrar has the limited report permission
    expect(enrollmentReport(w.supMen, { branchId: w.women })).toEqual({ ok: false, error: 'forbidden' }); expect(ok(enrollmentReport(w.director, { branchId: w.women })).report.groups).toHaveLength(1);
  });
});

describe('attendance report', () => {
  it('computes counts and rate over held sessions in range, per group and branch scope', () => {
    const w = world(); const g = w.group(w.men, 'فوج أ'); const a = w.stu(w.men, 1), b = w.stu(w.men, 2); w.setDay('2026-10-01'); ok(enrollStudent(w.director, g, a)); ok(enrollStudent(w.director, g, b));
    const days: [string, 'present' | 'late' | 'absent' | 'excused'][] = [['2026-11-16', 'present'], ['2026-11-17', 'late'], ['2026-11-18', 'absent'], ['2026-11-19', 'excused']];
    for (const [d, st] of days) { w.setDay(d); ok(saveSheet(w.director, g, d, T, [{ studentId: a, status: 'present' }, st === 'late' ? { studentId: b, status: 'late', lateMinutes: 5 } : { studentId: b, status: st }])); }
    w.setDay('2026-11-20'); ok(cancelSession(w.director, g, '2026-11-20', 'عطلة'));
    const r = ok(attendanceReport(w.supMen, { from: '2026-11-01', to: '2026-11-30' })); expect(r.heldSessions).toBe(4);
    expect(r.rows.map((x) => [x.studentNo, x.present, x.late, x.absent, x.excused, x.recorded, x.ratePct])).toEqual([['S1', 4, 0, 0, 0, 4, 100], ['S2', 1, 1, 1, 1, 4, 50]]);
    expect(ok(attendanceReport(w.supMen, { from: '2026-11-17', to: '2026-11-17' })).rows.map((x) => x.recorded)).toEqual([1, 1]); expect(ok(attendanceReport(w.director, { from: '2026-12-01', to: '2026-12-31' })).rows).toEqual([]);
    expect(ok(attendanceReport(w.director, { from: '2026-11-01', to: '2026-11-30', groupId: g })).rows).toHaveLength(2); expect(ok(attendanceReport(w.director, { from: '2026-11-01', to: '2026-11-30', groupId: 'nope' })).rows).toEqual([]);
  });
  it('is branch-scoped and needs the full report permission', () => {
    const w = world(); const g = w.group(w.men, 'فوج أ'); const a = w.stu(w.men, 1); w.setDay('2026-10-01'); ok(enrollStudent(w.director, g, a)); w.setDay('2026-11-19'); ok(saveSheet(w.director, g, '2026-11-19', T, [{ studentId: a, status: 'present' }]));
    expect(ok(attendanceReport(w.supWomen, { from: '2026-11-01', to: '2026-11-30' })).rows).toEqual([]); expect(attendanceReport(w.supWomen, { branchId: w.men, from: '2026-11-01', to: '2026-11-30' })).toEqual({ ok: false, error: 'forbidden' });
    expect(attendanceReport(w.regMen, { from: '2026-11-01', to: '2026-11-30' })).toEqual({ ok: false, error: 'forbidden' }); expect(ok(attendanceReport(w.acadMen, { from: '2026-11-01', to: '2026-11-30' })).rows).toHaveLength(1);
    for (const bad of [{ from: 'x', to: '2026-11-30' }, { from: '2026-12-01', to: '2026-11-30' }]) expect(attendanceReport(w.director, bad)).toEqual({ ok: false, error: 'invalid' });
  });
});

describe('activity report', () => {
  it('counts held and no-class days and entries per group', () => {
    const w = world(); const g = w.group(w.men, 'فوج أ'); w.group(w.women, 'فوج ن'); const t = w.teacher(w.men, 'أحمد'); ok(assignTeacher(w.director, g, t)); const a = w.stu(w.men, 1); w.setDay('2026-10-01'); ok(enrollStudent(w.director, g, a));
    w.setDay('2026-11-18'); ok(saveSheet(w.director, g, '2026-11-18', T, [{ studentId: a, status: 'present' }])); w.setDay('2026-11-19'); ok(cancelSession(w.director, g, '2026-11-19', 'عطلة'));
    expect(ok(activityReport(w.director, { from: '2026-11-01', to: '2026-11-30' })).rows.map((r) => [r.groupName, r.teachers, r.held, r.cancelled, r.recorded])).toEqual([['فوج أ', 'أحمد معلم', 1, 1, 1], ['فوج ن', '', 0, 0, 0]]);
    expect(ok(activityReport(w.supMen, { from: '2026-11-01', to: '2026-11-30' })).rows).toHaveLength(1); expect(activityReport(w.regMen, { from: '2026-11-01', to: '2026-11-30' })).toEqual({ ok: false, error: 'forbidden' });
  });
});
