import { join } from 'node:path';
import { createBackup, loadRecoveryKey, migrate, pendingMigrations, type Db, type Protector } from '@mishkat/db';

export type SafeMigrateResult = { ok: true; ran: number[]; backedUp: boolean } | { ok: false; error: 'backup_not_configured' | 'backup_failed' };

/** BR-043: an existing installation is never migrated without a verified backup first. If the backup cannot be made, the app
 *  does NOT migrate (and the caller must not open the data). A brand-new database (no association yet) has nothing to protect. */
export async function safeMigrate(a: { db: Db; migrationsDir: string; dataDir: string; protector: Protector; backupFolder: string | null; now?: () => string }): Promise<SafeMigrateResult> {
  const pending = pendingMigrations(a.db, a.migrationsDir);
  if (pending.length === 0) return { ok: true, ran: [], backedUp: false };
  const hasSchema = !!a.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='association'").get();
  const tenant = hasSchema ? (a.db.prepare('SELECT id FROM association LIMIT 1').get() as { id: string } | undefined)?.id : undefined;
  let backedUp = false;
  if (tenant) {
    const key = loadRecoveryKey(a.dataDir, a.protector);
    if (!key || !a.backupFolder) return { ok: false, error: 'backup_not_configured' };
    const stamp = (a.now ?? (() => new Date().toISOString()))().replace(/[:.]/g, '-');
    const r = await createBackup(a.db, { tenantId: tenant, destFile: join(a.backupFolder, `mishkat-before-update-${stamp}.mshkbk`), key: { kind: 'recovery', key }, kind: 'pre_migration', actorId: 'system:startup' }, a.now);
    if (!r.ok) return { ok: false, error: 'backup_failed' };
    backedUp = true;
  }
  return { ok: true, ran: migrate(a.db, a.migrationsDir), backedUp };
}
