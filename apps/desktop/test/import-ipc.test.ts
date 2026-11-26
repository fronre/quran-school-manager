import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, migrate, runSetup, generateRecoveryKey, createUser, assignRole, saveRecoveryKey, verifyAuditLog, type Protector } from '@mishkat/db';
import { writeXlsx, readXlsx, LIMITS } from '@mishkat/files';
import { createDispatcher, type Deps } from '../src/main/ipc';

const FAST = { memoryKiB: 8, passes: 1, parallelism: 1 };
const xor = (b: Buffer) => Buffer.from(b.map((x) => x ^ 0x5a));
const prot: Protector = { available: () => true, encrypt: xor, decrypt: xor };
const PW = 'a-long-test-password';
const HEAD = ['الرقم', 'الاسم الكامل', 'تاريخ الازدياد', 'الفرع', 'الهاتف', 'الحالة'];
const sheet = (rows: (string | number | null)[][], headers: string[] = HEAD) => writeXlsx({ name: 'طلاب', headers, rows });

function app() {
  const db = openDb(':memory:'); migrate(db);
  const key = generateRecoveryKey().key;
  const { tenantId } = runSetup(db, { admin: { givenName: 'علي', familyName: 'المدير', username: 'dir', password: PW }, association: { name: 'جمعية علماء المسلمين في سيدي عون' },
    branches: [{ name: 'فرع الرجال' }, { name: 'فرع النساء' }], year: { name: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30' } }, key, { argon2: FAST });
  const [men, women] = (db.prepare('SELECT id FROM branch ORDER BY position').all() as { id: string }[]).map((b) => b.id) as [string, string];
  const mk = (username: string, role: 'registrar' | 'academic_supervisor', branchId: string) => {
    const p = crypto.randomUUID(), s = crypto.randomUUID(); const now = '2026-09-01T08:00:00.000Z';
    db.prepare('INSERT INTO person(id,tenant_id,created_at,updated_at,created_by,updated_by,given_name,family_name) VALUES (?,?,?,?,?,?,?,?)').run(p, tenantId, now, now, 's', 's', username, 'م');
    db.prepare("INSERT INTO staff_member(id,tenant_id,created_at,updated_at,created_by,updated_by,person_id,kind) VALUES (?,?,?,?,?,?,?,'employee')").run(s, tenantId, now, now, 's', 's', p);
    const u = createUser(db, { tenantId, staffMemberId: s, username, password: PW, actor: { id: 's', role: 'system' } }, { argon2: FAST });
    if (!u.ok) throw new Error('setup'); assignRole(db, { tenantId, userId: u.userId, role, branchId, actor: { id: 's', role: 'system' } });
  };
  mk('regm', 'registrar', men); mk('acadw', 'academic_supervisor', women);
  const dir = mkdtempSync(join(tmpdir(), 'mishkat-imp-')); const folder = join(dir, 'backups');
  saveRecoveryKey(dir, prot, key);
  let saved = { backupFolder: folder as string | null };
  const state = { file: null as { name: string; data: Buffer } | { error: 'too_large' } | null, saved: [] as { name: string; data: Buffer | string; kind: string }[], saveOk: true };
  const d: Deps = { db, version: '0', session: { current: null }, authOptions: { argon2: FAST }, dataDir: dir, protector: prot, settings: { get: () => saved, set: (v) => { saved = { ...saved, ...v } as typeof saved; } },
    pickFolder: async () => null, defaultBackupFolder: folder, wizard: { key: null, backupFolder: null }, tenantId: () => tenantId, now: () => '2026-11-20T09:00:00.000Z', importJob: { current: null }, finance: { lastActive: null }, dbPath: '', restart: () => {}, pickImage: async () => null, processImage: () => null,
    pickOpenFile: async () => state.file, saveFile: async (name, data, kind) => { if (!state.saveOk) return null; state.saved.push({ name, data, kind }); return name; } };
  const run = createDispatcher(d);
  const as = async (u: string) => { await run('auth.logout', {}); if (!((await run('auth.login', { username: u, password: PW })) as { ok: boolean }).ok) throw new Error('login'); };
  return { db, run, as, men, women, d, dir, folder, state, setFolder: (f: string | null) => { saved = { backupFolder: f }; } };
}
const opts = (men: string, over: Record<string, unknown> = {}) => ({ mapping: { studentNo: 0, fullName: 1, birthDate: 2, branch: 3, phone: 4, status: 5 }, nameOrder: 'given-first', defaultBranchId: men, defaultStatus: 'active', ...over });
const CLEAN = [[1, 'أحمد بن عمر', '10/03/2015', 'رجال', '0550123456', 'نشط'], [2, 'فاطمة بلقاسم', '01/01/2014', 'نساء', '0661000000', ''], [null, 'يوسف حمداني', '', 'الرجال', '', 'موقوف']];
const count = (db: ReturnType<typeof app>['db'], t: string) => (db.prepare(`SELECT count(*) c FROM ${t}`).get() as { c: number }).c;

describe('import: choosing and previewing a file', () => {
  let a: ReturnType<typeof app>; beforeEach(async () => { a = app(); await a.as('dir'); });

  it('is Director-only and needs a signed-in user', async () => {
    await a.as('regm'); await expect(a.run('import.pickFile', {})).rejects.toMatchObject({ code: 'forbidden' });
    await expect(a.run('import.preview', opts(a.men))).rejects.toMatchObject({ code: 'forbidden' });
    await a.run('auth.logout', {}); await expect(a.run('import.pickFile', {})).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('reports a cancelled dialog and file-reading problems in plain Arabic', async () => {
    expect(await a.run('import.pickFile', {})).toMatchObject({ ok: false, error: 'cancelled' });
    a.state.file = { error: 'too_large' }; expect(await a.run('import.pickFile', {})).toMatchObject({ ok: false, error: 'too_large', message: expect.stringContaining('كبير') });
    a.state.file = { name: 'old.xls', data: Buffer.from('x') }; expect(await a.run('import.pickFile', {})).toMatchObject({ ok: false, error: 'unsupported_xls', message: expect.stringContaining('xlsx') });
    a.state.file = { name: 'x.xlsx', data: Buffer.from('garbage') }; expect(await a.run('import.pickFile', {})).toMatchObject({ ok: false, error: 'unreadable' });
    a.state.file = { name: 'x.xlsx', data: Buffer.alloc(10) }; expect(await a.run('import.pickFile', {})).toMatchObject({ ok: false });
    expect(LIMITS.maxBytes).toBe(10 * 1024 * 1024);
  });
  it('reads the file, suggests a column mapping and shows a sample', async () => {
    a.state.file = { name: 'طلاب.xlsx', data: await sheet(CLEAN) };
    const r = (await a.run('import.pickFile', {})) as { ok: boolean; headers: string[]; rowCount: number; mapping: Record<string, number>; sample: string[][]; branches: unknown[] };
    expect(r.ok).toBe(true); expect(r.headers).toEqual(HEAD); expect(r.rowCount).toBe(3);
    expect(r.mapping).toEqual({ studentNo: 0, fullName: 1, birthDate: 2, branch: 3, phone: 4, status: 5 }); expect(r.sample[0]![1]).toBe('أحمد بن عمر'); expect(r.branches).toHaveLength(2);
  });
  it('previews: counts valid rows and lists problems with codes, without touching the database', async () => {
    a.state.file = { name: 'x.xlsx', data: await sheet([...CLEAN, [9, 'ناقص', '30/02/2015', 'الأطفال', 'abc', 'غريب']]) };
    await a.run('import.pickFile', {});
    const p = (await a.run('import.preview', opts(a.men))) as { ok: boolean; total: number; valid: number; withIssues: number; issueCounts: Record<string, number>; rows: { row: number; issues: unknown[] }[] };
    expect(p).toMatchObject({ ok: true, total: 4, valid: 3, withIssues: 1 });
    expect(Object.keys(p.issueCounts).sort()).toEqual(['birthDate:bad_date', 'branch:unknown_branch', 'familyName:required', 'phone:bad_phone', 'status:bad_status']);
    expect(p.rows[0]!.row).toBe(5); // problem rows come first; sheet row numbers are shown to users
    expect(count(a.db, 'student')).toBe(0);
  });
  it('rejects a mapping without a name column, and previews nothing without a chosen file', async () => {
    expect(await a.run('import.preview', opts(a.men))).toEqual({ ok: false, error: 'no_file' });
    a.state.file = { name: 'x.xlsx', data: await sheet(CLEAN) }; await a.run('import.pickFile', {});
    expect(await a.run('import.preview', opts(a.men, { mapping: { phone: 4 } }))).toEqual({ ok: false, error: 'mapping', problems: ['name_columns_missing'] });
  });
  it('rejects malformed option payloads at the schema', async () => {
    for (const bad of [{ ...opts(a.men), mapping: { fullName: -1 } }, { ...opts(a.men), mapping: { hacker: 1 } }, { ...opts(a.men), nameOrder: 'x' }, { ...opts(a.men), extra: 1 }])
      await expect(a.run('import.preview', bad)).rejects.toMatchObject({ code: 'invalid_payload' });
  });
});

describe('import: commit (BR-043, BR-045)', () => {
  let a: ReturnType<typeof app>;
  beforeEach(async () => { a = app(); await a.as('dir'); });
  const load = async (rows: (string | number | null)[][]) => { a.state.file = { name: 'طلاب.xlsx', data: await sheet(rows) }; await a.run('import.pickFile', {}); };

  it('takes a verified backup first, imports all rows atomically, audits once and clears the job', async () => {
    await load(CLEAN);
    const r = (await a.run('import.commit', { ...opts(a.men), skipInvalid: false })) as { ok: boolean; imported: number; skipped: number };
    expect(r).toEqual({ ok: true, imported: 3, skipped: 0 }); expect(count(a.db, 'student')).toBe(3);
    expect(readdirSync(a.folder).filter((f) => f.endsWith('.mshkbk'))).toHaveLength(1);
    expect(a.db.prepare("SELECT kind, verified FROM backup_log WHERE kind='pre_import'").all()).toEqual([{ kind: 'pre_import', verified: 1 }]);
    expect(a.db.prepare("SELECT count(*) c FROM audit_log WHERE action='student.import'").get()).toEqual({ c: 1 });
    expect(verifyAuditLog(a.db)).toEqual({ ok: true });
    expect(await a.run('import.commit', { ...opts(a.men), skipInvalid: false })).toEqual({ ok: false, error: 'no_file' });
    const names = (a.db.prepare('SELECT p.given_name g, s.student_no n, b.name br, s.status st FROM student s JOIN person p ON p.id=s.person_id JOIN branch b ON b.id=s.branch_id ORDER BY s.student_no').all() as Record<string, string>[]);
    expect(names.map((x) => [x.n, x.g, x.br, x.st])).toEqual([['0003', 'يوسف', 'فرع الرجال', 'suspended'], ['1', 'أحمد', 'فرع الرجال', 'active'], ['2', 'فاطمة', 'فرع النساء', 'active']]);
  });
  it('blocks the whole import when rows have problems, unless the user chooses to skip them', async () => {
    await load([...CLEAN, [9, 'ناقص', '', 'رجال', '', '']]);
    expect(await a.run('import.commit', { ...opts(a.men), skipInvalid: false })).toEqual({ ok: false, error: 'has_issues', withIssues: 1 });
    expect(count(a.db, 'student')).toBe(0); expect(readdirSync(a.dir).includes('backups')).toBe(false); // no backup either: nothing started
    expect(await a.run('import.commit', { ...opts(a.men), skipInvalid: true })).toEqual({ ok: true, imported: 3, skipped: 1 });
  });
  it('does not import when the safety backup cannot be made (BR-043)', async () => {
    await load(CLEAN); writeFileSync(join(a.dir, 'blocker'), 'x'); a.setFolder(join(a.dir, 'blocker', 'sub'));
    expect(await a.run('import.commit', { ...opts(a.men), skipInvalid: false })).toEqual({ ok: false, error: 'backup_failed' });
    expect(count(a.db, 'student')).toBe(0); expect(a.d.importJob.current).not.toBeNull(); // user can fix the folder and retry
  });
  it('refuses when no backup folder or key is configured', async () => {
    await load(CLEAN); a.setFolder(null);
    expect(await a.run('import.commit', { ...opts(a.men), skipInvalid: false })).toEqual({ ok: false, error: 'backup_not_configured' });
    expect(count(a.db, 'student')).toBe(0);
  });
  it('does not re-import people who already exist by number: the second run is blocked, nothing duplicated', async () => {
    await load(CLEAN); await a.run('import.commit', { ...opts(a.men), skipInvalid: false });
    await load(CLEAN);
    const r = (await a.run('import.commit', { ...opts(a.men), skipInvalid: false })) as { ok: boolean; error: string };
    expect(r).toMatchObject({ ok: false, error: 'has_issues' }); expect(count(a.db, 'student')).toBe(3);
  });
  it('imports nothing when every row is invalid, even with skipInvalid', async () => {
    await load([[1, '', '', 'رجال', '', '']]);
    expect(await a.run('import.commit', { ...opts(a.men), skipInvalid: true })).toEqual({ ok: false, error: 'nothing_to_import' });
  });
  it('writes an error file listing each bad row with the Arabic reason', async () => {
    await load([...CLEAN, [9, 'ناقص', '30/02/2015', 'الأطفال', '', '']]);
    expect(await a.run('import.saveErrors', opts(a.men))).toEqual({ ok: true, count: 1 });
    const f = a.state.saved[0]!; expect(f.kind).toBe('xlsx');
    const t = await readXlsx(f.data as Buffer); if (!t.ok) throw new Error('unreadable'); const last = t.table.headers.at(-1);
    expect(last).toBe('سبب الخطأ'); expect(String(t.table.rows[0]!.at(-1))).toContain('الفرع: فرع غير معروف');
    expect(String(t.table.rows[0]!.at(-1))).toContain('تاريخ الميلاد: تاريخ غير صحيح');
  });
  it('error file: reports no_errors for a clean file and cancelled when the user closes the save dialog', async () => {
    await load(CLEAN); expect(await a.run('import.saveErrors', opts(a.men))).toEqual({ ok: false, error: 'no_errors' });
    await load([...CLEAN, [9, '', '', 'رجال', '', '']]); a.state.saveOk = false; expect(await a.run('import.saveErrors', opts(a.men))).toEqual({ ok: false, error: 'cancelled' });
  });
});

describe('export (REQ-013 extension, BR-013)', () => {
  let a: ReturnType<typeof app>;
  beforeEach(async () => {
    a = app(); await a.as('dir');
    await a.run('students.create', { input: { givenName: 'أحمد', familyName: 'بن عمر', birthDate: '2015-03-10', phone: '0550 12 34 56', branchId: a.men, status: 'active', joinedOn: null, studentNo: '1' } });
    await a.run('students.create', { input: { givenName: 'فاطمة', familyName: 'بلقاسم <&>', birthDate: null, phone: null, branchId: a.women, status: 'suspended', joinedOn: '2026-09-01', studentNo: '2' } });
  });
  it('exports an xlsx with the association title and Arabic status labels, and audits it', async () => {
    expect(await a.run('export.students', { format: 'xlsx', filter: {} })).toEqual({ ok: true, count: 2, format: 'xlsx' });
    const f = a.state.saved[0]!; expect(f.name).toBe('الطلاب-2026-11-20.xlsx');
    const t = await readXlsx(f.data as Buffer); if (!t.ok) throw new Error('unreadable');
    expect(t.table.headers).toEqual(['رقم الطالب', 'الاسم', 'اللقب', 'تاريخ الميلاد', 'الهاتف', 'الفرع', 'الحالة', 'تاريخ الانضمام', 'الأرشيف', 'سبب الأرشفة']);
    expect(t.table.rows.map((r) => [r[1], r[5], r[6]])).toEqual([['أحمد', 'فرع الرجال', 'نشط'], ['فاطمة', 'فرع النساء', 'موقوف']]);
    expect(a.db.prepare("SELECT after_json j FROM audit_log WHERE action='export.students'").all()).toHaveLength(1);
  });
  it('exports well-formed XML with escaped content', async () => {
    await a.run('export.students', { format: 'xml', filter: { status: 'suspended' } });
    const x = a.state.saved[0]!.data as string;
    expect(x).toContain('<?xml version="1.0" encoding="UTF-8"?>'); expect(x).toContain('association="جمعية علماء المسلمين في سيدي عون"'); expect(x).toContain('count="1"');
    expect(x).toContain('<familyName>بلقاسم &lt;&amp;&gt;</familyName>'); expect(x).toContain('<status>suspended</status>'); expect(x).toContain('<statusLabel>موقوف</statusLabel>'); expect(x).not.toContain('أحمد');
  });
  it('respects the current filter and archive scope', async () => {
    expect(await a.run('export.students', { format: 'xlsx', filter: { search: 'فاطمة' } })).toMatchObject({ count: 1 });
    expect(await a.run('export.students', { format: 'xlsx', filter: { archived: 'archived' } })).toMatchObject({ count: 0 });
  });
  it('a branch registrar exports only their own branch; unauthorized users are refused', async () => {
    await a.as('regm'); await a.run('export.students', { format: 'xml', filter: {} });
    const x = a.state.saved.at(-1)!.data as string; expect(x).toContain('أحمد'); expect(x).not.toContain('فاطمة');
    await a.run('auth.logout', {}); await expect(a.run('export.students', { format: 'xlsx', filter: {} })).rejects.toMatchObject({ code: 'forbidden' });
    a.d.session.current = { userId: 'x', displayName: 'x', assignments: [] }; await expect(a.run('export.students', { format: 'xlsx', filter: {} })).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('cancelled save writes nothing and is not audited; bad formats are rejected at the schema', async () => {
    a.state.saveOk = false; expect(await a.run('export.students', { format: 'xlsx', filter: {} })).toEqual({ ok: false, error: 'cancelled' });
    expect(a.db.prepare("SELECT count(*) c FROM audit_log WHERE action='export.students'").get()).toEqual({ c: 0 });
    await expect(a.run('export.students', { format: 'pdf', filter: {} })).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(a.run('export.students', { format: 'xlsx', filter: { x: 1 } })).rejects.toMatchObject({ code: 'invalid_payload' });
  });
  it('exports more than one page of students', async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => [1000 + i, `طالب${i} اختبار`, '', 'رجال', '', '']);
    a.state.file = { name: 'big.xlsx', data: await sheet(rows) }; await a.run('import.pickFile', {}); await a.run('import.commit', { ...opts(a.men), skipInvalid: false });
    expect(await a.run('export.students', { format: 'xml', filter: {} })).toMatchObject({ ok: true, count: 1202 });
  }, 60000);
});
