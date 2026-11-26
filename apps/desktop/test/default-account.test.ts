import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, migrate, runSetup, generateRecoveryKey, saveRecoveryKey, login, verifyAuditLog, SetupError, resetLoginPassword, type Protector } from '@mishkat/db';
import { createDispatcher, type Deps } from '../src/main/ipc';

const FAST = { memoryKiB: 8, passes: 1, parallelism: 1 };
const xor = (b: Buffer) => Buffer.from(b.map((x) => x ^ 0x5a)); const prot: Protector = { available: () => true, encrypt: xor, decrypt: xor };
const STRONG = 'كلمة جديدة طويلة 2027';
const input = (u = 'ignored', p = 'ignored-but-strong-1') => ({ admin: { givenName: 'م', familyName: 'ب', username: u, password: p }, association: { name: 'ج' }, branches: [{ name: 'فرع' }], year: { name: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30' } });
function deps(db: ReturnType<typeof openDb>, dir: string, tenant: () => string | null): Deps {
  return { db, version: '0', session: { current: null }, authOptions: { argon2: FAST }, dataDir: dir, protector: prot, settings: { get: () => ({ backupFolder: null }), set: () => undefined }, pickFolder: async () => null, defaultBackupFolder: dir,
    wizard: { key: null, backupFolder: null }, tenantId: tenant, importJob: { current: null }, finance: { lastActive: null }, dbPath: join(dir, 'x.db'), restart: () => undefined, pickImage: async () => null, processImage: () => null, pickOpenFile: async () => null, saveFile: async () => null };
}

describe('the standard account admin / admin (OD-050)', () => {
  it('setup with defaultAccount creates admin/admin and flags it, whatever credentials were sent', () => {
    const db = openDb(':memory:'); migrate(db); const rk = generateRecoveryKey(); const { tenantId } = runSetup(db, input('somebody-else', 'short'), rk.key, { argon2: FAST, defaultAccount: true });
    expect(db.prepare('SELECT username u, must_change_password m FROM user_account').all()).toEqual([{ u: 'admin', m: 1 }]);
    expect(login(db, { tenantId, username: 'admin', password: 'admin' }, { argon2: FAST })).toMatchObject({ ok: true, mustChangePassword: true }); expect(login(db, { tenantId, username: 'somebody-else', password: 'short' }, { argon2: FAST })).toEqual({ ok: false, error: 'invalid_credentials' });
  });
  it('the password policy is NOT relaxed for ordinary setups: a weak password is still refused', () => {
    const db = openDb(':memory:'); migrate(db); expect(() => runSetup(db, input('admin', 'admin'), generateRecoveryKey().key, { argon2: FAST })).toThrow(SetupError);
    const ok = runSetup(db, input('islam', 'a-long-test-password'), generateRecoveryKey().key, { argon2: FAST }); expect(login(db, { tenantId: ok.tenantId, username: 'islam', password: 'a-long-test-password' }, { argon2: FAST })).toMatchObject({ ok: true, mustChangePassword: false });
  });
  it('a fresh start through IPC: signed in as admin, nothing works until the password is changed, then everything does', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mishkat-da-')); const db = openDb(':memory:'); migrate(db);
    const run = createDispatcher(deps(db, dir, () => (db.prepare('SELECT id FROM association LIMIT 1').get() as { id: string } | undefined)?.id ?? null)); const begin = (await run('setup.begin', {})) as { keyDisplay: string }; const g = begin.keyDisplay.split('-');
    expect(await run('app.info', {})).toMatchObject({ setupNeeded: true, defaultAccountHint: false });
    const r = (await run('setup.commit', { ...input(), keyConfirm: { first: g[0], last: g[g.length - 1] }, defaultAccount: true })) as { ok: boolean; user: { mustChange: boolean } }; expect(r.ok).toBe(true); expect(r.user.mustChange).toBe(true);
    expect(await run('app.info', {})).toMatchObject({ setupNeeded: false, defaultAccountHint: true });
    for (const ch of ['students.list', 'groups.list', 'settings.get', 'backup.list', 'home.summary'] as const) await expect(run(ch, {}), ch).rejects.toMatchObject({ code: 'forbidden' });
    expect(await run('session.current', {})).toMatchObject({ user: { mustChange: true } });
    expect(await run('account.changePassword', { oldPassword: 'admin', newPassword: 'admin' })).toMatchObject({ ok: false, error: 'weak' }); await expect(run('students.list', {})).rejects.toMatchObject({ code: 'forbidden' });
    expect(await run('account.changePassword', { oldPassword: 'admin', newPassword: STRONG })).toEqual({ ok: true });
    expect(await run('students.list', {})).toMatchObject({ rows: [] }); expect(await run('app.info', {})).toMatchObject({ defaultAccountHint: false }); expect(((await run('session.current', {})) as { user: { mustChange: boolean } }).user.mustChange).toBe(false);
    await run('auth.logout', {}); expect(await run('auth.login', { username: 'admin', password: 'admin' })).toEqual({ ok: false }); expect(await run('auth.login', { username: 'admin', password: STRONG })).toMatchObject({ ok: true, user: { mustChange: false } });
    expect(verifyAuditLog(db)).toEqual({ ok: true });
  });
  it('signing in with admin/admin keeps the lock; logout is always possible; the recovery key also clears the flag', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mishkat-da2-')); const db = openDb(':memory:'); migrate(db); const rk = generateRecoveryKey(); const { tenantId } = runSetup(db, input(), rk.key, { argon2: FAST, defaultAccount: true }); saveRecoveryKey(dir, prot, rk.key);
    const run = createDispatcher(deps(db, dir, () => tenantId)); expect(await run('auth.login', { username: 'admin', password: 'admin' })).toMatchObject({ ok: true, user: { mustChange: true } }); await expect(run('students.list', {})).rejects.toMatchObject({ code: 'forbidden' });
    expect(await run('auth.logout', {})).toEqual({ ok: true }); expect(resetLoginPassword({ db, tenantId, argon2: FAST }, rk.display, STRONG)).toEqual({ ok: true, username: 'admin' });
    expect(await run('auth.login', { username: 'admin', password: STRONG })).toMatchObject({ ok: true, user: { mustChange: false } }); expect(await run('students.list', {})).toMatchObject({ rows: [] });
  });
});
