import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, migrate, runSetup, generateRecoveryKey, saveRecoveryKey, verifyAuditLog, type Protector } from '@mishkat/db';
import { createDispatcher, type Deps } from '../src/main/ipc';

const FAST = { memoryKiB: 8, passes: 1, parallelism: 1 };
const xor = (b: Buffer) => Buffer.from(b.map((x) => x ^ 0x5a));
const prot: Protector = { available: () => true, encrypt: xor, decrypt: xor };
const PW = 'a-long-test-password';

async function app() {
  const dir = mkdtempSync(join(tmpdir(), 'mishkat-as-')); const dbPath = join(dir, 'mishkat.db'); const db = openDb(dbPath); migrate(db);
  const rk = generateRecoveryKey();
  const { tenantId } = runSetup(db, { admin: { givenName: 'مستخدم', familyName: 'البرنامج', username: 'user1', password: PW }, association: { name: 'جمعية' }, branches: [{ name: 'فرع الرجال' }, { name: 'فرع النساء' }], year: { name: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30' } }, rk.key, { argon2: FAST });
  saveRecoveryKey(dir, prot, rk.key);
  const folder = join(dir, 'primary'); const second = join(dir, 'second');
  const state = { saved: { backupFolder: folder as string | null, secondFolder: null as string | null }, picked: second as string | null, clock: Date.now() + 3_600_000 };
  const sugg = [{ id: 'desktop', label: 'سطح المكتب', path: join(dir, 'Desktop', 'Mishkat-Backups'), kind: 'desktop' as const }, { id: 'drive:G', label: 'Google Drive', path: join(dir, 'G', 'My Drive', 'Mishkat-Backups'), kind: 'drive' as const }];
  const d: Deps = { db, version: '0', session: { current: null }, authOptions: { argon2: FAST }, dataDir: dir, protector: prot, settings: { get: () => state.saved, set: (v) => { state.saved = { ...state.saved, ...v } as typeof state.saved; } },
    pickFolder: async () => state.picked, defaultBackupFolder: folder, wizard: { key: null, backupFolder: null }, tenantId: () => tenantId, now: () => new Date(state.clock).toISOString(), importJob: { current: null }, finance: { lastActive: null },
    dbPath, restart: () => undefined, autoBackup: true, suggestions: () => sugg, pickImage: async () => null, processImage: () => null, pickOpenFile: async () => null, saveFile: async () => null };
  const run = createDispatcher(d);
  await run('auth.login', { username: 'user1', password: PW });
  const files = (p: string) => (existsSync(p) ? readdirSync(p).filter((f) => f.endsWith('.mshkbk')) : []);
  return { db, dir, folder, second, run, d, state, files, sugg, tick: (ms: number) => { state.clock += ms; } };
}
const change = async (a: Awaited<ReturnType<typeof app>>, n = 1) => { const f = (await a.run('students.form', {})) as { branches: { id: string }[] }; const r = await a.run('students.create', { input: { givenName: 'طالب' + n, familyName: 'ا', birthDate: null, phone: null, branchId: f.branches[0]!.id, status: 'active', joinedOn: null, studentNo: 'N' + n } }); if (!(r as { ok: boolean }).ok) throw new Error('change failed ' + JSON.stringify(r)); };

describe('automatic saving', () => {
  let a: Awaited<ReturnType<typeof app>>; beforeEach(async () => { a = await app(); });
  it('the database commits with synchronous=FULL so a power cut cannot lose a saved change', () => {
    const file = openDb(join(a.dir, 'probe.db')); expect(file.pragma('synchronous', { simple: true })).toBe(2); file.close();
  });
  it('makes a verified backup at sign-out when something changed, and none when nothing did', async () => {
    await a.run('auth.logout', {}); const first = a.files(a.folder).length; // the setup itself changed data: one backup
    await a.run('auth.login', { username: 'user1', password: PW }); a.tick(60_000); await a.run('auth.logout', {}); expect(a.files(a.folder).length).toBe(first); // nothing changed: no new file
    await a.run('auth.login', { username: 'user1', password: PW }); a.tick(60_000); await change(a); a.tick(60_000); await a.run('auth.logout', {}); expect(a.files(a.folder).length).toBe(first + 1);
    expect(a.db.prepare("SELECT count(*) c FROM backup_log WHERE kind = 'scheduled' AND verified = 1").get()).toEqual({ c: first + 1 }); expect(verifyAuditLog(a.db)).toEqual({ ok: true });
  });
  it('the timer entry point saves only when there is something new, and never runs two at once', async () => {
    const run = a.run as unknown as { autoSave: () => Promise<{ ran: boolean }> };
    a.tick(60_000); await change(a, 2); const [x, y] = await Promise.all([run.autoSave(), run.autoSave()]); expect(x).toEqual(y); expect(x.ran).toBe(true);
    a.tick(60_000); expect((await run.autoSave()).ran).toBe(false); // nothing changed since
    expect(a.files(a.folder).length).toBeGreaterThanOrEqual(1);
  });
  it('copies each automatic backup to the second folder when one is chosen', async () => {
    expect(await a.run('backup.setSecondFolder', {})).toEqual({ ok: true, folder: a.second }); const run = a.run as unknown as { autoSave: () => Promise<{ ran: boolean }> };
    a.tick(60_000); await change(a, 3); await run.autoSave(); expect(a.files(a.second)).toEqual(a.files(a.folder).slice(-1).length ? expect.arrayContaining([a.files(a.folder).sort().at(-1)!]) : []);
    const l = (await a.run('backup.list', {})) as { secondFolder: string | null; auto: { ok: boolean | null; secondOk: boolean | null } }; expect(l.secondFolder).toBe(a.second); expect(l.auto).toMatchObject({ ok: true, secondOk: true });
    expect(await a.run('backup.clearSecondFolder', {})).toEqual({ ok: true }); expect(((await a.run('backup.list', {})) as { secondFolder: string | null }).secondFolder).toBeNull();
  });
  it('refuses a second folder equal to the main one', async () => { a.state.picked = a.folder; expect(await a.run('backup.setSecondFolder', {})).toEqual({ ok: false, error: 'same_folder' }); });
  it('offers suggested folders (desktop, Google Drive) and selects one by id only', async () => {
    const l = (await a.run('backup.list', {})) as { suggestions: { id: string; path: string }[] }; expect(l.suggestions.map((s) => s.id)).toEqual(['desktop', 'drive:G']);
    expect(await a.run('backup.useSuggestion', { id: 'drive:G' })).toMatchObject({ ok: true, folder: a.sugg[1]!.path }); expect(a.state.saved.backupFolder).toBe(a.sugg[1]!.path); expect(existsSync(a.sugg[1]!.path)).toBe(true);
    expect(await a.run('backup.useSuggestion', { id: 'C:\\Windows' })).toEqual({ ok: false, error: 'not_found' }); // an arbitrary path is never accepted
    expect(a.state.saved.backupFolder).toBe(a.sugg[1]!.path);
  });
  it('a failing folder never breaks signing out', async () => {
    a.state.saved.backupFolder = join(a.dir, 'bad\0name'); a.tick(60_000); await change(a, 4); await expect(a.run('auth.logout', {})).resolves.toEqual({ ok: true });
  });
  it('the new channels need a signed-in user', async () => {
    await a.run('auth.logout', {}); for (const c of ['backup.useSuggestion', 'backup.setSecondFolder', 'backup.clearSecondFolder'] as const) await expect(a.run(c, c === 'backup.useSuggestion' ? { id: 'desktop' } : {}), c).rejects.toMatchObject({ code: 'forbidden' });
  });
});
