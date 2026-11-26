import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, migrate, runSetup, generateRecoveryKey, saveRecoveryKey, createUser, assignRole, verifyAuditLog, type Protector } from '@mishkat/db';
import { createDispatcher, type Deps } from '../src/main/ipc';

const FAST = { memoryKiB: 8, passes: 1, parallelism: 1 };
const xor = (b: Buffer) => Buffer.from(b.map((x) => x ^ 0x5a));
const prot: Protector = { available: () => true, encrypt: xor, decrypt: xor };
const PW = 'a-long-test-password';

async function app(over: { autoBackup?: boolean; storeKey?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mishkat-sb-')); const dbPath = join(dir, 'mishkat.db');
  const db = openDb(dbPath); migrate(db);
  const rk = generateRecoveryKey();
  const { tenantId } = runSetup(db, { admin: { givenName: 'مستخدم', familyName: 'البرنامج', username: 'user1', password: PW }, association: { name: 'جمعية' },
    branches: [{ name: 'فرع الرجال' }, { name: 'فرع النساء' }], year: { name: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30' } }, rk.key, { argon2: FAST });
  if (over.storeKey !== false) saveRecoveryKey(dir, prot, rk.key);
  const [men] = (db.prepare('SELECT id FROM branch ORDER BY position').all() as { id: string }[]).map((b) => b.id) as [string];
  const t0 = '2026-09-01T08:00:00.000Z'; const p = crypto.randomUUID(), s = crypto.randomUUID();
  db.prepare('INSERT INTO person(id,tenant_id,created_at,updated_at,created_by,updated_by,given_name,family_name) VALUES (?,?,?,?,?,?,?,?)').run(p, tenantId, t0, t0, 's', 's', 'reg', 'م');
  db.prepare("INSERT INTO staff_member(id,tenant_id,created_at,updated_at,created_by,updated_by,person_id,kind,position) VALUES (?,?,?,?,?,?,?,'employee','administrator')").run(s, tenantId, t0, t0, 's', 's', p);
  const u = createUser(db, { tenantId, staffMemberId: s, username: 'regm', password: PW, actor: { id: 's', role: 'system' } }, { argon2: FAST });
  if (!u.ok) throw new Error('setup'); assignRole(db, { tenantId, userId: u.userId, role: 'registrar', branchId: men, actor: { id: 's', role: 'system' } });
  const folder = join(dir, 'backups'); const state = { saved: { backupFolder: folder as string | null }, picked: join(dir, 'picked') as string | null, restarts: 0, clock: Date.parse('2026-11-20T09:00:00.000Z') };
  const d: Deps = { db, version: '0', session: { current: null }, authOptions: { argon2: FAST }, dataDir: dir, protector: prot, settings: { get: () => state.saved, set: (v) => { state.saved = { ...state.saved, ...v } as typeof state.saved; } },
    pickFolder: async () => state.picked, defaultBackupFolder: folder, wizard: { key: null, backupFolder: null }, tenantId: () => tenantId, now: () => new Date(state.clock).toISOString(), importJob: { current: null }, finance: { lastActive: null },
    dbPath, restart: () => { state.restarts++; }, autoBackup: over.autoBackup, pickImage: async () => null, processImage: () => null, pickOpenFile: async () => null, saveFile: async () => null };
  const run = createDispatcher(d);
  const as = async (user: string) => { await run('auth.logout', {}); if (!((await run('auth.login', { username: user, password: PW })) as { ok: boolean }).ok) throw new Error('login'); };
  return { db, dir, dbPath, folder, run, as, state, d, rk, tenantId, men };
}
const ids = (a: Awaited<ReturnType<typeof app>>) => (a.db.prepare('SELECT id FROM branch ORDER BY position').all() as { id: string }[]).map((b) => b.id);

describe('settings through IPC', () => {
  let a: Awaited<ReturnType<typeof app>>; beforeEach(async () => { a = await app(); await a.as('user1'); });
  it('every settings and backup channel needs a signed-in user, and the backup/settings ones need the right to use them', async () => {
    await a.as('regm');
    for (const [c, p] of [['settings.get', {}], ['backup.list', {}], ['backup.setFolder', {}], ['backup.restore', { file: 'a.mshkbk', password: PW }]] as const) await expect(a.run(c, p), c).rejects.toMatchObject({ code: 'forbidden' });
    expect(await a.run('settings.addBranch', { name: 'x' })).toEqual({ ok: false, error: 'forbidden' }); // refused by the use case itself
    await a.run('auth.logout', {}); await expect(a.run('settings.get', {})).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('reads and updates the association, and detects a stale edit', async () => {
    const s = (await a.run('settings.get', {})) as { association: { name: string; version: number }; branches: { id: string; name: string; version: number }[]; username: string };
    expect(s.username).toBe('user1'); expect(s.association.name).toBe('جمعية');
    expect(await a.run('settings.updateAssociation', { expectedVersion: s.association.version, name: 'جمعية علماء المسلمين في سيدي عون', address: 'سيدي عون', contact: '' })).toEqual({ ok: true });
    expect(await a.run('settings.updateAssociation', { expectedVersion: s.association.version, name: 'x', address: '', contact: '' })).toEqual({ ok: false, error: 'conflict' });
    expect(((await a.run('session.current', {})) as { user: { associationName: string } }).user.associationName).toBe('جمعية علماء المسلمين في سيدي عون');
  });
  it('renames and adds branches', async () => {
    const s = (await a.run('settings.get', {})) as { branches: { id: string; version: number }[] };
    expect(await a.run('settings.renameBranch', { id: s.branches[0]!.id, expectedVersion: s.branches[0]!.version, name: 'فرع الذكور' })).toEqual({ ok: true });
    expect(await a.run('settings.addBranch', { name: 'فرع الذكور' })).toEqual({ ok: false, error: 'duplicate_name' }); expect(await a.run('settings.addBranch', { name: 'فرع ثالث' })).toMatchObject({ ok: true });
    expect(((await a.run('settings.get', {})) as { branches: unknown[] }).branches).toHaveLength(3);
  });
  it('changes the shared login password; the new one works after signing out', async () => {
    expect(await a.run('account.changePassword', { oldPassword: 'wrong-password-1', newPassword: 'كلمة جديدة طويلة 2027' })).toMatchObject({ ok: false, error: 'wrong' });
    expect(await a.run('account.changePassword', { oldPassword: PW, newPassword: 'short' })).toEqual({ ok: false, error: 'weak' });
    expect(await a.run('account.changePassword', { oldPassword: PW, newPassword: 'كلمة جديدة طويلة 2027' })).toEqual({ ok: true });
    await a.run('auth.logout', {}); expect(await a.run('auth.login', { username: 'user1', password: PW })).toEqual({ ok: false });
    expect(await a.run('auth.login', { username: 'user1', password: 'كلمة جديدة طويلة 2027' })).toMatchObject({ ok: true });
  });
  it('rejects malformed payloads', async () => {
    for (const [c, p] of [['settings.updateAssociation', { name: 'x' }], ['settings.renameBranch', { id: 'x', name: 'y' }], ['backup.restore', { file: 'a' }], ['account.changePassword', { oldPassword: 'x' }], ['settings.addBranch', { name: 'x', extra: 1 }]] as const)
      await expect(a.run(c, p), c).rejects.toMatchObject({ code: 'invalid_payload' });
  });
});

describe('backups through IPC', () => {
  it('lists the history and the files in the backup folder, newest first, and changes the folder', async () => {
    const a = await app(); await a.as('user1');
    expect(await a.run('backup.now', {})).toEqual({ ok: true }); a.state.clock += 5000; expect(await a.run('backup.now', {})).toEqual({ ok: true });
    const l = (await a.run('backup.list', {})) as { folder: string; history: { kind: string; file: string; verified: boolean }[]; files: { name: string; sizeBytes: number }[]; lastBackupAt: string };
    expect(l.folder).toBe(a.folder); expect(l.files).toHaveLength(2); expect(l.history).toHaveLength(2); expect(l.history[0]).toMatchObject({ kind: 'manual', verified: true }); expect(l.lastBackupAt).toMatch(/^2026-11-20T/);
    expect(await a.run('backup.setFolder', {})).toEqual({ ok: true, folder: a.state.picked }); a.state.picked = null; expect(await a.run('backup.setFolder', {})).toEqual({ ok: false, error: 'cancelled' });
  });
  it('when two installations share a backup folder, each lists only its own backups and counts the others', async () => {
    const a = await app(); await a.as('user1'); await a.run('backup.now', {});
    const other = await app(); other.state.saved = { backupFolder: a.folder }; other.state.clock += 1000; await other.as('user1'); await other.run('backup.now', {}); other.state.clock += 5000; await other.run('backup.now', {});
    writeFileSync(join(a.folder, 'broken.mshkbk'), 'garbage');
    const la = (await a.run('backup.list', {})) as { files: { name: string }[]; otherFiles: number };
    expect(la.files).toHaveLength(1); expect(la.otherFiles).toBe(3); // two from the other installation + one unreadable file
    const lo = (await other.run('backup.list', {})) as { files: { name: string }[]; otherFiles: number };
    expect(lo.files).toHaveLength(2); expect(lo.otherFiles).toBe(2);
    expect(la.files.map((f) => f.name).some((n) => lo.files.map((f) => f.name).includes(n))).toBe(false);
    expect(readdirSync(a.folder).filter((f) => f.endsWith('.mshkbk'))).toHaveLength(4); // nothing is deleted
  });
  it('takes a daily automatic backup when someone signs in and the last one is old, but not twice in a day', async () => {
    const a = await app({ autoBackup: true }); await a.as('user1');
    expect(readdirSync(a.folder).filter((f) => f.endsWith('.mshkbk'))).toHaveLength(1); expect(a.db.prepare("SELECT kind FROM backup_log").get()).toEqual({ kind: 'scheduled' });
    await a.as('user1'); expect(readdirSync(a.folder)).toHaveLength(1);
    a.state.clock += 21 * 3600 * 1000; await a.as('user1'); expect(readdirSync(a.folder).filter((f) => f.endsWith('.mshkbk'))).toHaveLength(2);
  });
  it('automatic backup is skipped (and never blocks signing in) when no folder or key is available', async () => {
    const a = await app({ autoBackup: true, storeKey: false }); a.state.saved = { backupFolder: null }; expect(await a.run('auth.login', { username: 'user1', password: PW })).toMatchObject({ ok: true });
    const b = await app({ autoBackup: true, storeKey: false }); expect(await b.run('auth.login', { username: 'user1', password: PW })).toMatchObject({ ok: true }); expect(existsSync(b.folder)).toBe(false);
  });
  it('restores a backup after re-authentication: data comes back, a safety copy is kept, the session ends and the app restarts', async () => {
    const a = await app(); await a.as('user1'); await a.run('backup.now', {});
    const file = (readdirSync(a.folder).find((f) => f.endsWith('.mshkbk')))!;
    a.db.prepare("UPDATE association SET name='تغيّر بعد النسخة', version=version+1").run();
    const r = await a.run('backup.restore', { file, password: PW }); expect(r).toEqual({ ok: true, restarting: true }); expect(a.state.restarts).toBe(1); expect(a.d.session.current).toBeNull();
    expect(readdirSync(join(a.folder, 'before-restore'))).toHaveLength(1);
    const again = openDb(a.dbPath); expect(again.prepare('SELECT name FROM association').get()).toEqual({ name: 'جمعية' }); expect(verifyAuditLog(again)).toEqual({ ok: true });
    expect(again.prepare("SELECT action FROM audit_log ORDER BY seq DESC LIMIT 1").get()).toEqual({ action: 'backup.restore' }); again.close();
  });
  it('refuses to restore with a wrong password, an unknown or unsafe file name, a wrong key, or no key at all', async () => {
    const a = await app(); await a.as('user1'); await a.run('backup.now', {}); const file = readdirSync(a.folder).find((f) => f.endsWith('.mshkbk'))!;
    expect(await a.run('backup.restore', { file, password: 'wrong-password-1' })).toMatchObject({ ok: false, error: 'wrong_password' });
    for (const bad of ['../../etc/passwd.mshkbk', 'nope.mshkbk', 'a.txt', 'C:\\x.mshkbk', '']) expect(await a.run('backup.restore', { file: bad, password: PW }), bad).toEqual({ ok: false, error: 'file_not_found' });
    expect(await a.run('backup.restore', { file, password: PW, recoveryKey: 'not a key' })).toEqual({ ok: false, error: 'bad_key' });
    expect(await a.run('backup.restore', { file, password: PW, recoveryKey: generateRecoveryKey().display })).toEqual({ ok: false, error: 'wrong_key_or_tampered' });
    expect(a.state.restarts).toBe(0); expect(a.d.session.current).not.toBeNull();
  });
  it('if the restore breaks midway the app restarts instead of staying half-restored', async () => {
    const a = await app(); await a.as('user1'); await a.run('backup.now', {}); const file = readdirSync(a.folder).find((f) => f.endsWith('.mshkbk'))!;
    a.d.migrationsDir = join(a.dir, 'no-such-folder'); // makes the post-swap migration step throw
    const r = await a.run('backup.restore', { file, password: PW }); expect(r).toEqual({ ok: false, error: 'restore_interrupted' });
    expect(a.state.restarts).toBe(1); expect(a.d.session.current).toBeNull();
  });
  it('restores correctly when the migrations folder is passed explicitly, as the bundled app does', async () => {
    const a = await app(); await a.as('user1'); await a.run('backup.now', {}); const file = readdirSync(a.folder).find((f) => f.endsWith('.mshkbk'))!;
    a.d.migrationsDir = join(__dirname, '../../../packages/db/migrations'); expect(await a.run('backup.restore', { file, password: PW })).toEqual({ ok: true, restarting: true });
  });
  it('asks for the recovery key when the stored one is not available on this PC', async () => {
    const a = await app(); await a.as('user1'); await a.run('backup.now', {}); const file = readdirSync(a.folder).find((f) => f.endsWith('.mshkbk'))!;
    (await import('node:fs')).rmSync(join(a.dir, 'recovery.key.bin'));
    expect(await a.run('backup.restore', { file, password: PW })).toEqual({ ok: false, error: 'key_needed' });
    expect(await a.run('backup.restore', { file, password: PW, recoveryKey: a.rk.display })).toEqual({ ok: true, restarting: true }); // typing the paper key works on any PC
  });
  it('a backup that is not from this association or is corrupted is refused and nothing changes', async () => {
    const a = await app(); await a.as('user1'); await a.run('backup.now', {}); const other = await app(); await other.as('user1'); await other.run('backup.now', {});
    const foreign = readdirSync(other.folder).find((f) => f.endsWith('.mshkbk'))!; writeFileSync(join(a.folder, 'foreign.mshkbk'), (await import('node:fs')).readFileSync(join(other.folder, foreign)));
    expect(await a.run('backup.restore', { file: 'foreign.mshkbk', password: PW })).toMatchObject({ ok: false, error: expect.stringMatching(/wrong_tenant|wrong_key_or_tampered/) });
    writeFileSync(join(a.folder, 'broken.mshkbk'), 'garbage'); expect(await a.run('backup.restore', { file: 'broken.mshkbk', password: PW })).toEqual({ ok: false, error: 'bad_format' });
    expect(a.state.restarts).toBe(0); void ids;
  });
});
