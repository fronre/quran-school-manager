import { describe, it, expect } from 'vitest';
import type { Assignment } from '@mishkat/domain';
import { openDb, migrate, verifyAuditLog, runSetup, generateRecoveryKey, createStudent, createGroup, enrollStudent, recordMemorization, addGuardian, issueGuardianCode, revokeGuardianCode, guardianHasCode, guardianSignIn, guardianChildren, type Ctx } from '../src';

const FAST = { memoryKiB: 8, passes: 1, parallelism: 1 };
const ok = <R extends { ok: boolean }>(r: R): Extract<R, { ok: true }> => { if (!r.ok) throw new Error('expected ok: ' + JSON.stringify(r)); return r as Extract<R, { ok: true }>; };

function world() {
  const db = openDb(':memory:'); migrate(db);
  const { tenantId } = runSetup(db, { admin: { givenName: 'مستخدم', familyName: 'البرنامج', username: 'user1', password: 'a-long-test-password' }, association: { name: 'الشهاب' },
    branches: [{ name: 'فرع الرجال' }, { name: 'فرع النساء' }], year: { name: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30' } }, generateRecoveryKey().key, { argon2: FAST });
  const [men, women] = (db.prepare('SELECT id FROM branch ORDER BY position').all() as { id: string }[]).map((b) => b.id) as [string, string];
  let day = '2026-11-20'; let sec = 0;
  const ctx = (a: Assignment[]): Ctx => ({ db, tenantId, actorId: 'u1', assignments: a, now: () => `${day}T09:00:${String(sec++ % 60).padStart(2, '0')}.000Z` });
  const director = ctx([{ role: 'director', branchId: null }]);
  const group = ok(createGroup(director, { branchId: men, name: 'فوج أ', level: null, capacity: 10 })).id;
  const stu = (b: string, n: number) => ok(createStudent(director, { givenName: 'طالب' + n, familyName: 'اختبار', birthDate: null, phone: null, branchId: b, status: 'active', joinedOn: '2026-09-05', studentNo: 'S' + n })).id;
  const s1 = stu(men, 1); const s2 = stu(men, 2); const s3 = stu(women, 3);
  day = '2026-10-01'; ok(enrollStudent(director, group, s1)); day = '2026-11-20';
  return { db, tenantId, men, women, group, s1, s2, s3, director, regMen: ctx([{ role: 'registrar', branchId: men }]), acadMen: ctx([{ role: 'academic_supervisor', branchId: men }]), supWomen: ctx([{ role: 'branch_supervisor', branchId: women }]) };
}
const gid = (w: ReturnType<typeof world>, phone: string) => (w.db.prepare('SELECT id FROM guardian WHERE phone = ?').get(phone) as { id: string }).id;
const G = (name: string, phone: string) => ({ name, phone, relation: 'father' as const, isPrimary: false });

describe('guardian app (prototype)', () => {
  it('a code is shown once, stored only as a hash, and signs the guardian in by phone + code', () => {
    const w = world(); ok(addGuardian(w.regMen, w.s1, G('علي بن محمد', '0550 12 34 56'))); const g = gid(w, '0550123456');
    expect(guardianHasCode(w.db, g)).toBe(false); const r = ok(issueGuardianCode(w.regMen, g));
    expect(r.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/); expect(guardianHasCode(w.db, g)).toBe(true);
    expect(JSON.stringify(w.db.prepare('SELECT * FROM guardian_access').all())).not.toContain(r.code.replace('-', ''));
    expect(guardianSignIn(w.db, w.tenantId, '0550 12 34 56', r.code.toLowerCase().replace('-', ' '))).toMatchObject({ ok: true, guardianId: g, name: 'علي بن محمد' });
    expect(guardianSignIn(w.db, w.tenantId, '+213550123456', r.code)).toMatchObject({ ok: true });
    expect(verifyAuditLog(w.db)).toEqual({ ok: true });
  });
  it('a wrong phone or code gives the same answer; five wrong codes lock that guardian, a right one works after the lock', () => {
    const w = world(); ok(addGuardian(w.regMen, w.s1, G('علي', '0550123456'))); const c = ok(issueGuardianCode(w.regMen, gid(w, '0550123456'))).code;
    expect(guardianSignIn(w.db, w.tenantId, '0661111111', c)).toEqual({ ok: false, error: 'invalid' }); expect(guardianSignIn(w.db, w.tenantId, 'abc', c)).toEqual({ ok: false, error: 'invalid' });
    const t0 = '2026-11-20T10:00:00.000Z';
    for (let i = 0; i < 5; i++) expect(guardianSignIn(w.db, w.tenantId, '0550123456', 'AAAA-AAAA', () => t0)).toEqual({ ok: false, error: 'invalid' });
    expect(guardianSignIn(w.db, w.tenantId, '0550123456', c, () => '2026-11-20T10:05:00.000Z')).toEqual({ ok: false, error: 'locked' }); // even the right code, while locked
    expect(guardianSignIn(w.db, w.tenantId, '0550123456', c, () => '2026-11-20T10:16:00.000Z')).toMatchObject({ ok: true });
  });
  it('issuing a new code revokes the old one; revoking stops sign-in', () => {
    const w = world(); ok(addGuardian(w.regMen, w.s1, G('علي', '0550123456'))); const g = gid(w, '0550123456');
    const a = ok(issueGuardianCode(w.regMen, g)).code; const b = ok(issueGuardianCode(w.regMen, g)).code;
    expect(guardianSignIn(w.db, w.tenantId, '0550123456', a).ok).toBe(false); expect(guardianSignIn(w.db, w.tenantId, '0550123456', b).ok).toBe(true);
    expect(revokeGuardianCode(w.regMen, g)).toEqual({ ok: true }); expect(guardianHasCode(w.db, g)).toBe(false); expect(guardianSignIn(w.db, w.tenantId, '0550123456', b).ok).toBe(false);
  });
  it('only staff allowed to edit guardians of every branch involved can issue a code', () => {
    const w = world(); ok(addGuardian(w.regMen, w.s1, G('علي', '0550123456'))); const g = gid(w, '0550123456');
    expect(issueGuardianCode(w.acadMen, g)).toEqual({ ok: false, error: 'forbidden' }); expect(issueGuardianCode(w.supWomen, g)).toEqual({ ok: false, error: 'not_found' }); expect(issueGuardianCode(w.regMen, 'nope')).toEqual({ ok: false, error: 'not_found' });
    ok(addGuardian(w.director, w.s3, G('علي', '0550123456'))); // now the same guardian also has a child in the women's branch: a men's-only registrar may not issue
    expect(issueGuardianCode(w.regMen, g)).toEqual({ ok: false, error: 'forbidden' }); expect(issueGuardianCode(w.director, g).ok).toBe(true);
  });
  it('shows only the guardian\'s own active children, with progress and attendance, and nothing of anyone else', () => {
    const w = world(); ok(addGuardian(w.regMen, w.s1, G('علي', '0550123456'))); ok(addGuardian(w.regMen, w.s2, G('علي', '0550123456'))); ok(addGuardian(w.director, w.s3, G('عمر', '0661234567')));
    ok(recordMemorization(w.acadMen, { studentId: w.s1, date: '2026-11-20', type: 'new', range: { start: { surah: 1, ayah: 1 }, end: { surah: 1, ayah: 7 } }, evalRank: 4 }));
    const v = guardianChildren(w.db, w.tenantId, gid(w, '0550123456'))!; expect(v.association).toBe('الشهاب'); expect(v.children.map((c) => c.name)).toEqual(['طالب1 اختبار', 'طالب2 اختبار']);
    expect(v.children[0]).toMatchObject({ studentNo: 'S1', groupName: 'فوج أ', memorizedAyat: 7, wholeSurahs: 1, lastDate: '2026-11-20', attendance: { present: 0, late: 0, absent: 0, excused: 0 } });
    expect(v.children[0]!.recent).toHaveLength(1); expect(v.children[1]).toMatchObject({ groupName: null, memorizedAyat: 0 });
    expect(JSON.stringify(v)).not.toContain('طالب3'); expect(guardianChildren(w.db, w.tenantId, gid(w, '0661234567'))!.children.map((c) => c.name)).toEqual(['طالب3 اختبار']);
    w.db.prepare("UPDATE student SET status = 'withdrawn', version = version + 1 WHERE id = ?").run(w.s2); expect(guardianChildren(w.db, w.tenantId, gid(w, '0550123456'))!.children).toHaveLength(1); // withdrawn children disappear
  });
});
