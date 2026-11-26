import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, migrate, pendingMigrations, generateRecoveryKey, storeRecoveryVerifier, saveRecoveryKey, verifyBackup, type Protector } from '@mishkat/db';
import { readFileSync } from 'node:fs';
import { safeMigrate } from '../src/main/startup';

const xor = (b: Buffer) => Buffer.from(b.map((x) => x ^ 0x5a));
const prot: Protector = { available: () => true, encrypt: xor, decrypt: xor };
const MIG = join(__dirname, '../../../packages/db/migrations');
const FAST = { memoryKiB: 8, passes: 1, parallelism: 1 };

/** An "old installation": only migrations 001-003 applied, with real data and the recovery key stored. */
function oldInstall() {
  const dir = mkdtempSync(join(tmpdir(), 'mishkat-up-')); const partial = join(dir, 'mig3'); mkdirSync(partial);
  for (const f of readdirSync(MIG).filter((x) => /^00[123]_/.test(x))) copyFileSync(join(MIG, f), join(partial, f));
  const db = openDb(join(dir, 'mishkat.db')); migrate(db, partial);
  const rk = generateRecoveryKey();
  // data as the PREVIOUS app version would have written it (schema 3: staff_member has no branch/position columns yet)
  const tenantId = crypto.randomUUID(); const t = '2026-09-01T08:00:00.000Z'; const person = crypto.randomUUID(), staff = crypto.randomUUID(), user = crypto.randomUUID();
  db.prepare('INSERT INTO association(id,tenant_id,created_at,updated_at,created_by,updated_by,name) VALUES (?,?,?,?,?,?,?)').run(tenantId, tenantId, t, t, 's', 's', 'جمعية');
  db.prepare('INSERT INTO person(id,tenant_id,created_at,updated_at,created_by,updated_by,given_name,family_name) VALUES (?,?,?,?,?,?,?,?)').run(person, tenantId, t, t, 's', 's', 'مستخدم', 'البرنامج');
  db.prepare("INSERT INTO staff_member(id,tenant_id,created_at,updated_at,created_by,updated_by,person_id,kind) VALUES (?,?,?,?,?,?,?,'employee')").run(staff, tenantId, t, t, 's', 's', person);
  db.prepare('INSERT INTO user_account(id,tenant_id,created_at,updated_at,created_by,updated_by,staff_member_id,username,password_hash) VALUES (?,?,?,?,?,?,?,?,?)').run(user, tenantId, t, t, 's', 's', staff, 'user1', 'x');
  storeRecoveryVerifier(db, tenantId, rk.key, t);
  saveRecoveryKey(dir, prot, rk.key);
  return { db, dir, tenantId, rk, backups: join(dir, 'backups') };
}

describe('pendingMigrations', () => {
  it('lists unapplied versions, and everything for an empty database', () => {
    const o = oldInstall(); expect(pendingMigrations(o.db, MIG)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const fresh = openDb(':memory:'); expect(pendingMigrations(fresh, MIG)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]); migrate(fresh, MIG); expect(pendingMigrations(fresh, MIG)).toEqual([]);
  });
});

describe('safeMigrate (BR-043)', () => {
  it('backs up an existing installation with a verified, openable backup, then upgrades it keeping all data', async () => {
    const o = oldInstall();
    const r = await safeMigrate({ db: o.db, migrationsDir: MIG, dataDir: o.dir, protector: prot, backupFolder: o.backups });
    expect(r).toEqual({ ok: true, ran: [4, 5, 6, 7, 8, 9, 10, 11, 12], backedUp: true });
    const files = readdirSync(o.backups); expect(files).toHaveLength(1); expect(files[0]).toMatch(/^mishkat-before-update-.*\.mshkbk$/);
    expect(verifyBackup(readFileSync(join(o.backups, files[0]!)), { kind: 'recovery', key: o.rk.key }, o.tenantId).ok).toBe(true);
    expect(o.db.prepare('SELECT count(*) c FROM payment').get()).toEqual({ c: 0 }); // new tables exist
    expect(o.db.prepare('SELECT name FROM association').get()).toEqual({ name: 'جمعية' }); // old data intact
    expect(o.db.prepare('SELECT position, version FROM staff_member').get()).toEqual({ position: 'administrator', version: 2 }); // migration 005 keeps the sign-in account out of the teachers list
    expect(o.db.prepare("SELECT kind, verified FROM backup_log WHERE kind='pre_migration'").all()).toEqual([{ kind: 'pre_migration', verified: 1 }]);
  });
  it('does nothing and makes no backup when the database is already current', async () => {
    const o = oldInstall(); await safeMigrate({ db: o.db, migrationsDir: MIG, dataDir: o.dir, protector: prot, backupFolder: o.backups });
    const again = await safeMigrate({ db: o.db, migrationsDir: MIG, dataDir: o.dir, protector: prot, backupFolder: o.backups });
    expect(again).toEqual({ ok: true, ran: [], backedUp: false }); expect(readdirSync(o.backups)).toHaveLength(1);
  });
  it('does NOT migrate when no backup folder is configured', async () => {
    const o = oldInstall(); const r = await safeMigrate({ db: o.db, migrationsDir: MIG, dataDir: o.dir, protector: prot, backupFolder: null });
    expect(r).toEqual({ ok: false, error: 'backup_not_configured' }); expect(pendingMigrations(o.db, MIG)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
  it('does NOT migrate when the recovery key cannot be loaded', async () => {
    const o = oldInstall(); const r = await safeMigrate({ db: o.db, migrationsDir: MIG, dataDir: o.dir, protector: { ...prot, available: () => false }, backupFolder: o.backups });
    expect(r).toEqual({ ok: false, error: 'backup_not_configured' }); expect(pendingMigrations(o.db, MIG)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
  it('does NOT migrate when the backup cannot be written, and the data is untouched', async () => {
    const o = oldInstall(); const blocker = join(o.dir, 'blocker'); writeFileSync(blocker, 'x');
    const r = await safeMigrate({ db: o.db, migrationsDir: MIG, dataDir: o.dir, protector: prot, backupFolder: join(blocker, 'sub') });
    expect(r).toEqual({ ok: false, error: 'backup_failed' }); expect(pendingMigrations(o.db, MIG)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12]); expect(o.db.prepare('SELECT count(*) c FROM association').get()).toEqual({ c: 1 });
  });
  it('a brand-new database needs no backup and is simply created', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mishkat-new-')); const db = openDb(join(dir, 'm.db'));
    expect(await safeMigrate({ db, migrationsDir: MIG, dataDir: dir, protector: prot, backupFolder: null })).toEqual({ ok: true, ran: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], backedUp: false });
  });
});
