import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, migrate, loadRecoveryKey, parseRecoveryKey, verifyBackup, verifyAuditLog, type Protector } from '@mishkat/db';
import { createDispatcher, type Deps } from '../src/main/ipc';

const FAST = { memoryKiB: 8, passes: 1, parallelism: 1 };
const xor = (b: Buffer) => Buffer.from(b.map((x) => x ^ 0x5a));
const prot = (ok = true): Protector => ({ available: () => ok, encrypt: xor, decrypt: xor });

function app(over: Partial<Deps> = {}) {
  const db = openDb(':memory:'); migrate(db);
  const dir = mkdtempSync(join(tmpdir(), 'mishkat-wiz-')); let saved: { backupFolder: string | null } = { backupFolder: null };
  const d: Deps = {
    db, version: '0.0.1', session: { current: null }, authOptions: { argon2: FAST }, dataDir: dir, protector: prot(),
    settings: { get: () => saved, set: (v) => { saved = { ...saved, ...v } as typeof saved; } }, pickFolder: async () => join(dir, 'picked'), defaultBackupFolder: join(dir, 'default'),
    wizard: { key: null, backupFolder: null }, pickOpenFile: async () => null, saveFile: async () => null, importJob: { current: null }, finance: { lastActive: null }, dbPath: '', restart: () => {}, pickImage: async () => null, processImage: () => null, tenantId: () => (db.prepare('SELECT id FROM association LIMIT 1').get() as { id: string } | undefined)?.id ?? null, ...over,
  };
  return { d, db, dir, run: createDispatcher(d) };
}
const payload = (keyDisplay: string, over: Record<string, unknown> = {}) => {
  const g = keyDisplay.split('-');
  return {
    admin: { givenName: 'علي', familyName: 'الجزائري', username: 'ali.director', password: 'عبارة سر طويلة 2026' },
    association: { name: 'جمعية النور', address: 'الجزائر', contact: '' },
    branches: [{ name: 'فرع الرجال' }, { name: 'فرع النساء' }],
    year: { name: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30' },
    keyConfirm: { first: g[0], last: g[g.length - 1] }, ...over,
  };
};

describe('setup wizard channels (WF-01)', () => {
  it('begin returns the same key for the whole wizard run and never exposes raw bytes', async () => {
    const a = app();
    const r1 = (await a.run('setup.begin', {})) as { keyDisplay: string }; const r2 = (await a.run('setup.begin', {})) as { keyDisplay: string };
    expect(r1.keyDisplay).toBe(r2.keyDisplay); expect(r1.keyDisplay).toMatch(/^([0-9A-Z]{4}-){13}[0-9A-Z]{4}$/);
    expect(parseRecoveryKey(r1.keyDisplay).ok).toBe(true);
  });
  it('checkPassword gives live feedback without storing anything', async () => {
    const a = app();
    expect(await a.run('setup.checkPassword', { username: 'ali', password: 'short' })).toEqual({ problems: ['too_short'] });
    expect(await a.run('setup.checkPassword', { username: 'ali', password: 'a-long-enough-pass' })).toEqual({ problems: [] });
    expect(a.db.prepare('SELECT count(*) c FROM user_account').get()).toEqual({ c: 0 });
  });
  it('pickBackupFolder remembers the choice inside main', async () => {
    const a = app(); const r = (await a.run('setup.pickBackupFolder', {})) as { folder: string };
    expect(r.folder).toBe(join(a.dir, 'picked')); expect(a.d.wizard.backupFolder).toBe(r.folder);
    expect(await app({ pickFolder: async () => null }).run('setup.pickBackupFolder', {})).toEqual({ folder: null });
  });

  it('commit with a correct key confirmation sets everything up, signs the director in, stores the key and makes a verified first backup', async () => {
    const a = app(); const { keyDisplay } = (await a.run('setup.begin', {})) as { keyDisplay: string };
    await a.run('setup.pickBackupFolder', {});
    const r = (await a.run('setup.commit', payload(keyDisplay))) as { ok: boolean; user: { roles: string[]; branches: unknown[] }; backup: { ok: boolean } };
    expect(r.ok).toBe(true); expect(r.backup).toEqual({ ok: true });
    expect(r.user.roles).toEqual(['director']); expect(r.user.branches).toHaveLength(2);
    expect(a.d.session.current?.displayName).toBe('علي الجزائري');
    expect(a.d.wizard.key).toBeNull();
    // key stored protected, and it is the same key the user was shown
    const stored = loadRecoveryKey(a.dir, prot())!; const shown = parseRecoveryKey(keyDisplay);
    expect(shown.ok && shown.key.equals(stored)).toBe(true);
    // first backup exists, belongs to this association, opens with that key
    const folder = join(a.dir, 'picked'); const files = readdirSync(folder).filter((f) => f.endsWith('.mshkbk'));
    expect(files).toHaveLength(1);
    const tenant = (a.db.prepare('SELECT id FROM association').get() as { id: string }).id;
    expect(verifyBackup(readFileSync(join(folder, files[0]!)), { kind: 'recovery', key: stored }, tenant).ok).toBe(true);
    expect(a.d.settings.get().backupFolder).toBe(folder);
    expect(verifyAuditLog(a.db)).toEqual({ ok: true });
    expect(await a.run('app.info', {})).toMatchObject({ setupNeeded: false });
  });
  it('uses the default backup folder when none was picked', async () => {
    const a = app(); const { keyDisplay } = (await a.run('setup.begin', {})) as { keyDisplay: string };
    await a.run('setup.commit', payload(keyDisplay));
    expect(existsSync(join(a.dir, 'default'))).toBe(true);
  });
  it('accepts a key confirmation typed in lower case with dashes or O/0 slips', async () => {
    const a = app(); const { keyDisplay } = (await a.run('setup.begin', {})) as { keyDisplay: string };
    const g = keyDisplay.split('-');
    const r = (await a.run('setup.commit', payload(keyDisplay, { keyConfirm: { first: g[0]!.toLowerCase(), last: ` ${g[13]!.toLowerCase()} ` } }))) as { ok: boolean };
    expect(r.ok).toBe(true);
  });
  it('rejects a wrong key confirmation and writes nothing', async () => {
    const a = app(); const { keyDisplay } = (await a.run('setup.begin', {})) as { keyDisplay: string };
    const bad = (await a.run('setup.commit', payload(keyDisplay, { keyConfirm: { first: 'ZZZZ', last: 'ZZZZ' } }))) as { ok: boolean; error: string };
    expect(bad).toEqual({ ok: false, error: 'key_mismatch' });
    expect(a.db.prepare('SELECT count(*) c FROM association').get()).toEqual({ c: 0 });
    expect(readdirSync(a.dir).includes('recovery.key.bin')).toBe(false);
  });
  it('refuses commit without a begun key', async () => {
    expect(await app().run('setup.commit', payload('AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH-JJJJ-KKKK-MMMM-NNNN-PPPP-QQQQ'))).toEqual({ ok: false, error: 'no_key' });
  });
  it('returns validation issues for bad input and keeps the key for another try', async () => {
    const a = app(); const { keyDisplay } = (await a.run('setup.begin', {})) as { keyDisplay: string };
    const r = (await a.run('setup.commit', payload(keyDisplay, { year: { name: '2026', startDate: '2027-01-01', endDate: '2026-01-01' } }))) as { ok: boolean; error: string; issues: { field: string }[] };
    expect(r.ok).toBe(false); expect(r.error).toBe('invalid'); expect(r.issues.map((i) => i.field)).toContain('year.endDate');
    expect(a.d.wizard.key?.display).toBe(keyDisplay);
    expect(a.db.prepare('SELECT count(*) c FROM association').get()).toEqual({ c: 0 });
  });
  it('blocks setup when OS key protection is unavailable (nothing committed)', async () => {
    const a = app({ protector: prot(false) }); const { keyDisplay } = (await a.run('setup.begin', {})) as { keyDisplay: string };
    expect(await a.run('setup.commit', payload(keyDisplay))).toEqual({ ok: false, error: 'os_protection_unavailable' });
    expect(a.db.prepare('SELECT count(*) c FROM association').get()).toEqual({ c: 0 });
  });
  it('still completes setup when the first backup cannot be written, and reports it', async () => {
    const a = app(); const { keyDisplay } = (await a.run('setup.begin', {})) as { keyDisplay: string };
    a.d.wizard.backupFolder = join(a.dir, 'blocker', 'x'); // a path under a regular file
    (await import('node:fs')).writeFileSync(join(a.dir, 'blocker'), 'x');
    const r = (await a.run('setup.commit', payload(keyDisplay))) as { ok: boolean; backup: { ok: boolean } };
    expect(r.ok).toBe(true); expect(r.backup).toEqual({ ok: false });
  });
  it('setup channels are closed once the association is set up', async () => {
    const a = app(); const { keyDisplay } = (await a.run('setup.begin', {})) as { keyDisplay: string };
    await a.run('setup.commit', payload(keyDisplay));
    for (const [c, p] of [['setup.begin', {}], ['setup.pickBackupFolder', {}], ['setup.checkPassword', { username: 'a', password: 'b' }], ['setup.commit', payload(keyDisplay)]] as const)
      await expect(a.run(c, p), c).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('rejects malformed commit payloads at the schema', async () => {
    const a = app(); const { keyDisplay } = (await a.run('setup.begin', {})) as { keyDisplay: string };
    for (const bad of [{ ...payload(keyDisplay), extra: 1 }, { ...payload(keyDisplay), branches: 'x' }, { ...payload(keyDisplay), admin: { givenName: 1 } }])
      await expect(a.run('setup.commit', bad)).rejects.toMatchObject({ code: 'invalid_payload' });
  });
});

describe('home.summary and backup.now', () => {
  async function ready() {
    const a = app(); const { keyDisplay } = (await a.run('setup.begin', {})) as { keyDisplay: string };
    await a.run('setup.pickBackupFolder', {}); await a.run('setup.commit', payload(keyDisplay)); return a;
  }
  it('require a signed-in user', async () => {
    const a = await ready(); await a.run('auth.logout', {});
    await expect(a.run('home.summary', {})).rejects.toMatchObject({ code: 'forbidden' });
    await expect(a.run('backup.now', {})).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('home.summary reports the last verified backup time', async () => {
    const a = await ready(); const r = (await a.run('home.summary', {})) as { lastBackupAt: string | null };
    expect(r.lastBackupAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
  it('backup.now creates another verified backup for the director', async () => {
    const a = await ready(); const before = readdirSync(join(a.dir, 'picked')).length;
    await new Promise((r) => setTimeout(r, 5)); // distinct millisecond in the file name
    expect(await a.run('backup.now', {})).toEqual({ ok: true });
    expect(readdirSync(join(a.dir, 'picked')).length).toBe(before + 1);
  });
  it('backup.now is forbidden for a role without backup.manage', async () => {
    const a = await ready();
    a.d.session.current = { userId: 'x', displayName: 'x', assignments: [{ role: 'registrar', branchId: 'b1' }] };
    await expect(a.run('backup.now', {})).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('backup.now reports not_configured when the key or folder is missing', async () => {
    const a = await ready(); a.d.settings.set({ backupFolder: '' });
    expect(await a.run('backup.now', {})).toEqual({ ok: false, error: 'not_configured' });
  });
});
