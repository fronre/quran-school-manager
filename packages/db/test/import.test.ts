import { describe, it, expect, beforeEach } from 'vitest';
import type { Assignment, StudentInput } from '@mishkat/domain';
import { analyzeImport } from '@mishkat/domain';
import { openDb, migrate, newId, verifyAuditLog, listStudents, createStudent, importStudents, existingForImport, MAX_IMPORT_ROWS, type Ctx } from '../src';

const NOW = '2026-11-20T09:00:00.000Z'; const T = newId();
function world() {
  const db = openDb(':memory:'); migrate(db);
  db.prepare('INSERT INTO association(id,tenant_id,created_at,updated_at,created_by,updated_by,name) VALUES (?,?,?,?,?,?,?)').run(T, T, NOW, NOW, 's', 's', 'ج');
  const br = (n: string, p: number) => { const id = newId(); db.prepare('INSERT INTO branch(id,tenant_id,created_at,updated_at,created_by,updated_by,name,position) VALUES (?,?,?,?,?,?,?,?)').run(id, T, NOW, NOW, 's', 's', n, p); return id; };
  const men = br('فرع الرجال', 1), women = br('فرع النساء', 2);
  const ctx = (a: Assignment[]): Ctx => ({ db, tenantId: T, actorId: 'u1', assignments: a, now: () => NOW });
  return { db, men, women, director: ctx([{ role: 'director', branchId: null }]), supMen: ctx([{ role: 'branch_supervisor', branchId: men }]), registrar: ctx([{ role: 'registrar', branchId: men }]) };
}
const si = (branchId: string, no: string, over: Partial<StudentInput> = {}): StudentInput => ({ givenName: 'طالب' + no, familyName: 'اختبار', birthDate: null, phone: null, branchId, status: 'active', joinedOn: null, studentNo: no, ...over });
const META = { fileName: 'طلاب.xlsx', fileSha256: 'a'.repeat(64), rowsInFile: 3 };
const count = (db: Ctx['db'], t: string) => (db.prepare(`SELECT count(*) c FROM ${t}`).get() as { c: number }).c;

describe('importStudents (BR-045)', () => {
  let w: ReturnType<typeof world>; beforeEach(() => { w = world(); });

  it('imports everything in one go, searchable immediately, with ONE audit entry describing the file', () => {
    const r = importStudents(w.director, [si(w.men, '1', { givenName: 'مُحَمَّد' }), si(w.women, '2'), si(w.men, '3')], META);
    expect(r).toEqual({ ok: true, count: 3 });
    expect(listStudents(w.director, { search: 'محمد' }).total).toBe(1); expect(listStudents(w.director).total).toBe(3);
    const a = w.db.prepare("SELECT action, after_json j FROM audit_log WHERE action='student.import'").all() as { action: string; j: string }[];
    expect(a).toHaveLength(1); expect(JSON.parse(a[0]!.j)).toEqual({ file: 'طلاب.xlsx', sha256: 'a'.repeat(64), rowsInFile: 3, imported: 3, skipped: 0 });
    expect(verifyAuditLog(w.db)).toEqual({ ok: true });
  });
  it('records skipped rows when only part of the file was imported', () => {
    importStudents(w.director, [si(w.men, '1')], { ...META, rowsInFile: 5 });
    expect(JSON.parse((w.db.prepare("SELECT after_json j FROM audit_log WHERE action='student.import'").get() as { j: string }).j)).toMatchObject({ imported: 1, skipped: 4 });
  });
  it('is all-or-nothing: one bad row anywhere leaves the database untouched', () => {
    const rows = [si(w.men, '1'), si(w.men, '2'), si(w.men, '3', { givenName: '' }), si(w.men, '4')];
    expect(importStudents(w.director, rows, META)).toEqual({ ok: false, error: 'invalid', index: 2 });
    expect(count(w.db, 'student')).toBe(0); expect(count(w.db, 'person')).toBe(0); expect(count(w.db, 'audit_log')).toBe(0);
  });
  it('re-checks numbers against the database and inside the batch', () => {
    createStudent(w.director, si(w.men, '7', { birthDate: null }));
    expect(importStudents(w.director, [si(w.men, '8'), si(w.men, '7')], META)).toEqual({ ok: false, error: 'duplicate_number', index: 1 });
    expect(importStudents(w.director, [si(w.men, '9'), si(w.men, '9')], META)).toEqual({ ok: false, error: 'duplicate_number', index: 1 });
    expect(count(w.db, 'student')).toBe(1);
  });
  it('only the Director may import (matrix), regardless of branch rights', () => {
    for (const c of [w.supMen, w.registrar]) expect(importStudents(c, [si(w.men, '1')], META)).toEqual({ ok: false, error: 'forbidden' });
    expect(importStudents(w.director, [si(w.men, '1')], META).ok).toBe(true);
  });
  it('rejects unknown/inactive branches, empty input and oversized batches', () => {
    expect(importStudents(w.director, [si('nope', '1')], META)).toEqual({ ok: false, error: 'branch_not_found' });
    w.db.prepare('UPDATE branch SET active=0, version=version+1 WHERE id=?').run(w.women);
    expect(importStudents(w.director, [si(w.women, '1')], META)).toEqual({ ok: false, error: 'branch_not_found' });
    expect(importStudents(w.director, [], META)).toEqual({ ok: false, error: 'nothing_to_import' });
    expect(importStudents(w.director, Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => si(w.men, String(i))), META)).toEqual({ ok: false, error: 'too_many' });
  });
  it('does not trust the caller: invalid dates or statuses are rejected even if the preview said fine', () => {
    expect(importStudents(w.director, [si(w.men, '1', { birthDate: '2015-02-30' })], META)).toMatchObject({ ok: false, error: 'invalid' });
    expect(importStudents(w.director, [si(w.men, '1', { status: 'ghost' as never })], META)).toMatchObject({ ok: false, error: 'invalid' });
  });
  it('imports 2,000 students quickly', () => {
    const t0 = performance.now();
    expect(importStudents(w.director, Array.from({ length: 2000 }, (_, i) => si(i % 2 ? w.men : w.women, String(i + 1))), { ...META, rowsInFile: 2000 })).toEqual({ ok: true, count: 2000 });
    expect(performance.now() - t0).toBeLessThan(5000); expect(listStudents(w.director).total).toBe(2000);
  });
});

describe('existingForImport + analyzeImport together', () => {
  it('knows used numbers, people and the next free number', () => {
    const w = world();
    createStudent(w.director, si(w.men, '0005', { givenName: 'أحمد', familyName: 'بن عمر', birthDate: '2015-03-10' })); createStudent(w.director, si(w.men, 'M-1'));
    const e = existingForImport(w.director);
    expect([...e.numbers].sort()).toEqual(['0005', 'M-1']); expect(e.nextNo).toBe(6); expect(e.people).toEqual([{ key: 'احمد بن عمر', birthDate: '2015-03-10' }]);
  });
  it('a full round: analyze with real existing data, then import only the valid rows', () => {
    const w = world(); createStudent(w.director, si(w.men, '1', { givenName: 'أحمد', familyName: 'بن عمر', birthDate: '2015-03-10' }));
    const rows = [['أحمد بن عمر', '10/03/2015'], ['فاطمة بلقاسم', '01/01/2014'], ['', '']];
    const rep = analyzeImport(rows, 2, { mapping: { fullName: 0, birthDate: 1 }, nameOrder: 'given-first', defaultBranchId: w.men, branches: [{ id: w.men, name: 'فرع الرجال' }], defaultStatus: 'active', today: '2026-11-20' }, existingForImport(w.director));
    expect(rep.withIssues).toBe(1); expect(rep.withWarnings).toBe(1);
    const good = rep.rows.filter((r) => r.issues.length === 0).map((r) => r.input!);
    expect(importStudents(w.director, good, { ...META, rowsInFile: 3 })).toEqual({ ok: true, count: 2 });
    expect(listStudents(w.director).total).toBe(3);
  });
});
