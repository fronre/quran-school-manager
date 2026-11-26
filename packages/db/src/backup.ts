import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { argon2idRaw } from './kdf';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { appendAudit, migrate, newId, nowIso, openDb, verifyAuditLog, type Db } from './index';

/** Encrypted, authenticated backup file (SEC-044). Layout:
 *  MAGIC(8) | headerLen(uint32 BE) | header JSON | AES-256-GCM ciphertext | tag(16).
 *  The magic, length and header are authenticated as AAD, so changing any byte fails decryption. */
const MAGIC = Buffer.from('MSHKBK1\0', 'latin1');
export const APP_SCHEMA_VERSION = 12; // highest migration this build understands

export type KeySource = { kind: 'recovery'; key: Buffer } | { kind: 'passphrase'; passphrase: string };
export interface BackupHeader {
  v: 1; tenant_id: string; created_at: string; schema_version: number;
  kdf: { type: 'hkdf-sha256'; salt: string } | { type: 'argon2id'; salt: string; m: number; t: number; p: number };
  iv: string; plain_sha256: string;
}
export type BackupKind = 'manual' | 'scheduled' | 'pre_migration' | 'pre_import' | 'pre_restore';

const ARGON_BACKUP = { m: 65536, t: 6, p: 1 };

function deriveKey(src: KeySource, kdf: BackupHeader['kdf']): Buffer {
  const salt = Buffer.from(kdf.salt, 'base64');
  if (kdf.type === 'hkdf-sha256') {
    if (src.kind !== 'recovery') throw new KeyMismatch();
    return Buffer.from(hkdfSync('sha256', src.key, salt, 'mishkat-backup-v1', 32));
  }
  if (src.kind !== 'passphrase') throw new KeyMismatch();
  return argon2idRaw({ password: Buffer.from(src.passphrase.normalize('NFKC'), 'utf8'), salt, memoryKiB: kdf.m, passes: kdf.t, parallelism: kdf.p, tagLength: 32 });
}
class KeyMismatch extends Error {}

export function encryptBackup(plain: Buffer, meta: { tenantId: string; schemaVersion: number; now: string }, src: KeySource): Buffer {
  const salt = randomBytes(16), iv = randomBytes(12);
  const kdf: BackupHeader['kdf'] = src.kind === 'recovery' ? { type: 'hkdf-sha256', salt: salt.toString('base64') } : { type: 'argon2id', salt: salt.toString('base64'), ...ARGON_BACKUP };
  const header: BackupHeader = { v: 1, tenant_id: meta.tenantId, created_at: meta.now, schema_version: meta.schemaVersion, kdf, iv: iv.toString('base64'), plain_sha256: createHash('sha256').update(plain).digest('hex') };
  const hb = Buffer.from(JSON.stringify(header), 'utf8'); const len = Buffer.alloc(4); len.writeUInt32BE(hb.length);
  const aad = Buffer.concat([MAGIC, len, hb]);
  const c = createCipheriv('aes-256-gcm', deriveKey(src, kdf), iv); c.setAAD(aad);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([aad, ct, c.getAuthTag()]);
}

export type DecryptResult = { ok: true; plain: Buffer; header: BackupHeader } | { ok: false; error: 'bad_format' | 'wrong_key_or_tampered' };
export function readHeader(file: Buffer): BackupHeader | null {
  try {
    if (file.length < MAGIC.length + 4 + 16 || !file.subarray(0, 8).equals(MAGIC)) return null;
    const n = file.readUInt32BE(8); if (n > 65536 || 12 + n + 16 > file.length) return null;
    const h = JSON.parse(file.subarray(12, 12 + n).toString('utf8')) as BackupHeader;
    return h.v === 1 && typeof h.tenant_id === 'string' && h.kdf && typeof h.iv === 'string' ? h : null;
  } catch { return null; }
}
export function decryptBackup(file: Buffer, src: KeySource): DecryptResult {
  const header = readHeader(file); if (!header) return { ok: false, error: 'bad_format' };
  const n = file.readUInt32BE(8); const aad = file.subarray(0, 12 + n);
  try {
    const d = createDecipheriv('aes-256-gcm', deriveKey(src, header.kdf), Buffer.from(header.iv, 'base64'));
    d.setAAD(aad); d.setAuthTag(file.subarray(file.length - 16));
    const plain = Buffer.concat([d.update(file.subarray(12 + n, file.length - 16)), d.final()]);
    if (createHash('sha256').update(plain).digest('hex') !== header.plain_sha256) return { ok: false, error: 'wrong_key_or_tampered' };
    return { ok: true, plain, header };
  } catch { return { ok: false, error: 'wrong_key_or_tampered' }; }
}

export type VerifyError = 'bad_format' | 'wrong_key_or_tampered' | 'wrong_tenant' | 'newer_schema' | 'integrity_failed' | 'audit_chain_broken';
export type VerifyResult = { ok: true; header: BackupHeader; sizeBytes: number } | { ok: false; error: VerifyError };

/** Full verification (SEC-046): authenticity, tenant, schema version, SQLite integrity, foreign keys, audit chain. */
export function verifyBackup(file: Buffer, src: KeySource, expectedTenantId: string): VerifyResult {
  const peek = readHeader(file);
  if (!peek) return { ok: false, error: 'bad_format' };
  const dec = decryptBackup(file, src); if (!dec.ok) return dec;
  if (dec.header.tenant_id !== expectedTenantId) return { ok: false, error: 'wrong_tenant' };
  if (dec.header.schema_version > APP_SCHEMA_VERSION) return { ok: false, error: 'newer_schema' };
  const dir = mkdtempSync(join(tmpdir(), 'mishkat-verify-')); const p = join(dir, 'v.db');
  try {
    writeFileSync(p, dec.plain);
    let db: Db | null = null;
    try {
      db = openDb(p);
      if (db.pragma('integrity_check', { simple: true }) !== 'ok' || (db.pragma('foreign_key_check') as unknown[]).length > 0) return { ok: false, error: 'integrity_failed' };
      const a = db.prepare('SELECT id FROM association').get() as { id: string } | undefined;
      if (!a || a.id !== expectedTenantId) return { ok: false, error: 'wrong_tenant' };
      if (!verifyAuditLog(db).ok) return { ok: false, error: 'audit_chain_broken' };
    } catch { return { ok: false, error: 'integrity_failed' }; } finally { try { db?.close(); } catch { /* ignore */ } }
    return { ok: true, header: dec.header, sizeBytes: file.length };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

export type CreateResult = { ok: true; file: string; sizeBytes: number; checksum: string } | { ok: false; error: string };

/** Online backup of the live database -> encrypted file -> verified by decrypting it again (BR-043). */
export async function createBackup(db: Db, a: { tenantId: string; destFile: string; key: KeySource; kind: BackupKind; actorId: string }, now: () => string = nowIso): Promise<CreateResult> {
  const started = now(); const dir = mkdtempSync(join(tmpdir(), 'mishkat-bk-')); const tmp = join(dir, 'snap.db');
  try {
    await db.backup(tmp);
    const schemaVersion = (db.prepare('SELECT max(version) v FROM schema_migration').get() as { v: number }).v;
    const enc = encryptBackup(readFileSync(tmp), { tenantId: a.tenantId, schemaVersion, now: started }, a.key);
    mkdirSync(dirname(a.destFile), { recursive: true });
    const part = a.destFile + '.part'; writeFileSync(part, enc); renameSync(part, a.destFile); // never leave a half-written backup under the final name
    const v = verifyBackup(readFileSync(a.destFile), a.key, a.tenantId);
    if (!v.ok) { rmSync(a.destFile, { force: true }); throw new Error(`verification failed: ${v.error}`); }
    const checksum = createHash('sha256').update(enc).digest('hex');
    db.prepare('INSERT INTO backup_log(id,tenant_id,kind,destination,started_at,finished_at,size_bytes,verified,checksum) VALUES (?,?,?,?,?,?,?,1,?)')
      .run(newId(), a.tenantId, a.kind, a.destFile, started, now(), enc.length, checksum);
    return { ok: true, file: a.destFile, sizeBytes: enc.length, checksum };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try { db.prepare('INSERT INTO backup_log(id,tenant_id,kind,destination,started_at,finished_at,verified,error) VALUES (?,?,?,?,?,?,0,?)').run(newId(), a.tenantId, a.kind, a.destFile, started, now(), msg); } catch { /* log is best effort */ }
    return { ok: false, error: msg };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

export type RestoreResult = { ok: true; db: Db; preRestoreBackup: string } | { ok: false; error: VerifyError | 'pre_restore_backup_failed' };

/** Safe restore (BR-044, SEC-046): verify the backup first, back up the current state, then swap atomically.
 *  The caller's `db` handle is closed on success; use the returned handle. On any failure nothing changes. */
export async function restoreBackup(a: { db: Db; dbPath: string; backupFile: string; key: KeySource; tenantId: string; preRestoreDir: string; actorId: string; migrationsDir?: string }, now: () => string = nowIso): Promise<RestoreResult> {
  const file = readFileSync(a.backupFile);
  const v = verifyBackup(file, a.key, a.tenantId); if (!v.ok) return v;
  const dec = decryptBackup(file, a.key); if (!dec.ok) return dec;
  const stamp = now().replace(/[:.]/g, '-');
  const pre = join(a.preRestoreDir, `pre-restore-${stamp}.mshkbk`);
  const made = await createBackup(a.db, { tenantId: a.tenantId, destFile: pre, key: a.key, kind: 'pre_restore', actorId: a.actorId }, now);
  if (!made.ok) return { ok: false, error: 'pre_restore_backup_failed' };
  a.db.close();
  for (const ext of ['-wal', '-shm']) rmSync(a.dbPath + ext, { force: true });
  const tmp = a.dbPath + '.restoring'; writeFileSync(tmp, dec.plain); renameSync(tmp, a.dbPath);
  const db = openDb(a.dbPath); migrate(db, a.migrationsDir); // the bundled app must pass its own migrations folder
  const t = now();
  db.prepare('INSERT INTO backup_log(id,tenant_id,kind,destination,started_at,finished_at,size_bytes,verified,checksum) VALUES (?,?,?,?,?,?,?,1,?)')
    .run(newId(), a.tenantId, 'restore', a.backupFile, t, t, statSync(a.backupFile).size, createHash('sha256').update(file).digest('hex'));
  appendAudit(db, { tenant_id: a.tenantId, at: t, actor_id: a.actorId, actor_role: 'director', branch_id: null, action: 'backup.restore', entity_type: 'backup', entity_id: v.header.created_at, before_json: null, after_json: JSON.stringify({ backup_created_at: v.header.created_at, pre_restore_backup: pre }), reason: null });
  return { ok: true, db, preRestoreBackup: pre };
}
export const backupExists = (f: string): boolean => existsSync(f);

export type NewComputerResult = { ok: true; db: Db; tenantId: string; backupCreatedAt: string } | { ok: false; error: VerifyError | 'already_set_up' };

/** Moving to another computer (first run on a fresh install): the association's backup file + the recovery key from the paper
 *  replace the EMPTY database of this installation. The backup is fully verified first (key, integrity, audit chain, schema)
 *  and nothing is touched when anything fails. Refused once this installation has an association of its own, so it can never
 *  overwrite real data (for that, the normal restore with re-authentication exists). The caller's `db` is closed on success. */
export function restoreOnNewComputer(a: { db: Db; dbPath: string; backupFile: string; key: Buffer; migrationsDir?: string }, now: () => string = nowIso): NewComputerResult {
  if (a.db.prepare('SELECT 1 FROM association LIMIT 1').get()) return { ok: false, error: 'already_set_up' };
  const file = readFileSync(a.backupFile); const src: KeySource = { kind: 'recovery', key: a.key };
  const peek = readHeader(file); if (!peek) return { ok: false, error: 'bad_format' };
  const v = verifyBackup(file, src, peek.tenant_id); if (!v.ok) return v; // the header is authenticated: after a successful decryption its tenant is trustworthy
  const dec = decryptBackup(file, src); if (!dec.ok) return dec;
  const tenantId = dec.header.tenant_id;
  a.db.close();
  for (const ext of ['-wal', '-shm']) rmSync(a.dbPath + ext, { force: true });
  const tmp = a.dbPath + '.restoring'; writeFileSync(tmp, dec.plain); renameSync(tmp, a.dbPath);
  const db = openDb(a.dbPath); migrate(db, a.migrationsDir);
  const t = now();
  db.prepare('INSERT INTO backup_log(id,tenant_id,kind,destination,started_at,finished_at,size_bytes,verified,checksum) VALUES (?,?,?,?,?,?,?,1,?)')
    .run(newId(), tenantId, 'restore', a.backupFile, t, t, file.length, createHash('sha256').update(file).digest('hex'));
  appendAudit(db, { tenant_id: tenantId, at: t, actor_id: 'setup', actor_role: 'system', branch_id: null, action: 'backup.restore_new_computer', entity_type: 'backup', entity_id: dec.header.created_at, before_json: null, after_json: JSON.stringify({ backup_created_at: dec.header.created_at }), reason: null });
  return { ok: true, db, tenantId, backupCreatedAt: dec.header.created_at };
}
