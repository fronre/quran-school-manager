import { describe, it, expect, beforeEach } from 'vitest';
import type { Assignment, GuardianInput } from '@mishkat/domain';
import { openDb, migrate, verifyAuditLog, runSetup, generateRecoveryKey, createStudent, listGuardians, addGuardian, updateGuardian, removeGuardian, whatsappTarget, previewGuardianImport, commitGuardianImport, type Ctx } from '../src';

const FAST = { memoryKiB: 8, passes: 1, parallelism: 1 };
const ok = <R extends { ok: boolean }>(r: R): Extract<R, { ok: true }> => { if (!r.ok) throw new Error('expected ok: ' + JSON.stringify(r)); return r as Extract<R, { ok: true }>; };
const G = (over: Partial<GuardianInput> = {}): GuardianInput => ({ name: 'علي بن محمد', phone: '0550 12 34 56', relation: 'father', isPrimary: false, ...over });

function world() {
  const db = openDb(':memory:'); migrate(db);
  const { tenantId } = runSetup(db, { admin: { givenName: 'مستخدم', familyName: 'البرنامج', username: 'user1', password: 'a-long-test-password' }, association: { name: 'جمعية' },
    branches: [{ name: 'فرع الرجال' }, { name: 'فرع النساء' }], year: { name: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30' } }, generateRecoveryKey().key, { argon2: FAST });
  const [men, women] = (db.prepare('SELECT id FROM branch ORDER BY position').all() as { id: string }[]).map((b) => b.id) as [string, string];
  const ctx = (a: Assignment[]): Ctx => ({ db, tenantId, actorId: 'u1', assignments: a, now: () => '2026-11-20T09:00:00.000Z' });
  const director = ctx([{ role: 'director', branchId: null }]);
  const stu = (b: string, n: number, over: object = {}) => ok(createStudent(director, { givenName: 'طالب' + n, familyName: 'اختبار', birthDate: null, phone: null, branchId: b, status: 'active', joinedOn: null, studentNo: String(n), ...over })).id;
  return { db, men, women, director, stu, regMen: ctx([{ role: 'registrar', branchId: men }]), acadMen: ctx([{ role: 'academic_supervisor', branchId: men }]), supMen: ctx([{ role: 'branch_supervisor', branchId: men }]), supWomen: ctx([{ role: 'branch_supervisor', branchId: women }]) };
}

describe('guardians of a student', () => {
  let w: ReturnType<typeof world>; let s1: string; beforeEach(() => { w = world(); s1 = w.stu(w.men, 1); });
  it('adds a guardian with a normalized phone; the first one becomes the primary contact', () => {
    ok(addGuardian(w.regMen, s1, G())); const l = listGuardians(w.regMen, s1)!; expect(l).toHaveLength(1); expect(l[0]).toMatchObject({ name: 'علي بن محمد', phone: '0550123456', relation: 'father', isPrimary: true, whatsapp: true, siblings: 0 });
    expect(verifyAuditLog(w.db)).toEqual({ ok: true });
  });
  it('a later primary replaces the earlier one; there is always at most one', () => {
    ok(addGuardian(w.regMen, s1, G())); ok(addGuardian(w.regMen, s1, G({ name: 'فاطمة', phone: '0661234567', relation: 'mother', isPrimary: true })));
    expect(listGuardians(w.regMen, s1)!.map((g) => [g.name, g.isPrimary])).toEqual([['فاطمة', true], ['علي بن محمد', false]]);
    expect(w.db.prepare('SELECT count(*) c FROM student_guardian WHERE is_primary = 1').get()).toEqual({ c: 1 });
  });
  it('siblings share one guardian record (same name and phone) and it shows on each', () => {
    const s2 = w.stu(w.men, 2); ok(addGuardian(w.regMen, s1, G())); const r = ok(addGuardian(w.regMen, s2, G({ phone: '+213550123456' }))); expect(r.reused).toBe(true);
    expect(w.db.prepare('SELECT count(*) c FROM guardian').get()).toEqual({ c: 1 }); expect(listGuardians(w.regMen, s1)![0]!.siblings).toBe(1);
    expect(addGuardian(w.regMen, s2, G())).toEqual({ ok: false, error: 'already_linked' });
  });
  it('same phone with another name is a different guardian', () => { ok(addGuardian(w.regMen, s1, G())); ok(addGuardian(w.regMen, s1, G({ name: 'عمر' }))); expect(w.db.prepare('SELECT count(*) c FROM guardian').get()).toEqual({ c: 2 }); });
  it('rejects bad data with issue codes and writes nothing', () => {
    const r = addGuardian(w.regMen, s1, G({ name: ' ', phone: 'abc', relation: 'x' as never })); expect(r).toMatchObject({ ok: false, error: 'invalid' }); expect((r as { issues: { field: string }[] }).issues.map((i) => i.field)).toEqual(['name', 'phone', 'relation']);
    expect(w.db.prepare('SELECT count(*) c FROM guardian').get()).toEqual({ c: 0 });
  });
  it('landline numbers are kept but not offered for WhatsApp', () => { ok(addGuardian(w.regMen, s1, G({ phone: '029123456' }))); expect(listGuardians(w.regMen, s1)![0]).toMatchObject({ phone: '029123456', whatsapp: false }); const l = w.db.prepare('SELECT id FROM student_guardian').get() as { id: string }; expect(whatsappTarget(w.regMen, l.id)).toBeNull(); });
  it('enforces roles and branch scope; out-of-scope students look absent', () => {
    expect(addGuardian(w.acadMen, s1, G())).toEqual({ ok: false, error: 'forbidden' }); expect(addGuardian(w.supWomen, s1, G())).toEqual({ ok: false, error: 'student_not_found' });
    ok(addGuardian(w.supMen, s1, G())); expect(listGuardians(w.supWomen, s1)).toBeNull(); expect(listGuardians(w.acadMen, s1)).toHaveLength(1); expect(listGuardians(w.regMen, 'nope')).toBeNull();
  });
  it('updates a shared guardian for everyone, with optimistic locking, and needs the right on every linked branch', () => {
    const s2 = w.stu(w.men, 2); ok(addGuardian(w.regMen, s1, G())); ok(addGuardian(w.regMen, s2, G())); const l = listGuardians(w.regMen, s1)![0]!;
    ok(updateGuardian(w.regMen, l.linkId, l.version, G({ phone: '0771234567', relation: 'uncle' }))); expect(listGuardians(w.regMen, s2)![0]).toMatchObject({ phone: '0771234567', relation: 'father' }); expect(listGuardians(w.regMen, s1)![0]).toMatchObject({ phone: '0771234567', relation: 'uncle' });
    expect(updateGuardian(w.regMen, l.linkId, l.version, G())).toEqual({ ok: false, error: 'conflict' }); expect(updateGuardian(w.acadMen, l.linkId, 2, G())).toEqual({ ok: false, error: 'forbidden' });
    const sw = w.stu(w.women, 9); ok(addGuardian(w.director, sw, G({ phone: '0771234567' }))); const l2 = listGuardians(w.regMen, s1)![0]!; expect(updateGuardian(w.regMen, l2.linkId, l2.version, G())).toEqual({ ok: false, error: 'forbidden' }); // shared with the other branch
  });
  it('removing keeps a tombstone, hands the primary role on, and retires a guardian with no students left', () => {
    ok(addGuardian(w.regMen, s1, G())); ok(addGuardian(w.regMen, s1, G({ name: 'فاطمة', phone: '0661234567', relation: 'mother' }))); const [first, second] = listGuardians(w.regMen, s1)!;
    ok(removeGuardian(w.regMen, first!.linkId)); expect(listGuardians(w.regMen, s1)!.map((g) => [g.name, g.isPrimary])).toEqual([['فاطمة', true]]);
    ok(removeGuardian(w.regMen, second!.linkId)); expect(listGuardians(w.regMen, s1)).toEqual([]); expect(w.db.prepare('SELECT count(*) c FROM guardian WHERE deleted_at IS NULL').get()).toEqual({ c: 0 });
    expect(removeGuardian(w.regMen, first!.linkId)).toEqual({ ok: false, error: 'not_found' });
  });
  it('the database itself rejects a link to a student of another branch, and two primaries', () => {
    ok(addGuardian(w.regMen, s1, G())); const g = w.db.prepare('SELECT id FROM guardian').get() as { id: string }; const now = '2026-11-20T09:00:00.000Z';
    const ins = (sid: string, br: string, id: string, pr: number) => () => w.db.prepare("INSERT INTO student_guardian(id,tenant_id,created_at,updated_at,created_by,updated_by,student_id,guardian_id,branch_id,relation,is_primary) SELECT ?,tenant_id,?,?,'u','u',?,?,?,'father',? FROM guardian LIMIT 1").run(id, now, now, sid, g.id, br, pr);
    const s2 = w.stu(w.men, 2); expect(ins(s2, w.women, '00000000-0000-7000-8000-0000000000a1', 0)).toThrow(/FOREIGN KEY/);
    w.db.prepare("INSERT INTO student_guardian(id,tenant_id,created_at,updated_at,created_by,updated_by,student_id,guardian_id,branch_id,relation,is_primary) SELECT '00000000-0000-7000-8000-0000000000a2',tenant_id,?,?,'u','u',?,?,?,'father',1 FROM guardian LIMIT 1").run(now, now, s2, g.id, w.men);
    expect(() => w.db.prepare("INSERT INTO student_guardian(id,tenant_id,created_at,updated_at,created_by,updated_by,student_id,guardian_id,branch_id,relation,is_primary) SELECT '00000000-0000-7000-8000-0000000000a3',tenant_id,?,?,'u','u',?,?,?,'mother',1 FROM guardian LIMIT 1").run(now, now, s2, g.id, w.men)).toThrow(/UNIQUE/);
  });
});

describe('guardian import', () => {
  const map = { studentNo: 0, studentName: 1, guardianName: 2, phone: 3, relation: 4 };
  it('links matched rows, creates shared guardians once, ignores what is already linked, and refuses problems unless skipping', () => {
    const w = world(); const a = w.stu(w.men, 1, { givenName: 'أحمد', familyName: 'بن علي' }); w.stu(w.men, 2, { givenName: 'يوسف', familyName: 'بن علي' }); w.stu(w.women, 3, { givenName: 'فاطمة', familyName: 'زهراء' });
    const rows = [['1', '', 'علي بن محمد', '550123456', 'الأب'], ['2', '', 'علي بن محمد', '0550 12 34 56', 'الأب'], ['3', '', 'خالد', '0661234567', 'الأب'], ['99', '', 'مجهول', '0661234567', null], ['', 'فاطمة زهراء', 'أم فاطمة', 'xx', 'الأم']];
    const p = previewGuardianImport(w.regMen, rows, 1, map); expect(p.rows.map((r) => r.issues)).toEqual([[], [], ['student_not_found'], ['student_not_found'], ['student_not_found', 'bad_phone']]); // the registrar only manages the men's branch
    expect(commitGuardianImport(w.regMen, rows, 1, map, false)).toEqual({ ok: false, error: 'invalid' }); expect(w.db.prepare('SELECT count(*) c FROM guardian').get()).toEqual({ c: 0 });
    expect(ok(commitGuardianImport(w.regMen, rows, 1, map, true))).toMatchObject({ linked: 2, created: 1, alreadyThere: 0, skipped: 3 }); expect(w.db.prepare('SELECT count(*) c FROM guardian').get()).toEqual({ c: 1 });
    expect(listGuardians(w.regMen, a)![0]).toMatchObject({ phone: '0550123456', siblings: 1, isPrimary: true });
    expect(ok(commitGuardianImport(w.regMen, rows.slice(0, 2), 1, map, false))).toMatchObject({ linked: 0, alreadyThere: 2, created: 0 }); // the same file again adds nothing
    expect(verifyAuditLog(w.db)).toEqual({ ok: true });
  });
  it('the director reaches both branches; nothing to import and too-large files are refused', () => {
    const w = world(); w.stu(w.women, 3, { givenName: 'فاطمة', familyName: 'زهراء' });
    expect(ok(commitGuardianImport(w.director, [['3', '', 'أم فاطمة', '0661234567', 'الأم']], 1, map, false)).linked).toBe(1);
    expect(commitGuardianImport(w.director, [], 1, map, false)).toEqual({ ok: false, error: 'nothing_to_import' }); expect(commitGuardianImport(w.acadMen, [['3', '', 'x', '0661234567', null]], 1, map, true)).toEqual({ ok: false, error: 'nothing_to_import' });
  });
});
