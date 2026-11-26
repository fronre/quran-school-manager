import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, migrate, runSetup, generateRecoveryKey, createUser, assignRole, verifyAuditLog, type Protector } from '@mishkat/db';
import { createDispatcher, type Deps } from '../src/main/ipc';

const FAST = { memoryKiB: 8, passes: 1, parallelism: 1 };
const xor = (b: Buffer) => Buffer.from(b.map((x) => x ^ 0x5a));
const prot: Protector = { available: () => true, encrypt: xor, decrypt: xor };
const PW = 'a-long-test-password';

function app() {
  const db = openDb(':memory:'); migrate(db);
  const { tenantId } = runSetup(db, {
    admin: { givenName: 'علي', familyName: 'المدير', username: 'dir', password: PW }, association: { name: 'ج' },
    branches: [{ name: 'فرع الرجال' }, { name: 'فرع النساء' }], year: { name: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30' },
  }, generateRecoveryKey().key, { argon2: FAST });
  const [men, women] = (db.prepare('SELECT id FROM branch ORDER BY position').all() as { id: string }[]).map((b) => b.id) as [string, string];
  const mkUser = (username: string, role: 'registrar' | 'academic_supervisor' | 'branch_supervisor', branchId: string) => {
    const p = crypto.randomUUID(), s = crypto.randomUUID(); const now = '2026-09-01T08:00:00.000Z';
    db.prepare('INSERT INTO person(id,tenant_id,created_at,updated_at,created_by,updated_by,given_name,family_name) VALUES (?,?,?,?,?,?,?,?)').run(p, tenantId, now, now, 's', 's', username, 'موظف');
    db.prepare("INSERT INTO staff_member(id,tenant_id,created_at,updated_at,created_by,updated_by,person_id,kind) VALUES (?,?,?,?,?,?,?,'employee')").run(s, tenantId, now, now, 's', 's', p);
    const u = createUser(db, { tenantId, staffMemberId: s, username, password: PW, actor: { id: 's', role: 'system' } }, { argon2: FAST });
    if (!u.ok) throw new Error('setup'); assignRole(db, { tenantId, userId: u.userId, role, branchId, actor: { id: 's', role: 'system' } });
  };
  mkUser('regw', 'registrar', women); mkUser('acadm', 'academic_supervisor', men);
  const dir = mkdtempSync(join(tmpdir(), 'mishkat-stu-'));
  const d: Deps = { db, version: '0', session: { current: null }, authOptions: { argon2: FAST }, dataDir: dir, protector: prot, settings: { get: () => ({ backupFolder: null }), set: () => {} },
    pickFolder: async () => null, defaultBackupFolder: dir, wizard: { key: null, backupFolder: null }, pickOpenFile: async () => null, saveFile: async () => null, importJob: { current: null }, finance: { lastActive: null }, dbPath: '', restart: () => {}, pickImage: async () => null, processImage: () => null, tenantId: () => tenantId, now: () => '2026-11-20T09:00:00.000Z' };
  const run = createDispatcher(d);
  const as = async (u: string) => { await run('auth.logout', {}); const r = (await run('auth.login', { username: u, password: PW })) as { ok: boolean }; if (!r.ok) throw new Error('login'); };
  return { db, run, as, men, women, d };
}
const input = (branchId: string, over: Record<string, unknown> = {}) => ({ givenName: 'أحمد', familyName: 'بن عمر', birthDate: '2015-03-10', phone: null, branchId, status: 'active', joinedOn: null, studentNo: '0001', ...over });

describe('students IPC', () => {
  let a: ReturnType<typeof app>; beforeEach(() => { a = app(); });

  it('every students channel requires a signed-in user', async () => {
    for (const [c, p] of [['students.list', {}], ['students.get', { id: 'x' }], ['students.form', {}], ['students.create', { input: input(a.men) }], ['students.update', { id: 'x', expectedVersion: 1, input: input(a.men) }], ['students.archive', { id: 'x', reason: 'r' }], ['students.unarchive', { id: 'x' }]] as const)
      await expect(a.run(c, p), c).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('rejects malformed payloads at the schema (types, enums, extra keys, oversize)', async () => {
    await a.as('dir');
    for (const [c, p] of [
      ['students.list', { limit: 0 }], ['students.list', { limit: 'x' }], ['students.list', { status: 'deleted' }], ['students.list', { archived: 'maybe' }], ['students.list', { extra: 1 }],
      ['students.create', { input: { ...input(a.men), status: 'ghost' } }], ['students.create', { input: { ...input(a.men), role: 'director' } }], ['students.create', {}],
      ['students.update', { id: 'x', expectedVersion: 0, input: input(a.men) }], ['students.archive', { id: 'x' }],
    ] as const) await expect(a.run(c, p), c + JSON.stringify(p)).rejects.toMatchObject({ code: 'invalid_payload' });
  });
  it('the session view lists the permissions the user actually has', async () => {
    await a.as('dir'); const d = (await a.run('session.current', {})) as { user: { permissions: string[] } };
    expect(d.user.permissions).toContain('student.edit'); expect(d.user.permissions).toContain('backup.manage');
    await a.as('acadm'); const s = (await a.run('session.current', {})) as { user: { permissions: string[] } };
    expect(s.user.permissions).toContain('student.view'); expect(s.user.permissions).not.toContain('student.edit'); expect(s.user.permissions).not.toContain('backup.manage');
  });
  it('create, list, get, update, archive and restore as the director, end to end', async () => {
    await a.as('dir');
    const f = (await a.run('students.form', {})) as { nextNo: string; branches: { id: string }[]; canTransfer: boolean };
    expect(f.nextNo).toBe('0001'); expect(f.branches).toHaveLength(2); expect(f.canTransfer).toBe(true);
    const c = (await a.run('students.create', { input: input(a.men) })) as { ok: boolean; id: string };
    expect(c.ok).toBe(true);
    const l = (await a.run('students.list', { search: 'احمد' })) as { rows: { id: string; version: number }[]; total: number; counts: { active: number } };
    expect(l.total).toBe(1); expect(l.counts.active).toBe(1);
    const g = (await a.run('students.get', { id: c.id })) as { student: { version: number } };
    expect(await a.run('students.update', { id: c.id, expectedVersion: g.student.version, input: input(a.men, { phone: '0550 12 34 56' }) })).toEqual({ ok: true });
    expect(await a.run('students.update', { id: c.id, expectedVersion: g.student.version, input: input(a.men) })).toEqual({ ok: false, error: 'conflict' });
    expect(await a.run('students.archive', { id: c.id, reason: 'انتقل' })).toEqual({ ok: true });
    expect(((await a.run('students.list', {})) as { total: number }).total).toBe(0);
    expect(((await a.run('students.list', { archived: 'archived' })) as { total: number }).total).toBe(1);
    expect(await a.run('students.unarchive', { id: c.id })).toEqual({ ok: true });
    expect(verifyAuditLog(a.db)).toEqual({ ok: true });
  });
  it('branch scope holds through IPC: a women-branch registrar cannot see, edit or create in the men\'s branch', async () => {
    await a.as('dir');
    const m = (await a.run('students.create', { input: input(a.men) })) as { id: string };
    await a.as('regw');
    expect(((await a.run('students.list', {})) as { total: number }).total).toBe(0);
    expect(await a.run('students.get', { id: m.id })).toEqual({ student: null });
    expect(await a.run('students.create', { input: input(a.men, { studentNo: '0002', givenName: 'يوسف' }) })).toEqual({ ok: false, error: 'forbidden' });
    expect(await a.run('students.archive', { id: m.id, reason: 'x' })).toEqual({ ok: false, error: 'not_found' });
    const f = (await a.run('students.form', {})) as { branches: { id: string }[]; canTransfer: boolean };
    expect(f.branches.map((b) => b.id)).toEqual([a.women]); expect(f.canTransfer).toBe(false);
    expect(await a.run('students.create', { input: input(a.women, { studentNo: '0003', givenName: 'فاطمة' }) })).toMatchObject({ ok: true });
  });
  it('a read-only academic supervisor can list but not create', async () => {
    await a.as('dir'); await a.run('students.create', { input: input(a.men) });
    await a.as('acadm');
    expect(((await a.run('students.list', {})) as { total: number }).total).toBe(1);
    expect(await a.run('students.create', { input: input(a.men, { studentNo: '0005', givenName: 'ب' }) })).toEqual({ ok: false, error: 'forbidden' });
    expect(((await a.run('students.form', {})) as { branches: unknown[] }).branches).toEqual([]);
  });
  it('a duplicate warning is returned to the UI and can be acknowledged', async () => {
    await a.as('dir'); await a.run('students.create', { input: input(a.men) });
    const again = input(a.men, { studentNo: '0002', givenName: 'أَحْمَد' });
    const r = (await a.run('students.create', { input: again })) as { ok: boolean; error: string; duplicates: unknown[] };
    expect(r).toMatchObject({ ok: false, error: 'duplicates' }); expect(r.duplicates).toHaveLength(1);
    expect(await a.run('students.create', { input: again, ignoreDuplicates: true })).toMatchObject({ ok: true });
  });
  it('returns validation issues for bad data', async () => {
    await a.as('dir');
    const r = (await a.run('students.create', { input: input(a.men, { givenName: '', phone: 'abc' }) })) as { error: string; issues: { field: string }[] };
    expect(r.error).toBe('invalid'); expect(r.issues.map((i) => i.field)).toEqual(['givenName', 'phone']);
  });
});
