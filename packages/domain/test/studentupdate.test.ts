import { describe, it, expect } from 'vitest';
import { analyzeStudentUpdate, updateMappingProblems, type UpdateTarget } from '../src';

const T = (id: string, no: string, over: object = {}): UpdateTarget => ({ id, version: 1, studentNo: no, input: { givenName: 'أحمد', familyName: 'علي', birthDate: null, phone: null, branchId: 'b', status: 'active', joinedOn: null, studentNo: no, ...over } });
const byNo = new Map([['1', T('a', '1')], ['2', T('b', '2', { birthDate: '2015-03-04', phone: '0550123456' })]]);
const map = { studentNo: 0, birthDate: 1, phone: 2, joinedOn: 3 };
const run = (rows: (string | number | null)[][]) => analyzeStudentUpdate(rows, 2, map, byNo, '2026-11-20');

describe('update-existing import', () => {
  it('needs the student number column and at least one column to update', () => { expect(updateMappingProblems({})).toHaveLength(2); expect(updateMappingProblems({ studentNo: 0 })).toHaveLength(1); expect(updateMappingProblems({ studentNo: 0, phone: 1 })).toEqual([]); });
  it('proposes only the differences and never erases a value with an empty cell', () => {
    const r = run([['1', '2014-01-02', '0661234567', '2026-09-05'], ['2', null, null, null], ['2', '2015-03-04', '0550 123456', null]]);
    expect(r.rows[0]).toMatchObject({ student: { id: 'a' }, changes: { birthDate: '2014-01-02', phone: '0661234567', joinedOn: '2026-09-05' }, issues: [] });
    expect(r.rows[1]).toMatchObject({ changes: {}, unchanged: true }); expect(r.rows[2]!.changes).toEqual({ phone: '0550 123456' }); expect(r.rows[2]!.issues).toEqual(['duplicate_in_file']);
  });
  it('reads Excel numbers and Arabic digits, and matches by student number only', () => {
    expect(run([[1, null, 661234567, null]]).rows[0]).toMatchObject({ student: { id: 'a' }, changes: { phone: '661234567' } }); expect(run([['١', null, null, null]]).rows[0]!.student?.id).toBe('a');
    expect(run([['99', '2014-01-02', null, null], [null, '2014-01-02', null, null]]).rows.map((r) => r.issues)).toEqual([['student_not_found'], ['no_number']]);
  });
  it('rejects bad dates, future dates and bad phones with the same rules as a manual edit', () => {
    const r = run([['1', 'not a date', null, null], ['1', '2099-01-01', null, null], ['1', null, 'abc', null], ['1', '1800-01-01', null, null]]);
    expect(r.rows.map((x) => x.issues.filter((i) => i !== 'duplicate_in_file'))).toEqual([['bad_date'], ['future_date'], ['bad_phone'], ['too_old']]); expect(r.toUpdate).toBe(0);
  });
  it('counts what will change, what is already up to date and what has problems', () => { const r = run([['1', '2014-01-02', null, null], ['2', '2015-03-04', null, null], ['99', null, null, null]]); expect([r.toUpdate, r.unchanged, r.withIssues, r.total]).toEqual([1, 1, 1, 3]); });
});
