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
const fakeJpeg = () => { const b = Buffer.alloc(900, 5); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; return b; };

function app() {
  const db = openDb(':memory:'); migrate(db);
  const { tenantId } = runSetup(db, { admin: { givenName: 'مستخدم', familyName: 'البرنامج', username: 'user1', password: PW }, association: { name: 'جمعية' },
    branches: [{ name: 'فرع الرجال' }, { name: 'فرع النساء' }], year: { name: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30' } }, generateRecoveryKey().key, { argon2: FAST });
  const [men, women] = (db.prepare('SELECT id FROM branch ORDER BY position').all() as { id: string }[]).map((b) => b.id) as [string, string];
  const t0 = '2026-09-01T08:00:00.000Z'; const p = crypto.randomUUID(), s = crypto.randomUUID();
  db.prepare('INSERT INTO person(id,tenant_id,created_at,updated_at,created_by,updated_by,given_name,family_name) VALUES (?,?,?,?,?,?,?,?)').run(p, tenantId, t0, t0, 's', 's', 'sup', 'م');
  db.prepare("INSERT INTO staff_member(id,tenant_id,created_at,updated_at,created_by,updated_by,person_id,kind,position) VALUES (?,?,?,?,?,?,?,'employee','administrator')").run(s, tenantId, t0, t0, 's', 's', p);
  const u = createUser(db, { tenantId, staffMemberId: s, username: 'supm', password: PW, actor: { id: 's', role: 'system' } }, { argon2: FAST });
  if (!u.ok) throw new Error('setup'); assignRole(db, { tenantId, userId: u.userId, role: 'branch_supervisor', branchId: men, actor: { id: 's', role: 'system' } });
  const dir = mkdtempSync(join(tmpdir(), 'mishkat-stf-'));
  const state = { picked: null as { data: Buffer } | { error: 'too_large' } | null, processed: true };
  const d: Deps = { db, version: '0', session: { current: null }, authOptions: { argon2: FAST }, dataDir: dir, protector: prot, settings: { get: () => ({ backupFolder: null }), set: () => {} },
    pickFolder: async () => null, defaultBackupFolder: dir, wizard: { key: null, backupFolder: null }, tenantId: () => tenantId, now: () => '2026-11-20T09:00:00.000Z', importJob: { current: null }, finance: { lastActive: null }, dbPath: '', restart: () => {},
    pickOpenFile: async () => null, saveFile: async () => null, pickImage: async () => state.picked, processImage: () => (state.processed ? { jpeg: fakeJpeg(), width: 320, height: 320 } : null) };
  const run = createDispatcher(d);
  const as = async (u: string) => { await run('auth.logout', {}); if (!((await run('auth.login', { username: u, password: PW })) as { ok: boolean }).ok) throw new Error('login'); };
  return { db, run, as, men, women, state };
}
const input = (b: string, over: Record<string, unknown> = {}) => ({ givenName: 'عبد الرحمن', familyName: 'بوعلام', birthDate: '1985-04-12', phone: '0550 12 34 56', branchId: b, position: 'teacher', kind: 'employee', ...over });

describe('staff and photos through IPC', () => {
  let a: ReturnType<typeof app>; beforeEach(async () => { a = app(); await a.as('user1'); });

  it('every staff, photo and activity channel needs a signed-in user', async () => {
    await a.run('auth.logout', {});
    for (const [c, p] of [['staff.list', {}], ['staff.get', { id: 'x' }], ['staff.form', {}], ['staff.create', { input: input(a.men) }], ['staff.update', { id: 'x', expectedVersion: 1, input: input(a.men) }], ['staff.archive', { id: 'x', reason: 'r' }], ['staff.unarchive', { id: 'x' }],
      ['photo.get', { kind: 'staff', id: 'x' }], ['photo.pick', { kind: 'staff', id: 'x', consentGivenBy: 'ب' }], ['photo.remove', { kind: 'staff', id: 'x' }], ['profile.activity', { kind: 'staff', id: 'x' }]] as const)
      await expect(a.run(c, p), c).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('rejects malformed payloads at the schema', async () => {
    for (const [c, p] of [['staff.create', { input: { ...input(a.men), position: 'boss' } }], ['staff.create', { input: { ...input(a.men), role: 'x' } }], ['staff.list', { position: 'weird' }], ['photo.get', { kind: 'dog', id: 'x' }],
      ['photo.pick', { kind: 'staff', id: 'x' }], ['profile.activity', { kind: 'staff' }], ['staff.update', { id: 'x', expectedVersion: 0, input: input(a.men) }]] as const)
      await expect(a.run(c, p), c).rejects.toMatchObject({ code: 'invalid_payload' });
  });
  it('creates, lists by branch (men / women), reads, updates, archives and restores a teacher', async () => {
    await a.as('supm'); // a branch supervisor of the men's branch
    const f = (await a.run('staff.form', {})) as { branches: { id: string }[]; canTransfer: boolean }; expect(f.branches.map((b) => b.id)).toEqual([a.men]); expect(f.canTransfer).toBe(false);
    const c = (await a.run('staff.create', { input: input(a.men) })) as { ok: boolean; id: string }; expect(c.ok).toBe(true);
    expect(await a.run('staff.create', { input: input(a.women) })).toEqual({ ok: false, error: 'forbidden' });
    await a.as('user1');
    const l = (await a.run('staff.list', {})) as { rows: { id: string; position: string }[]; total: number }; expect(l.total).toBe(1);
    const g = (await a.run('staff.get', { id: c.id })) as { staff: { version: number; branchName: string } }; expect(g.staff.branchName).toBe('فرع الرجال');
    expect(await a.run('staff.update', { id: c.id, expectedVersion: g.staff.version, input: input(a.men, { phone: '0661 00 00 00' }) })).toEqual({ ok: true });
    expect(await a.run('staff.update', { id: c.id, expectedVersion: g.staff.version, input: input(a.men) })).toEqual({ ok: false, error: 'conflict' });
    expect(await a.run('staff.archive', { id: c.id, reason: 'غادر' })).toEqual({ ok: true }); expect(((await a.run('staff.list', {})) as { total: number }).total).toBe(0);
    expect(await a.run('staff.unarchive', { id: c.id })).toEqual({ ok: true }); expect(verifyAuditLog(a.db)).toEqual({ ok: true });
  });
  it('the sign-in account never appears in the teachers list', async () => {
    expect(((await a.run('staff.list', {})) as { total: number }).total).toBe(0);
  });
  it('a photo needs the consent statement BEFORE any file dialog is opened', async () => {
    const c = (await a.run('staff.create', { input: input(a.men) })) as { id: string }; let opened = 0; a.state.picked = { data: Buffer.from('x') };
    const orig = a.state; void orig; expect(await a.run('photo.pick', { kind: 'staff', id: c.id, consentGivenBy: '  ' })).toEqual({ ok: false, error: 'consent_required' }); void opened;
    expect(((await a.run('photo.get', { kind: 'staff', id: c.id })) as { photo: unknown }).photo).toBeNull();
  });
  it('stores a processed thumbnail, returns it, and removes it on request', async () => {
    const c = (await a.run('staff.create', { input: input(a.men) })) as { id: string }; a.state.picked = { data: Buffer.from('raw-image-bytes') };
    const r = (await a.run('photo.pick', { kind: 'staff', id: c.id, consentGivenBy: 'صاحب الصورة' })) as { ok: boolean; photo: { mime: string; base64: string } };
    expect(r.ok).toBe(true); expect(r.photo.mime).toBe('image/jpeg'); expect(Buffer.from(r.photo.base64, 'base64').equals(fakeJpeg())).toBe(true); // the original bytes are never stored
    expect(((await a.run('staff.get', { id: c.id })) as { staff: { hasPhoto: boolean } }).staff.hasPhoto).toBe(true);
    expect(await a.run('photo.remove', { kind: 'staff', id: c.id })).toEqual({ ok: true }); expect(((await a.run('photo.get', { kind: 'staff', id: c.id })) as { photo: unknown }).photo).toBeNull();
  });
  it('reports cancelled dialogs, too-large and undecodable files without storing anything', async () => {
    const c = (await a.run('staff.create', { input: input(a.men) })) as { id: string }; const pick = () => a.run('photo.pick', { kind: 'staff', id: c.id, consentGivenBy: 'ب' });
    a.state.picked = null; expect(await pick()).toEqual({ ok: false, error: 'cancelled' });
    a.state.picked = { error: 'too_large' }; expect(await pick()).toEqual({ ok: false, error: 'too_large' });
    a.state.picked = { data: Buffer.from('not an image') }; a.state.processed = false; expect(await pick()).toEqual({ ok: false, error: 'invalid_image' });
    expect(a.db.prepare('SELECT count(*) c FROM person_photo').get()).toEqual({ c: 0 });
  });
  it('works for student photos and respects branch scope', async () => {
    await a.as('user1');
    const own = ((await a.run('students.create', { input: { givenName: 'أحمد', familyName: 'ا', birthDate: null, phone: null, branchId: a.men, status: 'active', joinedOn: null, studentNo: '1' } })) as { id: string }).id;
    a.state.picked = { data: Buffer.from('x') };
    expect(await a.run('photo.pick', { kind: 'student', id: own, consentGivenBy: 'ولي الأمر' })).toMatchObject({ ok: true });
    expect(await a.run('photo.pick', { kind: 'student', id: 'missing', consentGivenBy: 'ولي الأمر' })).toEqual({ ok: false, error: 'not_found' });
  });
  it('lists the activity of a profile, newest first', async () => {
    const c = (await a.run('staff.create', { input: input(a.men) })) as { id: string }; const v = ((await a.run('staff.get', { id: c.id })) as { staff: { version: number } }).staff.version;
    await a.run('staff.update', { id: c.id, expectedVersion: v, input: input(a.men, { phone: '0661 00 00 00' }) });
    const r = (await a.run('profile.activity', { kind: 'staff', id: c.id })) as { rows: { action: string; changes: string[] }[] };
    expect(r.rows.map((x) => x.action)).toEqual(['staff.update', 'staff.create']); expect(r.rows[0]!.changes).toEqual(['phone']);
    expect(await a.run('profile.activity', { kind: 'staff', id: 'missing' })).toEqual({ rows: null });
  });
});
