import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, migrate, runSetup, generateRecoveryKey, saveRecoveryKey, verifyAuditLog, resetLoginPassword, type Protector } from '@mishkat/db';
import { createDispatcher, type Deps } from '../src/main/ipc';

const FAST = { memoryKiB: 8, passes: 1, parallelism: 1 };
const xor = (b: Buffer) => Buffer.from(b.map((x) => x ^ 0x5a)); const prot: Protector = { available: () => true, encrypt: xor, decrypt: xor };
const OLD = 'old-long-test-password'; const NEW = 'كلمة جديدة طويلة 2027';

function app() {
  const dir = mkdtempSync(join(tmpdir(), 'mishkat-rs-')); const db = openDb(':memory:'); migrate(db); const rk = generateRecoveryKey();
  const { tenantId } = runSetup(db, { admin: { givenName: 'م', familyName: 'ب', username: 'islam', password: OLD }, association: { name: 'ج' }, branches: [{ name: 'فرع' }], year: { name: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30' } }, rk.key, { argon2: FAST });
  saveRecoveryKey(dir, prot, rk.key); let ms = 1_000_000;
  const d: Deps = { db, version: '0', session: { current: null }, authOptions: { argon2: FAST }, dataDir: dir, protector: prot, settings: { get: () => ({ backupFolder: null }), set: () => undefined }, pickFolder: async () => null, defaultBackupFolder: dir,
    wizard: { key: null, backupFolder: null }, tenantId: () => tenantId, importJob: { current: null }, finance: { lastActive: null }, dbPath: join(dir, 'x.db'), restart: () => undefined, pickImage: async () => null, processImage: () => null, pickOpenFile: async () => null, saveFile: async () => null, nowMs: () => ms };
  const run = createDispatcher(d);
  return { db, tenantId, rk, run, d, tick: (x: number) => { ms += x; } };
}
type R = { ok: boolean; error?: string; username?: string; problems?: string[]; retryAfterSeconds?: number };

describe('resetLoginPassword (database level)', () => {
  it('with the right key sets the new password, clears a lock, returns the username, and audits', async () => {
    const a = app(); a.db.prepare("UPDATE user_account SET failed_attempts = 9, locked_until = '2099-01-01T00:00:00.000Z', version = version + 1").run();
    const r = resetLoginPassword({ db: a.db, tenantId: a.tenantId, argon2: FAST }, a.rk.display, NEW); expect(r).toEqual({ ok: true, username: 'islam' });
    expect(a.db.prepare('SELECT failed_attempts f, locked_until l FROM user_account').get()).toEqual({ f: 0, l: null });
    expect(await a.run('auth.login', { username: 'islam', password: OLD })).toEqual({ ok: false }); expect(await a.run('auth.login', { username: 'islam', password: NEW })).toMatchObject({ ok: true });
    expect(a.db.prepare("SELECT actor_id a FROM audit_log WHERE action = 'user.password.reset_by_recovery_key'").get()).toEqual({ a: 'recovery-key' }); expect(verifyAuditLog(a.db)).toEqual({ ok: true });
  });
  it('accepts the key written with spaces, lower case or without dashes', () => {
    const a = app(); const loose = a.rk.display.toLowerCase().replace(/-/g, ' '); expect(resetLoginPassword({ db: a.db, tenantId: a.tenantId, argon2: FAST }, loose, NEW)).toMatchObject({ ok: true });
  });
  it('refuses a wrong, empty, malformed or other association\'s key and changes nothing', async () => {
    const a = app(); const other = generateRecoveryKey().display;
    for (const bad of ['', 'abc', other, a.rk.display.slice(0, -5), a.rk.display.replace(/.$/, (c) => (c === '0' ? '1' : '0'))]) expect(resetLoginPassword({ db: a.db, tenantId: a.tenantId, argon2: FAST }, bad, NEW), bad).toEqual({ ok: false, error: 'bad_key' });
    expect(await a.run('auth.login', { username: 'islam', password: OLD })).toMatchObject({ ok: true }); expect(a.db.prepare("SELECT count(*) c FROM audit_log WHERE action LIKE 'user.password.reset%'").get()).toEqual({ c: 0 });
  });
  it('enforces the password policy: too short, equal to the username, blocked', () => {
    const a = app(); for (const bad of ['short', 'islam', 'islamislam']) { const r = resetLoginPassword({ db: a.db, tenantId: a.tenantId, argon2: FAST }, a.rk.display, bad); expect(r, bad).toMatchObject({ ok: false, error: 'weak' }); expect((r as R).problems!.length).toBeGreaterThan(0); }
    expect(resetLoginPassword({ db: a.db, tenantId: a.tenantId, argon2: FAST }, a.rk.display, 'x'.repeat(10) + 'y')).toMatchObject({ ok: true });
  });
});

describe('forgotten password through IPC', () => {
  it('works without being signed in, ends any session, and then the new password signs in', async () => {
    const a = app(); const r = (await a.run('auth.resetPassword', { recoveryKey: a.rk.display, newPassword: NEW })) as R; expect(r).toEqual({ ok: true, username: 'islam' });
    expect(a.d.session.current).toBeNull(); expect(await a.run('auth.login', { username: 'islam', password: NEW })).toMatchObject({ ok: true });
  });
  it('locks for 15 minutes after five wrong keys, even for the right key, then works again', async () => {
    const a = app(); const bad = a.rk.display.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    for (let i = 0; i < 5; i++) expect(await a.run('auth.resetPassword', { recoveryKey: bad, newPassword: NEW })).toMatchObject({ ok: false, error: 'bad_key' });
    const locked = (await a.run('auth.resetPassword', { recoveryKey: a.rk.display, newPassword: NEW })) as R; expect(locked).toMatchObject({ ok: false, error: 'locked' }); expect(locked.retryAfterSeconds).toBeGreaterThan(800);
    a.tick(16 * 60_000); expect(await a.run('auth.resetPassword', { recoveryKey: a.rk.display, newPassword: NEW })).toMatchObject({ ok: true });
  });
  it('a successful reset clears the counter of wrong keys', async () => {
    const a = app(); const bad = a.rk.display.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')); for (let i = 0; i < 4; i++) await a.run('auth.resetPassword', { recoveryKey: bad, newPassword: NEW });
    expect(await a.run('auth.resetPassword', { recoveryKey: a.rk.display, newPassword: NEW })).toMatchObject({ ok: true }); for (let i = 0; i < 4; i++) expect(await a.run('auth.resetPassword', { recoveryKey: bad, newPassword: NEW })).toMatchObject({ error: 'bad_key' });
  });
  it('rejects malformed payloads and is refused before setup is finished', async () => {
    const a = app(); for (const p of [{}, { recoveryKey: 'x' }, { recoveryKey: 'x', newPassword: 'y', extra: 1 }]) await expect(a.run('auth.resetPassword', p), JSON.stringify(p)).rejects.toMatchObject({ code: 'invalid_payload' });
    const fresh = openDb(':memory:'); migrate(fresh); const run = createDispatcher({ ...a.d, db: fresh, tenantId: () => null }); await expect(run('auth.resetPassword', { recoveryKey: a.rk.display, newPassword: NEW })).rejects.toMatchObject({ code: 'forbidden' });
  });
});
