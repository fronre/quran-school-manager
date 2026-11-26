import Database from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { uuidv7, computeHash, verifyChain, GENESIS_HASH, type AuditEntry, type StoredAuditEntry } from '@mishkat/domain';

export type Db = Database.Database;
export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
export const newId = (): string => uuidv7(Date.now(), randomBytes(10));
export const nowIso = (): string => new Date().toISOString();

// Lazy: when bundled to CommonJS for the desktop app, import.meta.url is unavailable, so callers pass the directory.
const defaultMigrationsDir = (): string => fileURLToPath(new URL('../migrations/', import.meta.url));

export function openDb(file: string): Db {
  const db = new Database(file);
  try {
    if (file !== ':memory:') { db.pragma('journal_mode = WAL'); db.pragma('synchronous = FULL'); } // every committed change is on disk before the app says "saved" (power cut safe)
    db.pragma('foreign_keys = ON');
    return db;
  } catch (e) { db.close(); throw e; } // never leak a handle on a corrupt file (it would lock the file on Windows)
}

/** Applies pending forward-only migrations in order; refuses to run if an applied file was edited (checksum). */
export function migrate(db: Db, dir: string = defaultMigrationsDir()): number[] {
  const files = readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migration'").get();
  const applied = new Map<number, string>();
  if (hasTable) for (const r of db.prepare('SELECT version, checksum FROM schema_migration').all() as { version: number; checksum: string }[]) applied.set(r.version, r.checksum);
  const ran: number[] = [];
  for (const f of files) {
    const version = Number(f.slice(0, 3)); const body = readFileSync(join(dir, f), 'utf8'); const checksum = sha256(body);
    const prev = applied.get(version);
    if (prev !== undefined) { if (prev !== checksum) throw new Error(`Migration ${f} was modified after being applied`); continue; }
    db.transaction(() => {
      db.exec(body);
      db.prepare('INSERT INTO schema_migration(version, name, applied_at, checksum) VALUES (?,?,?,?)').run(version, f, nowIso(), checksum);
    })();
    ran.push(version);
  }
  return ran;
}

/** Appends one audit entry, chained to the previous one, inside the caller's transaction or its own. */
export function appendAudit(db: Db, e: Omit<AuditEntry, 'id' | 'at'> & { id?: string; at?: string }): StoredAuditEntry {
  const entry: AuditEntry = { ...e, id: e.id ?? newId(), at: e.at ?? nowIso() };
  const run = db.transaction((): StoredAuditEntry => {
    const last = db.prepare('SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1').get() as { seq: number; hash: string } | undefined;
    const prev = last?.hash ?? GENESIS_HASH; const hash = computeHash(prev, entry, sha256);
    const info = db.prepare(`INSERT INTO audit_log(id,tenant_id,at,actor_id,actor_role,branch_id,action,entity_type,entity_id,before_json,after_json,reason,prev_hash,hash)
      VALUES (@id,@tenant_id,@at,@actor_id,@actor_role,@branch_id,@action,@entity_type,@entity_id,@before_json,@after_json,@reason,@prev_hash,@hash)`).run({ ...entry, prev_hash: prev, hash });
    return { ...entry, seq: Number(info.lastInsertRowid), prev_hash: prev, hash };
  });
  return run();
}

export function verifyAuditLog(db: Db) {
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY seq').all() as StoredAuditEntry[];
  return verifyChain(rows, sha256);
}

export * from './auth';
export * from './recovery';
export * from './backup';
export * from './setup';
export * from './keystore';
export * from './students';
export * from './import';
export * from './finance';

/** Versions of migration files that have not been applied to this database yet (used to back up BEFORE migrating, BR-043). */
export function pendingMigrations(db: Db, dir: string = defaultMigrationsDir()): number[] {
  const files = readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migration'").get();
  const applied = new Set<number>(has ? (db.prepare('SELECT version FROM schema_migration').all() as { version: number }[]).map((r) => r.version) : []);
  return files.map((f) => Number(f.slice(0, 3))).filter((v) => !applied.has(v));
}
export * from './staff';
export * from './settings';
export * from './groups';
export * from './attendance';
export * from './reports';
export * from './memorization';
export * from './guardians';
export * from './years';
export * from './appsettings';
export * from './accounts';
export * from './guardianportal';
