import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Stores the recovery key protected by an OS facility (Windows DPAPI via Electron safeStorage in the app) so that scheduled
 *  backups can run unattended (SEC-041). The recovery key written on paper stays the only way to recover on another PC.
 *  Known limit: anyone signed in to this Windows account can use the stored key (same exposure as the unencrypted database today). */
export interface Protector { available(): boolean; encrypt(plain: Buffer): Buffer; decrypt(blob: Buffer): Buffer }

const FILE = 'recovery.key.bin';

export function saveRecoveryKey(dir: string, p: Protector, key: Buffer): void {
  if (!p.available()) throw new Error('os_protection_unavailable');
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, FILE + '.part'); writeFileSync(tmp, p.encrypt(key)); renameSync(tmp, join(dir, FILE));
}
export function loadRecoveryKey(dir: string, p: Protector): Buffer | null {
  const f = join(dir, FILE);
  if (!existsSync(f) || !p.available()) return null;
  try { const k = p.decrypt(readFileSync(f)); return k.length === 32 ? k : null; } catch { return null; }
}
