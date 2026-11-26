import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, migrate, newId, appendAudit, verifyAuditLog, type Db } from '../src';
import { generateRecoveryKey, parseRecoveryKey, storeRecoveryVerifier, checkRecoveryKey, acknowledgeRecoveryKey, isSetupKeyComplete } from '../src/recovery';
import { encryptBackup, decryptBackup, verifyBackup, createBackup, restoreBackup, readHeader, APP_SCHEMA_VERSION, type KeySource } from '../src/backup';

const NOW = '2026-09-01T08:00:00.000Z';
const tmp = () => mkdtempSync(join(tmpdir(), 'mishkat-t-'));

function mkDb(dir: string, tenant = newId(), file = 'live.db') {
  const path = join(dir, file); const db = openDb(path); migrate(db);
  db.prepare('INSERT INTO association(id,tenant_id,created_at,updated_at,created_by,updated_by,name) VALUES (?,?,?,?,?,?,?)').run(tenant, tenant, NOW, NOW, 's', 's', 'جمعية');
  return { db, path, tenant };
}
const addPerson = (db: Db, tenant: string, given: string) =>
  db.prepare('INSERT INTO person(id,tenant_id,created_at,updated_at,created_by,updated_by,given_name,family_name) VALUES (?,?,?,?,?,?,?,?)').run(newId(), tenant, NOW, NOW, 's', 's', given, 'الجزائري');
const names = (db: Db) => (db.prepare('SELECT given_name n FROM person ORDER BY given_name').all() as { n: string }[]).map((r) => r.n);
const audit = (db: Db, tenant: string, n: number) => appendAudit(db, { tenant_id: tenant, actor_id: 'u', actor_role: 'director', branch_id: null, action: 'x', entity_type: 'person', entity_id: `p${n}`, before_json: null, after_json: null, reason: null });

describe('recovery key (SEC-014, SEC-043)', () => {
  it('is 56 characters in 14 groups, parses back, tolerates dashes, case and O/0 I/1 typos', () => {
    const { key, display } = generateRecoveryKey();
    expect(display).toMatch(/^([0-9A-Z]{4}-){13}[0-9A-Z]{4}$/);
    const p = parseRecoveryKey(display); expect(p.ok && p.key.equals(key)).toBe(true);
    const sloppy = display.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o').replace(/1/g, 'l');
    const q = parseRecoveryKey(sloppy); expect(q.ok && q.key.equals(key)).toBe(true);
  });
  it('detects a typo through the checksum and rejects wrong lengths', () => {
    const { display } = generateRecoveryKey();
    const chars = display.split(''); const i = chars.findIndex((c) => c !== '-');
    chars[i] = chars[i] === 'A' ? 'B' : 'A';
    expect(parseRecoveryKey(chars.join(''))).toEqual({ ok: false, error: 'bad_checksum' });
    expect(parseRecoveryKey('ABCD')).toEqual({ ok: false, error: 'bad_format' });
    expect(parseRecoveryKey('')).toEqual({ ok: false, error: 'bad_format' });
  });
  it('generates different keys each time', () => {
    expect(generateRecoveryKey().display).not.toBe(generateRecoveryKey().display);
  });
  it('stores only a verifier, which accepts the key and rejects another', () => {
    const { db, tenant } = mkDb(tmp());
    const { key } = generateRecoveryKey(); storeRecoveryVerifier(db, tenant, key);
    expect(checkRecoveryKey(db, tenant, key)).toBe(true);
    expect(checkRecoveryKey(db, tenant, generateRecoveryKey().key)).toBe(false);
    expect(JSON.stringify(db.prepare('SELECT * FROM key_material').all())).not.toContain(key.toString('hex'));
  });
  it('setup is incomplete until the key is acknowledged, once; the verifier is immutable', () => {
    const { db, tenant } = mkDb(tmp()); const { key } = generateRecoveryKey(); storeRecoveryVerifier(db, tenant, key);
    expect(isSetupKeyComplete(db, tenant)).toBe(false);
    acknowledgeRecoveryKey(db, tenant, 'u1'); expect(isSetupKeyComplete(db, tenant)).toBe(true);
    expect(() => acknowledgeRecoveryKey(db, tenant, 'u1')).toThrow();
    expect(() => db.prepare("UPDATE key_material SET recovery_verifier=?").run('0'.repeat(64))).toThrow(/only a first acknowledgement/);
    expect(() => db.prepare('DELETE FROM key_material').run()).toThrow(/cannot be deleted/);
    expect(verifyAuditLog(db)).toEqual({ ok: true });
  });
});

describe('backup encryption (SEC-044, T-B2)', () => {
  const meta = { tenantId: 'tenant-a', schemaVersion: 2, now: NOW };
  const plain = Buffer.from('اسم الطالب: مُحَمَّد — secret-marker-123 '.repeat(50));
  const rk = (): KeySource => ({ kind: 'recovery', key: generateRecoveryKey().key });

  it('round-trips with a recovery key and with a passphrase', () => {
    const k = rk(); const e = encryptBackup(plain, meta, k);
    expect(decryptBackup(e, k)).toMatchObject({ ok: true }); expect((decryptBackup(e, k) as { plain: Buffer }).plain.equals(plain)).toBe(true);
    const p: KeySource = { kind: 'passphrase', passphrase: 'عبارة سر طويلة 2026' };
    const e2 = encryptBackup(plain, meta, p);
    expect(decryptBackup(e2, p).ok).toBe(true);
    expect(decryptBackup(e2, { kind: 'passphrase', passphrase: 'عبارة سر طويلة 2027' })).toEqual({ ok: false, error: 'wrong_key_or_tampered' });
  });
  it('is unreadable without the key: no plaintext, name or tenant appears in the file body', () => {
    const e = encryptBackup(plain, meta, rk());
    expect(e.includes(Buffer.from('secret-marker-123'))).toBe(false);
    expect(e.includes(Buffer.from('مُحَمَّد'))).toBe(false);
    expect(e.length).toBeGreaterThan(plain.length);
  });
  it('fails with the wrong key and when key type does not match the file', () => {
    const e = encryptBackup(plain, meta, rk());
    expect(decryptBackup(e, rk())).toEqual({ ok: false, error: 'wrong_key_or_tampered' });
    expect(decryptBackup(e, { kind: 'passphrase', passphrase: 'whatever long passphrase' })).toEqual({ ok: false, error: 'wrong_key_or_tampered' });
  });
  it('detects a changed byte anywhere: magic, header, ciphertext, tag', () => {
    const k = rk(); const e = encryptBackup(plain, meta, k); const headerLen = e.readUInt32BE(8);
    for (const pos of [2, 9, 14 + 5, 12 + headerLen + 10, e.length - 1]) {
      const bad = Buffer.from(e); bad[pos] = bad[pos]! ^ 1;
      expect(decryptBackup(bad, k).ok, `byte ${pos}`).toBe(false);
    }
  });
  it('rejects truncated, empty and foreign files without throwing', () => {
    const k = rk(); const e = encryptBackup(plain, meta, k);
    for (const bad of [e.subarray(0, e.length - 5), e.subarray(0, 20), Buffer.alloc(0), Buffer.from('not a backup at all, just text')])
      expect(decryptBackup(bad, k).ok).toBe(false);
    expect(readHeader(Buffer.from('garbage'))).toBeNull();
  });
  it('uses a fresh salt and nonce for every backup', () => {
    const k = rk(); const a = encryptBackup(plain, meta, k), b = encryptBackup(plain, meta, k);
    expect(a.equals(b)).toBe(false); expect(readHeader(a)!.iv).not.toBe(readHeader(b)!.iv);
  });
});

describe('createBackup and verifyBackup (BR-043, SEC-046)', () => {
  let dir: string; beforeEach(() => { dir = tmp(); });
  const key = (): KeySource => ({ kind: 'recovery', key: generateRecoveryKey().key });

  it('creates a verified backup of a live WAL database and logs it', async () => {
    const { db, tenant } = mkDb(dir); addPerson(db, tenant, 'أحمد'); audit(db, tenant, 1);
    const k = key(); const dest = join(dir, 'out', 'b1.mshkbk');
    const r = await createBackup(db, { tenantId: tenant, destFile: dest, key: k, kind: 'manual', actorId: 'u' });
    expect(r.ok).toBe(true); expect(existsSync(dest)).toBe(true); expect(existsSync(dest + '.part')).toBe(false);
    expect(verifyBackup(readFileSync(dest), k, tenant)).toMatchObject({ ok: true });
    expect(db.prepare("SELECT kind, verified FROM backup_log").all()).toEqual([{ kind: 'manual', verified: 1 }]);
  });
  it('reports failure and logs the error when the destination is unusable, leaving no file', async () => {
    const { db, tenant } = mkDb(dir); const blocker = join(dir, 'blocker'); writeFileSync(blocker, 'x');
    const r = await createBackup(db, { tenantId: tenant, destFile: join(blocker, 'x', 'b.mshkbk'), key: key(), kind: 'manual', actorId: 'u' });
    expect(r.ok).toBe(false);
    expect(db.prepare('SELECT verified, error IS NOT NULL AS has_error FROM backup_log').all()).toEqual([{ verified: 0, has_error: 1 }]);
  });
  it('rejects a backup that belongs to another association', async () => {
    const a = mkDb(dir, undefined, 'a.db'), b = mkDb(dir, undefined, 'b.db'); const k = key();
    await createBackup(b.db, { tenantId: b.tenant, destFile: join(dir, 'b.mshkbk'), key: k, kind: 'manual', actorId: 'u' });
    expect(verifyBackup(readFileSync(join(dir, 'b.mshkbk')), k, a.tenant)).toEqual({ ok: false, error: 'wrong_tenant' });
  });
  it('rejects a backup from a newer schema version', () => {
    const { path, tenant, db } = mkDb(dir); db.close(); const k = key();
    const e = encryptBackup(readFileSync(path), { tenantId: tenant, schemaVersion: APP_SCHEMA_VERSION + 1, now: NOW }, k);
    expect(verifyBackup(e, k, tenant)).toEqual({ ok: false, error: 'newer_schema' });
  });
  it('rejects validly-encrypted garbage that is not a database', () => {
    const tenant = newId(); const k = key();
    const e = encryptBackup(Buffer.from('this is not sqlite '.repeat(200)), { tenantId: tenant, schemaVersion: 2, now: NOW }, k);
    expect(verifyBackup(e, k, tenant)).toEqual({ ok: false, error: 'integrity_failed' });
  });
  it('rejects a database whose audit chain was tampered with before backup', () => {
    const { db, path, tenant } = mkDb(dir); for (let i = 1; i <= 3; i++) audit(db, tenant, i);
    db.exec('DROP TRIGGER trg_audit_no_update'); db.prepare("UPDATE audit_log SET action='forged' WHERE seq=2").run(); db.pragma('wal_checkpoint(TRUNCATE)'); db.close();
    const k = key(); const e = encryptBackup(readFileSync(path), { tenantId: tenant, schemaVersion: 2, now: NOW }, k);
    expect(verifyBackup(e, k, tenant)).toEqual({ ok: false, error: 'audit_chain_broken' });
  });
});

describe('restore drill (BR-044, SEC-046, T-B5)', () => {
  let dir: string; beforeEach(() => { dir = tmp(); });
  const rkey = () => ({ kind: 'recovery', key: generateRecoveryKey().key }) as KeySource;

  it('restores state A over state B, keeps B as a pre-restore backup, and "undo restore" brings B back', async () => {
    const { db, path, tenant } = mkDb(dir); const k = rkey();
    addPerson(db, tenant, 'A-one'); audit(db, tenant, 1);
    const bkA = join(dir, 'A.mshkbk'); expect((await createBackup(db, { tenantId: tenant, destFile: bkA, key: k, kind: 'manual', actorId: 'u' })).ok).toBe(true);
    addPerson(db, tenant, 'B-two'); audit(db, tenant, 2); expect(names(db)).toEqual(['A-one', 'B-two']);

    const r1 = await restoreBackup({ db, dbPath: path, backupFile: bkA, key: k, tenantId: tenant, preRestoreDir: join(dir, 'pre'), actorId: 'u' });
    if (!r1.ok) throw new Error(r1.error);
    expect(names(r1.db)).toEqual(['A-one']);
    expect(existsSync(r1.preRestoreBackup)).toBe(true);
    expect(verifyAuditLog(r1.db)).toEqual({ ok: true });
    expect(r1.db.prepare("SELECT action FROM audit_log ORDER BY seq DESC LIMIT 1").get()).toEqual({ action: 'backup.restore' });
    expect(r1.db.prepare("SELECT kind FROM backup_log WHERE kind='restore'").all()).toHaveLength(1);

    const r2 = await restoreBackup({ db: r1.db, dbPath: path, backupFile: r1.preRestoreBackup, key: k, tenantId: tenant, preRestoreDir: join(dir, 'pre2'), actorId: 'u' });
    if (!r2.ok) throw new Error(r2.error);
    expect(names(r2.db)).toEqual(['A-one', 'B-two']); // undo works, states never mixed
    r2.db.close();
  });
  it('changes nothing and keeps the live handle usable when the key is wrong', async () => {
    const { db, path, tenant } = mkDb(dir); addPerson(db, tenant, 'live'); const k = rkey();
    const bk = join(dir, 'x.mshkbk'); await createBackup(db, { tenantId: tenant, destFile: bk, key: k, kind: 'manual', actorId: 'u' });
    addPerson(db, tenant, 'later');
    const r = await restoreBackup({ db, dbPath: path, backupFile: bk, key: rkey(), tenantId: tenant, preRestoreDir: join(dir, 'pre'), actorId: 'u' });
    expect(r).toEqual({ ok: false, error: 'wrong_key_or_tampered' });
    expect(names(db)).toEqual(['later', 'live']); expect(existsSync(join(dir, 'pre'))).toBe(false);
  });
  it('refuses a foreign association backup and a tampered file, changing nothing', async () => {
    const a = mkDb(dir, undefined, 'a.db'), b = mkDb(dir, undefined, 'b.db'); const k = rkey();
    const bk = join(dir, 'b.mshkbk'); await createBackup(b.db, { tenantId: b.tenant, destFile: bk, key: k, kind: 'manual', actorId: 'u' });
    expect(await restoreBackup({ db: a.db, dbPath: a.path, backupFile: bk, key: k, tenantId: a.tenant, preRestoreDir: join(dir, 'p'), actorId: 'u' })).toEqual({ ok: false, error: 'wrong_tenant' });
    const bytes = readFileSync(bk); bytes[bytes.length - 40] = bytes[bytes.length - 40]! ^ 255; writeFileSync(bk, bytes);
    expect(await restoreBackup({ db: b.db, dbPath: b.path, backupFile: bk, key: k, tenantId: b.tenant, preRestoreDir: join(dir, 'p'), actorId: 'u' })).toEqual({ ok: false, error: 'wrong_key_or_tampered' });
    expect(a.db.open && b.db.open).toBe(true);
  });
  it('aborts before touching data if the pre-restore backup cannot be written', async () => {
    const { db, path, tenant } = mkDb(dir); addPerson(db, tenant, 'keep'); const k = rkey();
    const bk = join(dir, 'ok.mshkbk'); await createBackup(db, { tenantId: tenant, destFile: bk, key: k, kind: 'manual', actorId: 'u' });
    addPerson(db, tenant, 'newer'); const blocker = join(dir, 'blocker'); writeFileSync(blocker, 'x');
    const r = await restoreBackup({ db, dbPath: path, backupFile: bk, key: k, tenantId: tenant, preRestoreDir: join(blocker, 'sub'), actorId: 'u' });
    expect(r).toEqual({ ok: false, error: 'pre_restore_backup_failed' });
    expect(db.open).toBe(true); expect(names(db)).toEqual(['keep', 'newer']);
  });
});
