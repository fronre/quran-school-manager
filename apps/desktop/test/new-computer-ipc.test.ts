import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, migrate, runSetup, generateRecoveryKey, saveRecoveryKey, loadRecoveryKey, verifyAuditLog, restoreOnNewComputer, type Protector } from '@mishkat/db';
import { createDispatcher, type Deps } from '../src/main/ipc';

const FAST = { memoryKiB: 8, passes: 1, parallelism: 1 };
const PW = 'a-long-test-password';
// Each "computer" has its own Windows protection: what one protects, the other cannot open (like DPAPI).
const machine = (n: number): Protector => ({ available: () => true, encrypt: (b) => Buffer.concat([Buffer.from([n]), b.map((x) => x ^ n)]), decrypt: (b) => { if (b[0] !== n) throw new Error('other machine'); return Buffer.from(b.subarray(1).map((x) => x ^ n)); } });

function deps(dir: string, db: ReturnType<typeof openDb>, prot: Protector, over: Partial<Deps> = {}) {
  const state = { saved: { backupFolder: null as string | null }, restarts: 0, clock: Date.parse('2026-11-22T09:00:00.000Z'), file: null as string | null };
  const d: Deps = { db, version: '0', session: { current: null }, authOptions: { argon2: FAST }, dataDir: dir, protector: prot,
    settings: { get: () => state.saved, set: (v) => { state.saved = { ...state.saved, ...v } as typeof state.saved; } },
    pickFolder: async () => null, defaultBackupFolder: join(dir, 'Mishkat-Backups'), wizard: { key: null, backupFolder: null },
    tenantId: () => (db.prepare('SELECT id FROM association LIMIT 1').get() as { id: string } | undefined)?.id ?? null,
    now: () => new Date(state.clock).toISOString(), importJob: { current: null }, finance: { lastActive: null },
    dbPath: join(dir, 'mishkat.db'), restart: () => { state.restarts++; }, pickImage: async () => null, processImage: () => null, pickOpenFile: async () => null, saveFile: async () => null,
    pickBackupFile: async () => state.file, ...over };
  return { d, state, run: createDispatcher(d) };
}

/** The old computer: a set-up association with some data and a fresh backup copied to a "USB stick". */
async function oldComputer() {
  const dir = mkdtempSync(join(tmpdir(), 'mishkat-old-')); const db = openDb(join(dir, 'mishkat.db')); migrate(db);
  const rk = generateRecoveryKey();
  runSetup(db, { admin: { givenName: 'مستخدم', familyName: 'البرنامج', username: 'user1', password: PW }, association: { name: 'جمعية سيدي عون' },
    branches: [{ name: 'فرع الرجال' }, { name: 'فرع النساء' }], year: { name: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30' } }, rk.key, { argon2: FAST });
  saveRecoveryKey(dir, machine(1), rk.key);
  const o = deps(dir, db, machine(1)); o.state.saved.backupFolder = join(dir, 'backups');
  expect(await o.run('auth.login', { username: 'user1', password: PW })).toMatchObject({ ok: true });
  db.prepare("UPDATE association SET address='حي النور', version=version+1").run();
  expect(await o.run('backup.now', {})).toEqual({ ok: true });
  const usb = mkdtempSync(join(tmpdir(), 'mishkat-usb-')); const name = readdirSync(join(dir, 'backups')).find((f) => f.endsWith('.mshkbk'))!;
  copyFileSync(join(dir, 'backups', name), join(usb, name));
  return { rk, file: join(usb, name), db };
}
function newComputer() {
  const dir = mkdtempSync(join(tmpdir(), 'mishkat-new-')); mkdirSync(dir, { recursive: true }); const db = openDb(join(dir, 'mishkat.db')); migrate(db);
  return { dir, db, ...deps(dir, db, machine(2), { autoBackup: true }) };
}

describe('moving the association to a new computer (first run)', () => {
  it('backup file + paper key bring back the same association, the same login, and a key protected by THIS computer', async () => {
    const old = await oldComputer(); const n = newComputer(); n.state.file = old.file;
    const pick = (await n.run('setup.restorePick', {})) as { ok: boolean; name: string; createdAt: string; sizeBytes: number };
    expect(pick).toMatchObject({ ok: true, name: expect.stringMatching(/\.mshkbk$/), createdAt: expect.stringMatching(/^2026-11-22T/) }); expect(pick.sizeBytes).toBeGreaterThan(0);
    const r = await n.run('setup.restoreCommit', { recoveryKey: old.rk.display.toLowerCase().replace(/-/g, ' ') }); // typed loosely, as people do
    expect(r).toMatchObject({ ok: true, restarting: true, firstBackup: true }); expect(n.state.restarts).toBe(1);
    expect(n.state.saved.backupFolder).toBe(join(n.dir, 'Mishkat-Backups'));
    expect(readdirSync(join(n.dir, 'Mishkat-Backups')).filter((f) => f.endsWith('.mshkbk'))).toHaveLength(1); // a backup on THIS computer straight away
    expect(loadRecoveryKey(n.dir, machine(2))?.equals(old.rk.key)).toBe(true); // unattended backups will work here
    expect(loadRecoveryKey(n.dir, machine(1))).toBeNull();

    // after the restart
    const db2 = openDb(join(n.dir, 'mishkat.db')); expect(db2.prepare('SELECT name, address FROM association').get()).toEqual({ name: 'جمعية سيدي عون', address: 'حي النور' });
    expect(verifyAuditLog(db2)).toEqual({ ok: true }); expect(db2.prepare('SELECT action FROM audit_log ORDER BY seq DESC LIMIT 1').get()).toEqual({ action: 'backup.restore_new_computer' });
    const again = deps(n.dir, db2, machine(2), { autoBackup: true }); again.state.saved = n.state.saved; again.state.clock = n.state.clock;
    expect(((await again.run('app.info', {})) as { setupNeeded: boolean }).setupNeeded).toBe(false);
    expect(await again.run('auth.login', { username: 'user1', password: PW })).toMatchObject({ ok: true }); // the old password works
    const kinds = (db2.prepare('SELECT kind FROM backup_log ORDER BY finished_at').all() as { kind: string }[]).map((x) => x.kind);
    expect(kinds.slice(-2)).toEqual(['restore', 'manual']); // the move, then the first backup on this computer
    await expect(again.run('setup.restorePick', {})).rejects.toMatchObject({ code: 'forbidden' }); // once set up, this door is closed
    db2.close();
  });

  it('a wrong or mistyped key changes nothing; five wrong keys lock the attempt for 15 minutes', async () => {
    const old = await oldComputer(); const n = newComputer(); n.state.file = old.file; await n.run('setup.restorePick', {});
    expect(await n.run('setup.restoreCommit', { recoveryKey: 'not a key' })).toEqual({ ok: false, error: 'bad_key' });
    expect(await n.run('setup.restoreCommit', { recoveryKey: old.rk.display.slice(0, -1) + (old.rk.display.endsWith('A') ? 'B' : 'A') })).toEqual({ ok: false, error: 'bad_key' }); // checksum catches a typo
    for (let i = 0; i < 2; i++) expect(await n.run('setup.restoreCommit', { recoveryKey: generateRecoveryKey().display })).toEqual({ ok: false, error: 'wrong_key_or_tampered' });
    expect(await n.run('setup.restoreCommit', { recoveryKey: generateRecoveryKey().display })).toEqual({ ok: false, error: 'wrong_key_or_tampered' }); // fifth wrong attempt
    expect(await n.run('setup.restoreCommit', { recoveryKey: old.rk.display })).toMatchObject({ ok: false, error: 'locked' });
    n.state.clock += 0; expect(n.state.restarts).toBe(0); expect(existsSync(join(n.dir, 'recovery.key.bin'))).toBe(false);
    expect(((await n.run('app.info', {})) as { setupNeeded: boolean }).setupNeeded).toBe(true);
  });

  it('refuses files that are not backups, and commit without a chosen file', async () => {
    const n = newComputer();
    expect(await n.run('setup.restoreCommit', { recoveryKey: generateRecoveryKey().display })).toEqual({ ok: false, error: 'no_file' });
    expect(await n.run('setup.restorePick', {})).toEqual({ ok: false, error: 'cancelled' });
    const junk = join(n.dir, 'junk.mshkbk'); writeFileSync(junk, 'garbage'); n.state.file = junk;
    expect(await n.run('setup.restorePick', {})).toEqual({ ok: false, error: 'bad_format' });
    await expect(n.run('setup.restoreCommit', {})).rejects.toMatchObject({ code: 'invalid_payload' });
  });

  it('a corrupted backup is refused after the key is accepted, and the empty installation stays usable', async () => {
    const old = await oldComputer(); const n = newComputer();
    const bad = Buffer.from(readFileSync(old.file)); bad[bad.length - 40]! ^= 0xff; const f = join(n.dir, 'bad.mshkbk'); writeFileSync(f, bad); n.state.file = f;
    expect(await n.run('setup.restorePick', {})).toMatchObject({ ok: true }); // the header still looks fine
    expect(await n.run('setup.restoreCommit', { recoveryKey: old.rk.display })).toEqual({ ok: false, error: 'wrong_key_or_tampered' });
    expect(n.state.restarts).toBe(0); expect(n.db.open).toBe(true); expect(n.db.prepare('SELECT count(*) c FROM association').get()).toEqual({ c: 0 });
  });

  it('can never overwrite an association that already exists (database level)', async () => {
    const old = await oldComputer();
    expect(restoreOnNewComputer({ db: old.db, dbPath: 'unused', backupFile: old.file, key: old.rk.key })).toEqual({ ok: false, error: 'already_set_up' });
  });
});
