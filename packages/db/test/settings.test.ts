import { describe, it, expect, beforeEach } from 'vitest';
import type { Assignment } from '@mishkat/domain';
import { MAX_BRANCHES } from '@mishkat/domain';
import { openDb, migrate, runSetup, generateRecoveryKey, login, verifyAuditLog, createStudent, createStaff, getSettings, updateAssociation, renameBranch, addBranch, changeLoginPassword, type Ctx } from '../src';

const FAST = { memoryKiB: 8, passes: 1, parallelism: 1 };
let clockMs = Date.parse('2026-11-20T09:00:00.000Z'); const NOW = () => new Date(clockMs).toISOString();
const PW = 'a-long-test-password';

function world() {
  const db = openDb(':memory:'); migrate(db);
  const { tenantId, userId } = runSetup(db, { admin: { givenName: 'مستخدم', familyName: 'البرنامج', username: 'user1', password: PW }, association: { name: 'جمعية علماء المسلمين في سيدي عون', address: 'سيدي عون' },
    branches: [{ name: 'فرع الرجال' }, { name: 'فرع النساء' }], year: { name: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30' } }, generateRecoveryKey().key, { argon2: FAST });
  const [men, women] = (db.prepare('SELECT id FROM branch ORDER BY position').all() as { id: string }[]).map((b) => b.id) as [string, string];
  const ctx = (a: Assignment[], actorId = userId): Ctx => ({ db, tenantId, actorId, assignments: a, now: NOW });
  return { db, tenantId, userId, men, women, director: ctx([{ role: 'director', branchId: null }]), registrar: ctx([{ role: 'registrar', branchId: men }]), pw: (userId2 = userId) => ({ db, tenantId, userId: userId2, now: NOW, argon2: FAST }) };
}
const ok = <R extends { ok: boolean }>(r: R): Extract<R, { ok: true }> => { if (!r.ok) throw new Error('expected ok: ' + JSON.stringify(r)); return r as Extract<R, { ok: true }>; };
beforeEach(() => { clockMs = Date.parse('2026-11-20T09:00:00.000Z'); });

describe('settings overview', () => {
  it('shows the association, branches with live counts, and the login name', () => {
    const w = world();
    createStudent(w.director, { givenName: 'أحمد', familyName: 'ا', birthDate: null, phone: null, branchId: w.men, status: 'active', joinedOn: null, studentNo: '1' });
    createStaff(w.director, { givenName: 'عمر', familyName: 'ب', birthDate: null, phone: null, branchId: w.women, position: 'teacher', kind: 'employee' });
    const s = getSettings(w.director)!;
    expect(s.association).toMatchObject({ name: 'جمعية علماء المسلمين في سيدي عون', address: 'سيدي عون', contact: null, version: 1 }); expect(s.username).toBe('user1');
    expect(s.branches.map((b) => [b.name, b.students, b.teachers, b.active])).toEqual([['فرع الرجال', 1, 0, true], ['فرع النساء', 0, 1, true]]);
  });
  it('is closed to roles without the settings permission', () => {
    const w = world(); expect(getSettings(w.registrar)).toBeNull();
    expect(updateAssociation(w.registrar, 1, { name: 'x', address: '', contact: '' })).toEqual({ ok: false, error: 'forbidden' });
    expect(renameBranch(w.registrar, w.men, 1, 'x')).toEqual({ ok: false, error: 'forbidden' }); expect(addBranch(w.registrar, 'x')).toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('association details', () => {
  let w: ReturnType<typeof world>; beforeEach(() => { w = world(); });
  it('updates, trims, stores blanks as null, bumps the version and audits before/after', () => {
    ok(updateAssociation(w.director, 1, { name: '  جمعية العلماء  ', address: '   ', contact: '0550 12 34 56' }));
    expect(getSettings(w.director)!.association).toMatchObject({ name: 'جمعية العلماء', address: null, contact: '0550 12 34 56', version: 2 });
    const a = w.db.prepare("SELECT before_json b, after_json a FROM audit_log WHERE action='association.update'").get() as { b: string; a: string };
    expect(JSON.parse(a.b).address).toBe('سيدي عون'); expect(JSON.parse(a.a).address).toBeNull(); expect(verifyAuditLog(w.db)).toEqual({ ok: true });
  });
  it('rejects a blank or oversized name, and a stale version', () => {
    for (const bad of [{ name: '  ', address: '', contact: '' }, { name: 'ا'.repeat(101), address: '', contact: '' }, { name: 'x', address: 'ا'.repeat(301), contact: '' }]) expect(updateAssociation(w.director, 1, bad)).toEqual({ ok: false, error: 'invalid' });
    ok(updateAssociation(w.director, 1, { name: 'a', address: '', contact: '' })); expect(updateAssociation(w.director, 1, { name: 'b', address: '', contact: '' })).toEqual({ ok: false, error: 'conflict' });
  });
});

describe('branches', () => {
  let w: ReturnType<typeof world>; beforeEach(() => { w = world(); });
  it('renames a branch with an audit entry; the same name is a no-op; stale versions conflict', () => {
    ok(renameBranch(w.director, w.men, 1, '  فرع الذكور ')); expect(getSettings(w.director)!.branches[0]).toMatchObject({ name: 'فرع الذكور', version: 2 });
    expect(renameBranch(w.director, w.men, 2, 'فرع الذكور')).toEqual({ ok: true }); expect(getSettings(w.director)!.branches[0]!.version).toBe(2);
    expect(renameBranch(w.director, w.men, 1, 'آخر')).toEqual({ ok: false, error: 'conflict' }); expect(w.db.prepare("SELECT count(*) c FROM audit_log WHERE action='branch.rename'").get()).toEqual({ c: 1 });
  });
  it('refuses duplicate names (any case), blank names and unknown branches', () => {
    expect(renameBranch(w.director, w.men, 1, 'فرع النساء')).toEqual({ ok: false, error: 'duplicate_name' }); expect(renameBranch(w.director, w.men, 1, '  ')).toEqual({ ok: false, error: 'invalid' });
    expect(renameBranch(w.director, 'nope', 1, 'x')).toEqual({ ok: false, error: 'not_found' }); expect(addBranch(w.director, 'فرع النساء')).toEqual({ ok: false, error: 'duplicate_name' });
  });
  it('adds a branch at the end, up to the maximum', () => {
    const { id } = ok(addBranch(w.director, 'الفرع الثالث')); expect(getSettings(w.director)!.branches.map((b) => b.name)).toEqual(['فرع الرجال', 'فرع النساء', 'الفرع الثالث']);
    expect(w.db.prepare('SELECT position FROM branch WHERE id = ?').get(id)).toEqual({ position: 3 });
    for (let i = 4; i <= MAX_BRANCHES; i++) ok(addBranch(w.director, 'فرع ' + i)); expect(addBranch(w.director, 'زائد')).toEqual({ ok: false, error: 'too_many' });
  });
});

describe('shared login password', () => {
  let w: ReturnType<typeof world>; beforeEach(() => { w = world(); });
  it('changes with the old password; the new one signs in and the old one no longer does', () => {
    expect(changeLoginPassword(w.pw(), PW, 'كلمة جديدة طويلة 2027')).toEqual({ ok: true });
    expect(login(w.db, { tenantId: w.tenantId, username: 'user1', password: 'كلمة جديدة طويلة 2027' }, { argon2: FAST, now: NOW }).ok).toBe(true);
    expect(login(w.db, { tenantId: w.tenantId, username: 'user1', password: PW }, { argon2: FAST, now: NOW }).ok).toBe(false);
    expect(JSON.stringify(w.db.prepare('SELECT * FROM audit_log').all())).not.toContain('كلمة جديدة'); expect(verifyAuditLog(w.db)).toEqual({ ok: true });
  });
  it('rejects a weak new password and one containing the username, without changing anything', () => {
    expect(changeLoginPassword(w.pw(), PW, 'short')).toEqual({ ok: false, error: 'weak' }); expect(changeLoginPassword(w.pw(), PW, 'my-user1-secret-x')).toEqual({ ok: false, error: 'weak' });
    expect(login(w.db, { tenantId: w.tenantId, username: 'user1', password: PW }, { argon2: FAST, now: NOW }).ok).toBe(true);
  });
  it('slows guessing of the old password: locked after 5 wrong tries, free after the delay', () => {
    for (let i = 0; i < 4; i++) expect(changeLoginPassword(w.pw(), 'wrong-password-1', 'كلمة جديدة طويلة 2027')).toMatchObject({ ok: false, error: 'wrong' });
    expect(changeLoginPassword(w.pw(), 'wrong-password-1', 'كلمة جديدة طويلة 2027')).toEqual({ ok: false, error: 'wrong', retryAfterSeconds: 30 });
    expect(changeLoginPassword(w.pw(), PW, 'كلمة جديدة طويلة 2027')).toMatchObject({ ok: false, error: 'locked' });
    clockMs += 31_000; expect(changeLoginPassword(w.pw(), PW, 'كلمة جديدة طويلة 2027')).toEqual({ ok: true });
  });
  it('reports an unknown user', () => { expect(changeLoginPassword(w.pw('missing'), PW, 'كلمة جديدة طويلة 2027')).toEqual({ ok: false, error: 'not_found' }); });
});
