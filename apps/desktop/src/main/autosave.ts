import { join } from 'node:path';

/** Helpers for automatic saving (backups made without anyone asking). Pure, so they are tested without Electron. */

export interface FolderSuggestion { id: string; label: string; path: string; kind: 'drive' | 'desktop' | 'documents' }
export const BACKUP_SUBFOLDER = 'Mishkat-Backups';

/** Places a backup folder can be proposed in. Google Drive is only DETECTED as a local folder that Google Drive for desktop keeps in sync;
 *  the app never talks to Google. VERIFY: the folder names Google Drive for desktop uses ("My Drive" on a lettered drive, "Google Drive" in the user folder) can differ by version and language. */
export function folderSuggestions(o: { home: string; desktop: string; documents: string; exists: (p: string) => boolean; letters?: string }): FolderSuggestion[] {
  const out: FolderSuggestion[] = []; const seen = new Set<string>();
  const add = (s: FolderSuggestion) => { if (!seen.has(s.path.toLowerCase())) { seen.add(s.path.toLowerCase()); out.push(s); } };
  const drive: string[] = [join(o.home, 'Google Drive'), join(o.home, 'My Drive')];
  for (const l of (o.letters ?? 'DEFGHIJKLMNOPQRSTUVWXYZ')) drive.push(`${l}:\\My Drive`, `${l}:\\Google Drive`);
  for (const p of drive) if (o.exists(p)) add({ id: 'drive:' + p, label: 'Google Drive (يُزامَن تلقائياً إلى الإنترنت)', path: join(p, BACKUP_SUBFOLDER), kind: 'drive' });
  add({ id: 'desktop', label: 'سطح المكتب', path: join(o.desktop, BACKUP_SUBFOLDER), kind: 'desktop' });
  add({ id: 'documents', label: 'المستندات', path: join(o.documents, BACKUP_SUBFOLDER), kind: 'documents' });
  return out;
}

const DAY = 86_400_000;
/** Which automatic backups to delete so the folder does not fill up: keep everything from the last 2 days; for the last 90 days keep the newest of each day; delete older ones.
 *  Only ever applied to backups the program made by itself ("scheduled"); manual, pre-import, pre-upgrade and pre-restore backups are never passed in. Returns the paths to delete. */
export function pruneScheduled(files: { path: string; atMs: number }[], nowMs: number): string[] {
  const sorted = [...files].sort((a, b) => b.atMs - a.atMs); const keptDays = new Set<string>(); const del: string[] = [];
  for (const f of sorted) {
    const age = nowMs - f.atMs;
    if (age <= 2 * DAY) continue;
    if (age > 90 * DAY) { del.push(f.path); continue; }
    const day = new Date(f.atMs).toISOString().slice(0, 10);
    if (keptDays.has(day)) del.push(f.path); else keptDays.add(day);
  }
  return del;
}
