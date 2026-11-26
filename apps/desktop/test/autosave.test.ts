import { describe, it, expect } from 'vitest';
import { folderSuggestions, pruneScheduled } from '../src/main/autosave';

describe('backup folder suggestions', () => {
  const base = { home: 'C:\\Users\\x', desktop: 'C:\\Users\\x\\Desktop', documents: 'C:\\Users\\x\\Documents' };
  it('always offers desktop and documents, as a Mishkat-Backups subfolder', () => {
    const s = folderSuggestions({ ...base, exists: () => false }); expect(s.map((x) => x.id)).toEqual(['desktop', 'documents']); expect(s[0]!.path).toBe('C:\\Users\\x\\Desktop\\Mishkat-Backups');
  });
  it('detects a Google Drive folder kept in sync on this PC and offers it first', () => {
    const s = folderSuggestions({ ...base, exists: (p) => p === 'G:\\My Drive' }); expect(s[0]).toMatchObject({ kind: 'drive', path: 'G:\\My Drive\\Mishkat-Backups' }); expect(s).toHaveLength(3);
  });
  it('detects the user-folder variant and never lists the same path twice', () => {
    const s = folderSuggestions({ ...base, exists: (p) => p === 'C:\\Users\\x\\Google Drive' || p === 'C:\\Users\\x\\Google Drive' }); expect(s.filter((x) => x.kind === 'drive')).toHaveLength(1);
  });
});

describe('pruning automatic backups', () => {
  const NOW = Date.parse('2026-11-20T12:00:00Z'); const h = (n: number) => NOW - n * 3_600_000; const d = (n: number) => NOW - n * 86_400_000;
  it('keeps everything from the last two days', () => { expect(pruneScheduled([1, 2, 5, 20, 47].map((n) => ({ path: 'a' + n, atMs: h(n) })), NOW)).toEqual([]); });
  it('keeps the newest of each older day and deletes the rest', () => {
    const files = [{ path: 'd5-late', atMs: d(5) + 3_600_000 }, { path: 'd5-early', atMs: d(5) - 3_600_000 }, { path: 'd6', atMs: d(6) }];
    expect(pruneScheduled(files, NOW)).toEqual(['d5-early']);
  });
  it('deletes automatic backups older than 90 days', () => { expect(pruneScheduled([{ path: 'old', atMs: d(91) }, { path: 'ok', atMs: d(89) }], NOW)).toEqual(['old']); });
  it('does not mutate its input and handles an empty list', () => { const f = [{ path: 'x', atMs: d(3) }]; pruneScheduled(f, NOW); expect(f).toHaveLength(1); expect(pruneScheduled([], NOW)).toEqual([]); });
});
