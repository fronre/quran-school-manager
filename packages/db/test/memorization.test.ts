import { describe, it, expect, beforeEach } from 'vitest';
import type { Assignment, AyahRange } from '@mishkat/domain';
import {
  openDb, migrate, verifyAuditLog, runSetup, generateRecoveryKey, createStudent, createGroup, enrollStudent, leaveGroup,
  recordMemorization, voidMemorization, studentProgress, groupProgress, nextAyahSuggestion, type Ctx,
} from '../src';

const FAST = { memoryKiB: 8, passes: 1, parallelism: 1 };
const ok = <R extends { ok: boolean }>(r: R): Extract<R, { ok: true }> => { if (!r.ok) throw new Error('expected ok: ' + JSON.stringify(r)); return r as Extract<R, { ok: true }>; };
const R = (a: [number, number], b: [number, number]): AyahRange => ({ start: { surah: a[0], ayah: a[1] }, end: { surah: b[0], ayah: b[1] } });

function world() {
  const db = openDb(':memory:'); migrate(db);
  const { tenantId } = runSetup(db, { admin: { givenName: 'مستخدم', familyName: 'البرنامج', username: 'user1', password: 'a-long-test-password' }, association: { name: 'جمعية' },
    branches: [{ name: 'فرع الرجال' }, { name: 'فرع النساء' }], year: { name: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30' } }, generateRecoveryKey().key, { argon2: FAST });
  const [men, women] = (db.prepare('SELECT id FROM branch ORDER BY position').all() as { id: string }[]).map((b) => b.id) as [string, string];
  let day = '2026-11-20';
  const ctx = (a: Assignment[]): Ctx => ({ db, tenantId, actorId: 'u1', assignments: a, now: () => day + 'T09:00:00.000Z' });
  const director = ctx([{ role: 'director', branchId: null }]);
  const stu = (b: string, n: number) => ok(createStudent(director, { givenName: 'طالب' + n, familyName: 'اختبار', birthDate: null, phone: null, branchId: b, status: 'active', joinedOn: '2026-09-05', studentNo: 'S' + n })).id;
  const group = ok(createGroup(director, { branchId: men, name: 'فوج أ', level: null, capacity: 10 })).id;
  const s1 = stu(men, 1); day = '2026-10-01'; ok(enrollStudent(director, group, s1)); day = '2026-11-20';
  return { db, men, women, group, s1, director, supMen: ctx([{ role: 'branch_supervisor', branchId: men }]), acadMen: ctx([{ role: 'academic_supervisor', branchId: men }]), regMen: ctx([{ role: 'registrar', branchId: men }]),
    supWomen: ctx([{ role: 'branch_supervisor', branchId: women }]), stu, setDay: (d: string) => { day = d; } };
}
const rec = (w: ReturnType<typeof world>, over: Partial<Parameters<typeof recordMemorization>[1]> = {}) => recordMemorization(w.acadMen, { studentId: w.s1, date: '2026-11-20', type: 'new', range: R([1, 1], [1, 7]), evalRank: 4, ...over });

describe('recording', () => {
  let w: ReturnType<typeof world>; beforeEach(() => { w = world(); });
  it('stores exact references, ordinals, dataset version and the evaluation with its scale version; audits', () => {
    ok(rec(w, { range: R([2, 5], [2, 20]), evalRank: 5, comment: ' ممتاز ' }));
    expect(w.db.prepare('SELECT start_surah ss, start_ayah sa, end_surah es, end_ayah ea, start_ordinal so, end_ordinal eo, dataset_version dv, eval_rank r, eval_label l, scale_version sv, comment c, type t FROM memorization_record').get())
      .toEqual({ ss: 2, sa: 5, es: 2, ea: 20, so: 12, eo: 27, dv: 'kufan-6236-v1', r: 5, l: 'ممتاز', sv: 1, c: 'ممتاز', t: 'new' }); expect(verifyAuditLog(w.db)).toEqual({ ok: true });
  });
  it('rejects invalid, reversed and non-existent ranges (BR-012, BR-033)', () => {
    expect(rec(w, { range: R([2, 287], [2, 290]) })).toEqual({ ok: false, error: 'invalid_range', detail: 'invalid_start' }); expect(rec(w, { range: R([1, 1], [1, 8]) })).toEqual({ ok: false, error: 'invalid_range', detail: 'invalid_end' });
    expect(rec(w, { range: R([2, 5], [2, 4]) })).toEqual({ ok: false, error: 'invalid_range', detail: 'reversed' }); expect(w.db.prepare('SELECT count(*) c FROM memorization_record').get()).toEqual({ c: 0 });
  });
  it('requires an enrollment on that date, no future dates, a valid evaluation, and an evaluation for new memorization', () => {
    expect(rec(w, { date: '2026-09-15' })).toEqual({ ok: false, error: 'not_enrolled' }); expect(rec(w, { date: '2026-11-21' })).toEqual({ ok: false, error: 'future_date' });
    expect(rec(w, { evalRank: 9 })).toEqual({ ok: false, error: 'invalid_eval' }); expect(rec(w, { evalRank: null })).toEqual({ ok: false, error: 'eval_required' }); expect(rec(w, { type: 'revision', evalRank: null }).ok).toBe(true);
    expect(rec(w, { date: 'x' })).toEqual({ ok: false, error: 'invalid' }); expect(rec(w, { type: 'zzz' as never })).toEqual({ ok: false, error: 'invalid' }); expect(rec(w, { comment: 'ا'.repeat(301) })).toEqual({ ok: false, error: 'invalid' });
    const lone = w.stu(w.men, 2); expect(recordMemorization(w.acadMen, { studentId: lone, date: '2026-11-20', type: 'new', range: R([1, 1], [1, 7]), evalRank: 3 })).toEqual({ ok: false, error: 'not_enrolled' });
  });
  it('a record after the student left the group is not allowed, but earlier dates still work', () => {
    w.setDay('2026-11-25'); ok(leaveGroup(w.regMen, w.group, w.s1, 'انتقل')); expect(rec(w, { date: '2026-11-25' })).toEqual({ ok: false, error: 'not_enrolled' }); expect(rec(w, { date: '2026-11-20' }).ok).toBe(true);
  });
  it('enforces roles and branch scope', () => {
    expect(recordMemorization(w.regMen, { studentId: w.s1, date: '2026-11-20', type: 'new', range: R([1, 1], [1, 7]), evalRank: 3 })).toEqual({ ok: false, error: 'not_found' }); // registrar cannot even see it
    expect(recordMemorization(w.supWomen, { studentId: w.s1, date: '2026-11-20', type: 'new', range: R([1, 1], [1, 7]), evalRank: 3 })).toEqual({ ok: false, error: 'not_found' });
    expect(recordMemorization(w.supMen, { studentId: w.s1, date: '2026-11-20', type: 'new', range: R([1, 1], [1, 7]), evalRank: 3 }).ok).toBe(true);
    expect(studentProgress(w.supWomen, w.s1)).toBeNull(); expect(studentProgress(w.regMen, w.s1)).toBeNull(); expect(studentProgress(w.acadMen, w.s1)).not.toBeNull();
  });
});

describe('progress = union of qualifying ranges (BR-034, BR-035)', () => {
  let w: ReturnType<typeof world>; beforeEach(() => { w = world(); });
  it('1:1-1:7 plus 1:5-1:7 counts 7 ayat, not 10', () => { ok(rec(w)); ok(rec(w, { range: R([1, 5], [1, 7]) })); const p = studentProgress(w.acadMen, w.s1)!; expect(p.summary.memorizedAyat).toBe(7); expect(p.summary.wholeSurahs).toBe(1); expect(p.records).toHaveLength(2); });
  it('overlapping 2:1-2:20 and 2:10-2:30 give 30 ayat; a failing and a revision record do not count', () => {
    ok(rec(w, { range: R([2, 1], [2, 20]) })); ok(rec(w, { range: R([2, 10], [2, 30]), evalRank: 5 })); ok(rec(w, { range: R([3, 1], [3, 50]), evalRank: 1 })); ok(rec(w, { type: 'revision', range: R([4, 1], [4, 90]), evalRank: 5 }));
    const p = studentProgress(w.acadMen, w.s1)!; expect(p.summary.memorizedAyat).toBe(30); expect(p.summary.pieces).toEqual([{ surah: 2, name: 'البقرة', from: 1, to: 30, whole: false }]);
    expect(p.summary.counts).toEqual({ new: 3, revision: 1, consolidation: 0 }); expect(p.records.map((r) => r.counts).sort()).toEqual([false, false, true, true]);
  });
  it('revising twenty times never inflates progress', () => { ok(rec(w)); for (let i = 0; i < 20; i++) ok(rec(w, { type: 'revision', evalRank: 5 })); expect(studentProgress(w.acadMen, w.s1)!.summary.memorizedAyat).toBe(7); });
  it('a range crossing surahs is shown surah by surah', () => {
    ok(rec(w, { range: R([1, 1], [2, 5]) })); expect(studentProgress(w.acadMen, w.s1)!.summary.pieces).toEqual([{ surah: 1, name: 'الفاتحة', from: 1, to: 7, whole: true }, { surah: 2, name: 'البقرة', from: 1, to: 5, whole: false }]);
  });
  it('suggests the ayah after the last new memorization', () => { expect(nextAyahSuggestion(w.acadMen, w.s1)).toBeNull(); ok(rec(w)); expect(nextAyahSuggestion(w.acadMen, w.s1)).toEqual({ surah: 2, ayah: 1 }); });
});

describe('voiding (explicit correction, no silent edit)', () => {
  let w: ReturnType<typeof world>; let id: string; beforeEach(() => { w = world(); id = ok(rec(w)).id; });
  it('keeps the record with who/why and removes its effect', () => {
    expect(voidMemorization(w.acadMen, id, '  ')).toEqual({ ok: false, error: 'reason_required' }); ok(voidMemorization(w.acadMen, id, 'أُدخل على الطالب الخطأ'));
    const p = studentProgress(w.acadMen, w.s1)!; expect(p.summary.memorizedAyat).toBe(0); expect(p.summary.counts.new).toBe(0); expect(p.records[0]).toMatchObject({ voided: true, voidReason: 'أُدخل على الطالب الخطأ', counts: false });
    expect(voidMemorization(w.acadMen, id, 'x')).toEqual({ ok: false, error: 'already_voided' }); expect(verifyAuditLog(w.db)).toEqual({ ok: true });
  });
  it('needs the record permission and visibility', () => { expect(voidMemorization(w.regMen, id, 'x')).toEqual({ ok: false, error: 'not_found' }); expect(voidMemorization(w.supWomen, id, 'x')).toEqual({ ok: false, error: 'not_found' }); expect(voidMemorization(w.acadMen, 'nope', 'x')).toEqual({ ok: false, error: 'not_found' }); });
  it('the database refuses to edit content, delete, or change a void', () => {
    expect(() => w.db.prepare('UPDATE memorization_record SET end_ayah = 3, end_ordinal = 3, version = version + 1').run()).toThrow(/immutable/);
    expect(() => w.db.prepare('UPDATE memorization_record SET eval_rank = 1, eval_label = ?, version = version + 1').run('يحتاج مراجعة')).toThrow(/immutable/);
    expect(() => w.db.prepare('DELETE FROM memorization_record').run()).toThrow(/physical delete/);
    ok(voidMemorization(w.acadMen, id, 'سبب')); expect(() => w.db.prepare("UPDATE memorization_record SET void_reason = 'غيّرتها', version = version + 1").run()).toThrow(/immutable/);
  });
  it('the schema rejects an impossible range and an evaluation without its scale', () => {
    const ins = (cols: string, vals: string) => () => w.db.prepare(`INSERT INTO memorization_record(id,tenant_id,created_at,updated_at,created_by,updated_by,student_id,enrollment_id,group_id,branch_id,record_date,type,dataset_version,${cols})
      SELECT '00000000-0000-7000-8000-0000000000aa',tenant_id,created_at,updated_at,'u','u',student_id,enrollment_id,group_id,branch_id,record_date,'revision','v',${vals} FROM memorization_record LIMIT 1`).run();
    expect(ins('start_surah,start_ayah,end_surah,end_ayah,start_ordinal,end_ordinal', '1,1,1,1,9,3')).toThrow(/CHECK/); expect(ins('start_surah,start_ayah,end_surah,end_ayah,start_ordinal,end_ordinal,eval_rank', '1,1,1,1,1,1,3')).toThrow(/CHECK/);
    expect(ins('start_surah,start_ayah,end_surah,end_ayah,start_ordinal,end_ordinal', '115,1,1,1,1,1')).toThrow(/CHECK/);
  });
});

describe('group progress', () => {
  it('lists current members with totals, percentage and whole surahs', () => {
    const w = world(); const s2 = w.stu(w.men, 2); w.setDay('2026-10-01'); ok(enrollStudent(w.director, w.group, s2)); w.setDay('2026-11-20');
    ok(rec(w, { range: R([1, 1], [1, 7]) })); ok(rec(w, { range: R([114, 1], [114, 6]) })); w.setDay('2026-11-20');
    const g = groupProgress(w.acadMen, w.group)!; expect(g.map((r) => [r.studentNo, r.memorizedAyat, r.wholeSurahs, r.newCount, r.lastDate])).toEqual([['S1', 13, 2, 2, '2026-11-20'], ['S2', 0, 0, 0, null]]); expect(g[0]!.pct).toBe(0.2);
    expect(groupProgress(w.supWomen, w.group)).toBeNull(); expect(groupProgress(w.regMen, w.group)).toBeNull();
  });
});
