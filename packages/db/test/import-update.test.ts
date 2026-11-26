import { describe, it, expect } from 'vitest';
import type { Assignment } from '@mishkat/domain';
import { openDb, migrate, verifyAuditLog, runSetup, generateRecoveryKey, createStudent, getStudent, previewStudentUpdate, commitStudentUpdate, type Ctx } from '../src';

const FAST = { memoryKiB: 8, passes: 1, parallelism: 1 };
const ok = <R extends { ok: boolean }>(r: R): Extract<R, { ok: true }> => { if (!r.ok) throw new Error('expected ok: ' + JSON.stringify(r)); return r as Extract<R, { ok: true }>; };
const map = { studentNo: 0, birthDate: 1, phone: 2 };

function world() {
  const db = openDb(':memory:'); migrate(db);
  const { tenantId } = runSetup(db, { admin: { givenName: 'مستخدم', familyName: 'البرنامج', username: 'user1', password: 'a-long-test-password' }, association: { name: 'جمعية' },
    branches: [{ name: 'فرع الرجال' }, { name: 'فرع النساء' }], year: { name: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30' } }, generateRecoveryKey().key, { argon2: FAST });
  const [men, women] = (db.prepare('SELECT id FROM branch ORDER BY position').all() as { id: string }[]).map((b) => b.id) as [string, string];
  const ctx = (a: Assignment[]): Ctx => ({ db, tenantId, actorId: 'u1', assignments: a, now: () => '2026-11-20T09:00:00.000Z' });
  const director = ctx([{ role: 'director', branchId: null }]);
  const stu = (b: string, n: number) => ok(createStudent(director, { givenName: 'طالب' + n, familyName: 'اختبار', birthDate: null, phone: null, branchId: b, status: 'active', joinedOn: null, studentNo: String(n) })).id;
  return { db, director, men, women, stu, supMen: ctx([{ role: 'branch_supervisor', branchId: men }]) };
}

describe('update existing students from a file', () => {
  it('applies only differences through the normal edit rules, keeps everything else, and audits once more for the file', () => {
    const w = world(); const a = w.stu(w.men, 1); const b = w.stu(w.men, 2);
    const rows = [['1', '2014-01-02', '0661234567'], ['2', null, '0550123456']];
    expect(previewStudentUpdate(w.director, rows, 2, map)).toMatchObject({ toUpdate: 2, withIssues: 0 });
    expect(ok(commitStudentUpdate(w.director, rows, 2, map, false))).toEqual({ ok: true, updated: 2, skipped: 0 });
    expect(getStudent(w.director, a)).toMatchObject({ birthDate: '2014-01-02', phone: '0661234567', givenName: 'طالب1', status: 'active', version: 2 }); expect(getStudent(w.director, b)).toMatchObject({ birthDate: null, phone: '0550123456' });
    expect(w.db.prepare("SELECT count(*) c FROM audit_log WHERE action IN ('student.update','student.import_update')").get()).toEqual({ c: 3 }); expect(verifyAuditLog(w.db)).toEqual({ ok: true });
    expect(commitStudentUpdate(w.director, rows, 2, map, false)).toEqual({ ok: false, error: 'nothing_to_import' }); // the same file again changes nothing
  });
  it('refuses a file with problems unless told to skip them, and is all-or-nothing', () => {
    const w = world(); const a = w.stu(w.men, 1); const rows = [['1', '2014-01-02', null], ['99', '2014-01-02', null]];
    expect(commitStudentUpdate(w.director, rows, 2, map, false)).toEqual({ ok: false, error: 'invalid' }); expect(getStudent(w.director, a)!.birthDate).toBeNull();
    expect(ok(commitStudentUpdate(w.director, rows, 2, map, true))).toEqual({ ok: true, updated: 1, skipped: 1 }); expect(getStudent(w.director, a)!.birthDate).toBe('2014-01-02');
  });
  it('only reaches students the caller may edit, and needs the import right', () => {
    const w = world(); const m = w.stu(w.men, 1); const f = w.stu(w.women, 2);
    expect(commitStudentUpdate(w.supMen, [['1', '2014-01-02', null]], 2, map, false)).toEqual({ ok: false, error: 'forbidden' }); // branch supervisors do not have the import right
    expect(previewStudentUpdate(w.supMen, [['1', '2014-01-02', null]], 2, map).rows[0]!.student?.id).toBe(m); expect(previewStudentUpdate(w.supMen, [['2', '2014-01-02', null]], 2, map).rows[0]!.issues).toEqual(['student_not_found']); void f;
  });
});
