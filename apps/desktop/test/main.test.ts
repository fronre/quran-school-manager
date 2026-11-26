import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, migrate, newId, seedRoles, createUser, assignRole, verifyAuditLog, loadRecoveryKey, parseRecoveryKey, verifyBackup, type Db, type Protector } from '@mishkat/db';
import { readFileSync } from 'node:fs';
import { CSP, webPreferences, isAllowedNavigation, allowPermission } from '../src/main/security';
import { createDispatcher, IpcError, CHANNELS, visibleBranches, type Deps } from '../src/main/ipc';

describe('Electron hardening decisions (SEC-030..036)', () => {
  it('CSP forbids inline script, eval, remote origins and network connections', () => {
    expect(CSP).not.toMatch(/unsafe-inline|unsafe-eval|\*|https?:/);
    expect(CSP).toContain("default-src 'none'"); expect(CSP).toContain("connect-src 'none'");
    expect(CSP).toContain("script-src 'self'"); expect(CSP).toContain("object-src 'none'");
  });
  it('web preferences isolate the renderer', () => {
    const p = webPreferences({ preloadPath: 'x', packaged: true });
    expect(p).toMatchObject({ contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, nodeIntegrationInWorker: false });
    expect(p.devTools).toBe(false);
    expect(webPreferences({ preloadPath: 'x', packaged: false }).devTools).toBe(true);
  });
  it('navigation is allowed only to the bundled page', () => {
    const index = 'file:///C:/app/dist/renderer/index.html';
    expect(isAllowedNavigation(index, index)).toBe(true);
    expect(isAllowedNavigation(index + '#home', index)).toBe(true);
    for (const bad of ['https://evil.example/', 'file:///C:/Windows/system.ini', 'javascript:alert(1)', 'data:text/html,hi', '', 'not a url'])
      expect(isAllowedNavigation(bad, index), bad).toBe(false);
  });
  it('grants no browser permissions', () => {
    for (const p of ['media', 'geolocation', 'notifications', 'clipboard-read', 'openExternal']) expect(allowPermission(p)).toBe(false);
  });
});

const FAST = { memoryKiB: 8, passes: 1, parallelism: 1 };
const NOW = '2026-09-01T08:00:00.000Z';
const ACT = { id: 'sys', role: 'system' };

function world() {
  const db = openDb(':memory:'); migrate(db);
  const t = newId();
  db.prepare('INSERT INTO association(id,tenant_id,created_at,updated_at,created_by,updated_by,name) VALUES (?,?,?,?,?,?,?)').run(t, t, NOW, NOW, 's', 's', 'جمعية');
  const branch = (name: string, pos: number) => { const id = newId(); db.prepare('INSERT INTO branch(id,tenant_id,created_at,updated_at,created_by,updated_by,name,position) VALUES (?,?,?,?,?,?,?,?)').run(id, t, NOW, NOW, 's', 's', name, pos); return id; };
  const men = branch('فرع الرجال', 1), women = branch('فرع النساء', 2);
  seedRoles(db, t, 's', NOW);
  const user = (username: string, role: 'director' | 'registrar' | 'branch_supervisor', branchId: string | null) => {
    const p = newId(), s = newId();
    db.prepare('INSERT INTO person(id,tenant_id,created_at,updated_at,created_by,updated_by,given_name,family_name) VALUES (?,?,?,?,?,?,?,?)').run(p, t, NOW, NOW, 's', 's', username, 'اختبار');
    db.prepare("INSERT INTO staff_member(id,tenant_id,created_at,updated_at,created_by,updated_by,person_id,kind) VALUES (?,?,?,?,?,?,?,'employee')").run(s, t, NOW, NOW, 's', 's', p);
    const r = createUser(db, { tenantId: t, staffMemberId: s, username, password: 'a-long-test-password', actor: ACT }, { argon2: FAST });
    if (!r.ok) throw new Error('setup'); assignRole(db, { tenantId: t, userId: r.userId, role, branchId, actor: ACT }, NOW);
  };
  user('dir', 'director', null); user('reg', 'registrar', men);
  return { db, t, men, women };
}
const xor = (b: Buffer) => Buffer.from(b.map((x) => x ^ 0x5a));
export const fakeProtector = (ok = true): Protector => ({ available: () => ok, encrypt: xor, decrypt: xor });
const mk = (db: Db, t: string | null, over: Partial<Deps> = {}): { d: Deps; run: ReturnType<typeof createDispatcher> } => {
  let saved: { backupFolder: string | null } = { backupFolder: null };
  const dir = mkdtempSync(join(tmpdir(), 'mishkat-app-'));
  const d: Deps = {
    db, version: '1.2.3', session: { current: null }, tenantId: () => t, authOptions: { argon2: FAST },
    dataDir: dir, protector: fakeProtector(), settings: { get: () => saved, set: (v) => { saved = { ...saved, ...v } as typeof saved; } },
    pickFolder: async () => join(dir, 'picked'), defaultBackupFolder: join(dir, 'default'), wizard: { key: null, backupFolder: null }, pickOpenFile: async () => null, saveFile: async () => null, importJob: { current: null }, finance: { lastActive: null }, dbPath: '', restart: () => {}, pickImage: async () => null, processImage: () => null,
    ...over,
  };
  return { d, run: createDispatcher(d) };
};

describe('IPC dispatcher (SEC-023, SEC-033)', () => {
  let w: ReturnType<typeof world>; beforeEach(() => { w = world(); });

  it('only the allow-listed channels exist', () => {
    expect([...CHANNELS]).toEqual(['app.info', 'auth.login', 'auth.logout', 'auth.resetPassword', 'session.current', 'setup.begin', 'setup.checkPassword', 'setup.pickBackupFolder', 'setup.commit', 'setup.restorePick', 'setup.restoreCommit', 'home.summary', 'home.today', 'backup.now', 'import.pickFile', 'import.preview', 'import.commit', 'import.saveErrors', 'import.updatePreview', 'import.updateCommit', 'export.students', 'finance.status', 'finance.setPassword', 'finance.unlock', 'finance.lock', 'finance.changePassword', 'finance.resetPassword', 'finance.settings', 'finance.setRate', 'finance.setFreeMonth', 'finance.record', 'finance.cancel', 'finance.receipt', 'finance.payments', 'finance.statement', 'finance.arrears', 'finance.summary', 'finance.exportArrears', 'staff.list', 'staff.get', 'staff.form', 'staff.create', 'staff.update', 'staff.archive', 'staff.unarchive', 'photo.get', 'photo.pick', 'photo.remove', 'profile.activity', 'settings.get', 'settings.updateAssociation', 'settings.renameBranch', 'settings.addBranch', 'account.changePassword', 'backup.list', 'backup.setFolder', 'backup.restore', 'backup.useSuggestion', 'backup.setSecondFolder', 'backup.clearSecondFolder', 'groups.list', 'groups.get', 'groups.form', 'groups.create', 'groups.update', 'groups.setStatus', 'groups.assignTeacher', 'groups.removeTeacher', 'groups.assignable', 'groups.unassigned', 'groups.enroll', 'groups.leave', 'groups.ofStudent', 'groups.ofTeacher', 'attendance.sheet', 'attendance.save', 'attendance.cancel', 'attendance.correct', 'attendance.history', 'attendance.ofStudent', 'reports.enrollment', 'reports.attendance', 'reports.activity', 'reports.export', 'memo.access', 'memo.progress', 'memo.record', 'memo.void', 'memo.group', 'memo.suggest', 'guardians.list', 'guardians.add', 'guardians.update', 'guardians.remove', 'guardians.codeIssue', 'guardians.codeRevoke', 'guardians.whatsapp', 'guardians.pickFile', 'guardians.preview', 'guardians.commit', 'year.overview', 'year.start', 'year.plan', 'year.carryOver', 'memo.settingsGet', 'memo.settingsSet', 'settings.logoSet', 'accounts.list', 'accounts.create', 'accounts.setStatus', 'accounts.setRole', 'accounts.resetPassword', 'accounts.rename', 'account.setFirstPassword', 'audit.list', 'phone.status', 'phone.enable', 'phone.disable', 'phone.newCode', 'phone.revoke', 'students.list', 'students.get', 'students.form', 'students.create', 'students.update', 'students.archive', 'students.unarchive']);
  });
  it('rejects unknown channels, including Node-ish and prototype names', async () => {
    const { run } = mk(w.db, w.t);
    for (const c of ['fs.readFile', 'shell.openExternal', '__proto__', 'constructor', '', undefined, 42, {}, null])
      await expect(run(c, {}), String(c)).rejects.toMatchObject({ code: 'unknown_channel' });
  });
  it('rejects payloads that fail the schema, including extra keys and wrong types', async () => {
    const { run } = mk(w.db, w.t);
    for (const p of [{ username: 1, password: 'x' }, { username: 'a' }, { username: 'a', password: 'b', admin: true }, { username: '', password: 'b' }, { username: 'a'.repeat(101), password: 'b' }, 'str', []])
      await expect(run('auth.login', p), JSON.stringify(p)).rejects.toBeInstanceOf(IpcError);
    await expect(run('session.current', { userId: 'someone-else' })).rejects.toMatchObject({ code: 'invalid_payload' });
  });
  it('app.info reports version and whether setup is needed', async () => {
    expect(await mk(w.db, w.t).run('app.info', {})).toEqual({ version: '1.2.3', logo: null, setupNeeded: false, defaultAccountHint: false });
    const empty = openDb(':memory:'); migrate(empty);
    expect(await mk(empty, null).run('app.info', {})).toEqual({ version: '1.2.3', logo: null, setupNeeded: true, defaultAccountHint: false });
  });
  it('login success stores the session in main and returns a view without secrets or ids', async () => {
    const { run, d } = mk(w.db, w.t);
    const r = (await run('auth.login', { username: 'dir', password: 'a-long-test-password' })) as { ok: boolean; user: Record<string, unknown> };
    expect(r.ok).toBe(true); expect(d.session.current?.displayName).toBe('dir اختبار');
    expect(Object.keys(r.user).sort()).toEqual(['associationName', 'branches', 'displayName', 'logo', 'mustChange', 'permissions', 'roles', 'username', 'yearName']);
    expect(JSON.stringify(r)).not.toMatch(/password|hash|argon2/i);
    expect(await run('session.current', {})).toMatchObject({ user: { displayName: 'dir اختبار' } });
  });
  it('failed logins give one identical answer and leave no session', async () => {
    const { run, d } = mk(w.db, w.t);
    const a = await run('auth.login', { username: 'dir', password: 'wrong-password-1' });
    const b = await run('auth.login', { username: 'nobody', password: 'wrong-password-1' });
    expect(a).toEqual({ ok: false }); expect(b).toEqual(a); expect(d.session.current).toBeNull();
    expect(await mk(w.db, null).run('auth.login', { username: 'dir', password: 'a-long-test-password' })).toEqual({ ok: false });
  });
  it('logout clears the session', async () => {
    const { run, d } = mk(w.db, w.t);
    await run('auth.login', { username: 'dir', password: 'a-long-test-password' });
    expect(await run('auth.logout', {})).toEqual({ ok: true });
    expect(d.session.current).toBeNull(); expect(await run('session.current', {})).toEqual({ user: null });
  });
  it('branch visibility follows the domain rules: director sees both, registrar only own branch', async () => {
    const { run } = mk(w.db, w.t);
    const dir = (await run('auth.login', { username: 'dir', password: 'a-long-test-password' })) as { user: { branches: { name: string }[] } };
    expect(dir.user.branches.map((b) => b.name)).toEqual(['فرع الرجال', 'فرع النساء']);
    await run('auth.logout', {});
    const reg = (await run('auth.login', { username: 'reg', password: 'a-long-test-password' })) as { user: { branches: { name: string }[]; roles: string[] } };
    expect(reg.user.branches.map((b) => b.name)).toEqual(['فرع الرجال']);
    expect(reg.user.roles).toEqual(['registrar']);
  });
  it('visibleBranches: no assignments -> no branches; inactive branches hidden', () => {
    expect(visibleBranches(w.db, [])).toEqual([]);
    w.db.prepare('UPDATE branch SET active=0, version=version+1 WHERE id=?').run(w.women);
    expect(visibleBranches(w.db, [{ role: 'director', branchId: null }]).map((b) => b.name)).toEqual(['فرع الرجال']);
  });
});
