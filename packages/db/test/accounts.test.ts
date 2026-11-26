import { describe, it, expect } from 'vitest';
import type { Assignment } from '@mishkat/domain';
import { openDb, migrate, verifyAuditLog, runSetup, generateRecoveryKey, login, listAccounts, createAccount, setAccountStatus, setAccountRole, resetAccountPassword, renameAccount, setFirstPassword, accountIsActive, activityLog, createStudent, type Ctx } from '../src';

const FAST = { memoryKiB: 8, passes: 1, parallelism: 1 };
const ok = <R extends { ok: boolean }>(r: R): Extract<R, { ok: true }> => { if (!r.ok) throw new Error('expected ok: ' + JSON.stringify(r)); return r as Extract<R, { ok: true }>; };

function world() {
  const db = openDb(':memory:'); migrate(db);
  const { tenantId, userId } = runSetup(db, { admin: { givenName: 'مستخدم', familyName: 'البرنامج', username: 'user1', password: 'a-long-test-password' }, association: { name: 'الشهاب' },
    branches: [{ name: 'فرع الرجال' }, { name: 'فرع النساء' }], year: { name: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30' } }, generateRecoveryKey().key, { argon2: FAST, now: '2026-11-20T08:00:00.000Z' });
  const [men, women] = (db.prepare('SELECT id FROM branch ORDER BY position').all() as { id: string }[]).map((b) => b.id) as [string, string];
  let tick = 0; const now = () => new Date(Date.parse('2026-11-20T09:00:00.000Z') + (tick++) * 1000).toISOString();
  const ctx = (actorId: string, a: Assignment[]): Ctx => ({ db, tenantId, actorId, assignments: a, now });
  const main = ctx(userId, [{ role: 'director', branchId: null }]);
  const o = { argon2: FAST };
  const login_ = (username: string, password: string) => login(db, { tenantId, username, password }, { argon2: FAST, now });
  return { db, tenantId, userId, men, women, main, ctx, o, login_ };
}
const NEW = (w: ReturnType<typeof world>, over: Partial<{ givenName: string; familyName: string; username: string; role: string; branchId: string | null }> = {}) =>
  ({ givenName: 'فاطمة', familyName: 'الزهراء', username: 'fatima', role: 'branch_supervisor', branchId: w.women, ...over });

describe('named accounts (OD-051)', () => {
  it('creates a person account with a one-time temporary password that must be replaced', () => {
    const w = world(); const r = ok(createAccount(w.main, NEW(w), w.o));
    expect(r.temporaryPassword).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
    const l = w.login_('Fatima', r.temporaryPassword); expect(l).toMatchObject({ ok: true, mustChangePassword: true, assignments: [{ role: 'branch_supervisor', branchId: w.women }] });
    expect(w.db.prepare("SELECT count(*) c FROM staff_member WHERE position = 'teacher'").get()).toEqual({ c: 0 }); // account holders are not listed as teachers
    expect(JSON.stringify(w.db.prepare('SELECT password_hash FROM user_account WHERE username = ?').get('fatima'))).not.toContain(r.temporaryPassword);
    expect(verifyAuditLog(w.db)).toEqual({ ok: true });
  });
  it('the first sign-in sets the person\'s own password (weak ones refused, once only)', () => {
    const w = world(); const r = ok(createAccount(w.main, NEW(w), w.o)); const id = ok(w.login_('fatima', r.temporaryPassword) as never as { ok: true; userId: string }).userId;
    const c = { db: w.db, tenantId: w.tenantId, userId: id, now: () => '2026-11-20T10:00:00.000Z', argon2: FAST };
    expect(setFirstPassword(c, 'short')).toMatchObject({ ok: false, error: 'weak' }); expect(setFirstPassword(c, 'fatima')).toMatchObject({ ok: false, error: 'weak' });
    expect(setFirstPassword(c, 'my own long phrase 2026')).toEqual({ ok: true });
    expect(w.login_('fatima', r.temporaryPassword).ok).toBe(false); expect(w.login_('fatima', 'my own long phrase 2026')).toMatchObject({ ok: true, mustChangePassword: false });
    expect(setFirstPassword(c, 'another long phrase 2027')).toEqual({ ok: false, error: 'not_required' });
  });
  it('validates names, usernames, role and branch; the Director has no branch', () => {
    const w = world(); ok(createAccount(w.main, NEW(w), w.o));
    expect(createAccount(w.main, NEW(w, { username: 'FATIMA' }), w.o)).toEqual({ ok: false, error: 'username_taken' });
    for (const bad of [{ username: 'a b' }, { username: 'ab' }, { username: 'x'.repeat(31) }, { givenName: '  ' }, { familyName: '<b>' }, { role: 'superuser' }, { role: 'registrar', branchId: null }]) expect(createAccount(w.main, NEW(w, { username: 'pers2', ...bad }), w.o)).toEqual({ ok: false, error: 'invalid' });
    expect(createAccount(w.main, NEW(w, { username: 'pers3', branchId: 'nope' }), w.o)).toEqual({ ok: false, error: 'branch_not_found' });
    const d = ok(createAccount(w.main, NEW(w, { username: 'second', role: 'director', branchId: w.men }), w.o)); // a branch given to a Director is ignored
    expect(w.login_('second', d.temporaryPassword)).toMatchObject({ ok: true, assignments: [{ role: 'director', branchId: null }] });
  });
  it('only a Director manages accounts', () => {
    const w = world(); const sup = w.ctx('x', [{ role: 'branch_supervisor', branchId: w.men }]);
    expect(createAccount(sup, NEW(w), w.o)).toEqual({ ok: false, error: 'forbidden' }); expect(listAccounts(sup)).toBeNull();
    expect(setAccountStatus(sup, w.userId, 'disabled')).toEqual({ ok: false, error: 'forbidden' }); expect(resetAccountPassword(sup, w.userId, w.o)).toEqual({ ok: false, error: 'forbidden' });
    expect(setAccountRole(sup, w.userId, 'registrar', w.men)).toEqual({ ok: false, error: 'forbidden' }); expect(renameAccount(sup, w.userId, 'a', 'b')).toEqual({ ok: false, error: 'forbidden' });
    expect(activityLog(sup)).toBeNull();
  });
  it('lists accounts with the main administrator marked', () => {
    const w = world(); ok(createAccount(w.main, NEW(w), w.o)); const l = listAccounts(w.main)!;
    expect(l.accounts.map((a) => [a.username, a.role, a.isMain, a.status, a.mustChange, a.branchName])).toEqual([['user1', 'director', true, 'active', false, null], ['fatima', 'branch_supervisor', false, 'active', true, 'فرع النساء']]);
    expect(l.branches).toHaveLength(2);
  });
  it('disabling blocks sign-in at once and keeps the history; never self or the main administrator', () => {
    const w = world(); const r = ok(createAccount(w.main, NEW(w), w.o)); const id = (listAccounts(w.main)!.accounts.find((a) => a.username === 'fatima')!).id;
    expect(setAccountStatus(w.main, id, 'disabled')).toEqual({ ok: true }); expect(accountIsActive(w.db, id)).toBe(false); expect(w.login_('fatima', r.temporaryPassword).ok).toBe(false);
    expect(setAccountStatus(w.main, id, 'active')).toEqual({ ok: true }); expect(w.login_('fatima', r.temporaryPassword).ok).toBe(true);
    expect(setAccountStatus(w.main, w.userId, 'disabled')).toEqual({ ok: false, error: 'self' });
    const second = ok(createAccount(w.main, NEW(w, { username: 'second', role: 'director', branchId: null }), w.o)); const sid = (listAccounts(w.main)!.accounts.find((a) => a.username === 'second')!).id; void second;
    expect(setAccountStatus(w.ctx(sid, [{ role: 'director', branchId: null }]), w.userId, 'disabled')).toEqual({ ok: false, error: 'main_account' }); // a second Director cannot lock out the first one
    expect(setAccountStatus(w.main, 'nope', 'disabled')).toEqual({ ok: false, error: 'not_found' }); expect(verifyAuditLog(w.db)).toEqual({ ok: true });
  });
  it('changes a role and branch; the main administrator and oneself are protected', () => {
    const w = world(); ok(createAccount(w.main, NEW(w), w.o)); const id = (listAccounts(w.main)!.accounts.find((a) => a.username === 'fatima')!).id;
    expect(setAccountRole(w.main, id, 'registrar', w.men)).toEqual({ ok: true });
    expect(listAccounts(w.main)!.accounts.find((a) => a.id === id)).toMatchObject({ role: 'registrar', branchId: w.men });
    expect(setAccountRole(w.main, id, 'registrar', null)).toEqual({ ok: false, error: 'invalid' }); expect(setAccountRole(w.main, id, 'director', null)).toEqual({ ok: true });
    expect(setAccountRole(w.main, w.userId, 'registrar', w.men)).toEqual({ ok: false, error: 'main_account' });
    expect(w.db.prepare('SELECT count(*) c FROM user_role_assignment WHERE user_id = ? AND deleted_at IS NULL').get(id)).toEqual({ c: 1 }); expect(verifyAuditLog(w.db)).toEqual({ ok: true });
  });
  it('resetting a forgotten password gives a new temporary one and forces a change', () => {
    const w = world(); const r = ok(createAccount(w.main, NEW(w), w.o)); const id = (listAccounts(w.main)!.accounts.find((a) => a.username === 'fatima')!).id;
    const n = ok(resetAccountPassword(w.main, id, w.o)); expect(n.temporaryPassword).not.toBe(r.temporaryPassword);
    expect(w.login_('fatima', r.temporaryPassword).ok).toBe(false); expect(w.login_('fatima', n.temporaryPassword)).toMatchObject({ ok: true, mustChangePassword: true });
    expect(resetAccountPassword(w.main, w.userId, w.o)).toEqual({ ok: false, error: 'self' });
  });
  it('renames a person and audits it', () => {
    const w = world(); expect(renameAccount(w.main, w.userId, '  عبد الله ', 'بن علي')).toEqual({ ok: true });
    expect(listAccounts(w.main)!.accounts[0]!.name).toBe('عبد الله بن علي'); expect(renameAccount(w.main, w.userId, '', 'x')).toEqual({ ok: false, error: 'invalid' });
    expect(w.db.prepare("SELECT count(*) c FROM audit_log WHERE action = 'account.rename'").get()).toEqual({ c: 1 });
  });
  it('the activity log says who did what, can be filtered by person, and its chain stays valid', () => {
    const w = world(); const r = ok(createAccount(w.main, NEW(w), w.o)); const fid = (listAccounts(w.main)!.accounts.find((a) => a.username === 'fatima')!).id;
    const fat = w.ctx(fid, [{ role: 'branch_supervisor', branchId: w.women }]);
    ok(createStudent(fat, { givenName: 'ط', familyName: 'ا', birthDate: null, phone: null, branchId: w.women, status: 'active', joinedOn: null, studentNo: '1' }));
    w.login_('fatima', r.temporaryPassword);
    const all = activityLog(w.main)!; const created = all.entries.find((e) => e.action === 'student.create')!;
    expect(created).toMatchObject({ actorName: 'فاطمة الزهراء', actorId: fid, branchName: 'فرع النساء' });
    expect(all.entries.find((e) => e.action === 'setup.complete')!.actorName).toBe('مستخدم البرنامج'); expect(all.entries.some((e) => e.action === 'user.create' || e.action === 'role.assign')).toBe(false); // account.create already says it
    expect(all.people.map((p) => p.name)).toEqual(['مستخدم البرنامج', 'فاطمة الزهراء']);
    const only = activityLog(w.main, { userId: fid })!; expect(only.entries.length).toBeGreaterThan(0); expect(only.entries.every((e) => e.actorId === fid)).toBe(true);
    const page = activityLog(w.main, { limit: 2 })!; expect(page.entries).toHaveLength(2); expect(activityLog(w.main, { limit: 2, beforeSeq: page.entries[1]!.seq })!.entries.every((e) => e.seq < page.entries[1]!.seq)).toBe(true);
    expect(verifyAuditLog(w.db)).toEqual({ ok: true });
  });
});
