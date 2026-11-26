import { describe, it, expect, beforeEach } from 'vitest';
import type { Assignment, StaffInput } from '@mishkat/domain';
import {
  openDb, migrate, newId, verifyAuditLog, runSetup, generateRecoveryKey, createStudent,
  createStaff, updateStaff, archiveStaff, unarchiveStaff, getStaff, listStaff, setPhoto, getPhoto, removePhoto, profileActivity,
  createBackup, restoreBackup, type Ctx,
} from '../src';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NOW = '2026-11-20T09:00:00.000Z';
const FAST = { memoryKiB: 8, passes: 1, parallelism: 1 };
const jpeg = (n = 600, seed = 7) => { const b = Buffer.alloc(n, seed); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; return b; };

function world() {
  const db = openDb(':memory:'); migrate(db);
  const key = generateRecoveryKey().key;
  const { tenantId } = runSetup(db, { admin: { givenName: 'مستخدم', familyName: 'البرنامج', username: 'user1', password: 'a-long-test-password' }, association: { name: 'جمعية' },
    branches: [{ name: 'فرع الرجال' }, { name: 'فرع النساء' }], year: { name: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30' } }, key, { argon2: FAST });
  const [men, women] = (db.prepare('SELECT id FROM branch ORDER BY position').all() as { id: string }[]).map((b) => b.id) as [string, string];
  const ctx = (a: Assignment[]): Ctx => ({ db, tenantId, actorId: 'u1', assignments: a, now: () => NOW });
  return { db, tenantId, key, men, women, director: ctx([{ role: 'director', branchId: null }]), supMen: ctx([{ role: 'branch_supervisor', branchId: men }]), acadMen: ctx([{ role: 'academic_supervisor', branchId: men }]), regMen: ctx([{ role: 'registrar', branchId: men }]), ctx };
}
const si = (b: string, over: Partial<StaffInput> = {}): StaffInput => ({ givenName: 'عبد الرحمن', familyName: 'بوعلام', birthDate: '1985-04-12', phone: '0550 12 34 56', branchId: b, position: 'teacher', kind: 'employee', ...over });
const ok = <R extends { ok: boolean }>(r: R): Extract<R, { ok: true }> => { if (!r.ok) throw new Error('expected ok: ' + JSON.stringify(r)); return r as Extract<R, { ok: true }>; };

describe('migration 005 and the sign-in account', () => {
  it('keeps the person who signs in out of the teachers list', () => {
    const w = world(); expect(listStaff(w.director).total).toBe(0);
    expect(listStaff(w.director, { position: 'administrator' }).total).toBe(1); expect(listStaff(w.director, { position: 'all' }).total).toBe(1);
  });
});

describe('teachers: create, list, scope', () => {
  let w: ReturnType<typeof world>; beforeEach(() => { w = world(); });
  it('creates a teacher with person + staff rows, trimmed data and an audit entry', () => {
    const { id } = ok(createStaff(w.supMen, si(w.men, { givenName: '  عبد الرحمن ', phone: '  ' })));
    expect(getStaff(w.supMen, id)).toMatchObject({ givenName: 'عبد الرحمن', phone: null, branchName: 'فرع الرجال', position: 'teacher', kind: 'employee', hasPhoto: false, archivedAt: null, version: 1 });
    expect(w.db.prepare("SELECT action, branch_id b FROM audit_log WHERE action='staff.create'").get()).toEqual({ action: 'staff.create', b: w.men }); expect(verifyAuditLog(w.db)).toEqual({ ok: true });
  });
  it('rejects invalid data with issue codes and writes nothing', () => {
    const r = createStaff(w.director, si(w.men, { givenName: '', phone: 'abc', birthDate: '2099-01-01', position: 'boss' as never }));
    expect(r).toMatchObject({ ok: false, error: 'invalid' }); expect((r as { issues: { field: string }[] }).issues.map((i) => i.field).sort()).toEqual(['birthDate', 'givenName', 'phone', 'position']);
    expect(w.db.prepare("SELECT count(*) c FROM staff_member WHERE position <> 'administrator'").get()).toEqual({ c: 0 });
  });
  it('enforces branch authorization by role', () => {
    expect(createStaff(w.supMen, si(w.women))).toEqual({ ok: false, error: 'forbidden' });
    expect(createStaff(w.acadMen, si(w.men))).toEqual({ ok: false, error: 'forbidden' }); expect(createStaff(w.regMen, si(w.men))).toEqual({ ok: false, error: 'forbidden' });
    expect(createStaff(w.director, si('nope'))).toEqual({ ok: false, error: 'branch_not_found' }); expect(createStaff(w.director, si(w.women)).ok).toBe(true);
  });
  it('lists by scope: men and women separately, a supervisor sees only their branch, a registrar none', () => {
    ok(createStaff(w.director, si(w.men, { givenName: 'أحمد' }))); ok(createStaff(w.director, si(w.men, { givenName: 'يوسف' }))); ok(createStaff(w.director, si(w.women, { givenName: 'فاطمة' })));
    expect(listStaff(w.director).total).toBe(3); expect(listStaff(w.director, { branchId: w.women }).rows.map((r) => r.givenName)).toEqual(['فاطمة']);
    expect(listStaff(w.supMen).total).toBe(2); expect(listStaff(w.supMen, { branchId: w.women })).toEqual({ rows: [], total: 0 }); expect(listStaff(w.acadMen).total).toBe(2); expect(listStaff(w.regMen).total).toBe(0);
  });
  it('searches Arabic names regardless of diacritics and hamza, and filters by position and archive state', () => {
    ok(createStaff(w.director, si(w.men, { givenName: 'أَحْمَد', position: 'teacher' }))); ok(createStaff(w.director, si(w.men, { givenName: 'بلال', position: 'supervisor' })));
    expect(listStaff(w.director, { search: 'احمد' }).total).toBe(1); expect(listStaff(w.director, { position: 'supervisor' }).rows[0]!.givenName).toBe('بلال');
    const id = listStaff(w.director, { search: 'بلال' }).rows[0]!.id; ok(archiveStaff(w.director, id, 'غادر'));
    expect(listStaff(w.director).total).toBe(1); expect(listStaff(w.director, { archived: 'archived' }).total).toBe(1); expect(listStaff(w.director, { search: '%' }).total).toBe(0);
  });
  it('records outside the caller scope look like they do not exist', () => {
    const id = ok(createStaff(w.director, si(w.women))).id; expect(getStaff(w.supMen, id)).toBeNull(); expect(updateStaff(w.supMen, id, 1, si(w.women))).toEqual({ ok: false, error: 'not_found' });
    expect(archiveStaff(w.supMen, id, 'x')).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('teachers: update and archive', () => {
  let w: ReturnType<typeof world>; let id: string; let v: number;
  beforeEach(() => { w = world(); id = ok(createStaff(w.supMen, si(w.men))).id; v = getStaff(w.supMen, id)!.version; });
  it('updates, bumps the version and audits before/after', () => {
    ok(updateStaff(w.supMen, id, v, si(w.men, { givenName: 'عمر', position: 'supervisor', kind: 'volunteer' })));
    expect(getStaff(w.supMen, id)).toMatchObject({ givenName: 'عمر', position: 'supervisor', kind: 'volunteer', version: v + 1 }); expect(w.db.prepare('SELECT search_key k FROM person ORDER BY created_at DESC LIMIT 1').get()).toBeTruthy();
    expect(JSON.parse((w.db.prepare("SELECT before_json b FROM audit_log WHERE action='staff.update'").get() as { b: string }).b).givenName).toBe('عبد الرحمن');
  });
  it('detects a concurrent edit; read-only roles cannot edit', () => {
    ok(updateStaff(w.supMen, id, v, si(w.men, { phone: '0661 00 00 00' }))); expect(updateStaff(w.supMen, id, v, si(w.men))).toEqual({ ok: false, error: 'conflict' });
    expect(updateStaff(w.acadMen, id, v + 1, si(w.men))).toEqual({ ok: false, error: 'forbidden' });
  });
  it('moving a teacher to the other branch is the Director only', () => {
    expect(updateStaff(w.supMen, id, v, si(w.women))).toEqual({ ok: false, error: 'forbidden' }); ok(updateStaff(w.director, id, v, si(w.women))); expect(getStaff(w.director, id)!.branchName).toBe('فرع النساء');
  });
  it('archives with a reason, blocks edits while archived, and restores', () => {
    expect(archiveStaff(w.supMen, id, ' ')).toEqual({ ok: false, error: 'reason_required' }); ok(archiveStaff(w.supMen, id, 'انتهى العقد')); expect(archiveStaff(w.supMen, id, 'x')).toEqual({ ok: false, error: 'already_archived' });
    expect(updateStaff(w.supMen, id, getStaff(w.supMen, id)!.version, si(w.men))).toEqual({ ok: false, error: 'archived' });
    expect(unarchiveStaff(w.supMen, id)).toEqual({ ok: true }); expect(getStaff(w.supMen, id)).toMatchObject({ archivedAt: null, archiveReason: null }); expect(unarchiveStaff(w.supMen, id)).toEqual({ ok: false, error: 'not_archived' });
    expect(verifyAuditLog(w.db)).toEqual({ ok: true });
  });
});

describe('photos with consent (BR-022)', () => {
  let w: ReturnType<typeof world>; let teacher: string; let student: string;
  beforeEach(() => { w = world(); teacher = ok(createStaff(w.director, si(w.men))).id; student = ok(createStudent(w.director, { givenName: 'أحمد', familyName: 'اختبار', birthDate: null, phone: null, branchId: w.men, status: 'active', joinedOn: null, studentNo: '1' })).id; });
  const put = (c: Ctx, kind: 'student' | 'staff', id: string, over: Record<string, unknown> = {}) => setPhoto(c, { kind, id, jpeg: jpeg(), width: 320, height: 320, consentGivenBy: 'ولي الأمر', ...over } as never);

  it('stores a photo for a teacher and a student, returns the same bytes, and records the consent', () => {
    ok(put(w.director, 'staff', teacher)); ok(put(w.director, 'student', student));
    const p = getPhoto(w.director, 'staff', teacher)!; expect(p.mime).toBe('image/jpeg'); expect(Buffer.from(p.base64, 'base64').equals(jpeg())).toBe(true); expect(getStaff(w.director, teacher)!.hasPhoto).toBe(true);
    expect(w.db.prepare("SELECT purpose, given_by g, withdrawn_at w FROM consent_record ORDER BY granted_at").all()).toEqual([{ purpose: 'photo', g: 'ولي الأمر', w: null }, { purpose: 'photo', g: 'ولي الأمر', w: null }]);
    expect(w.db.prepare("SELECT count(*) c FROM audit_log WHERE action='photo.set'").get()).toEqual({ c: 2 });
  });
  it('refuses without a consent statement, and does not leak image content into the audit log', () => {
    for (const bad of [null, '', '   ']) expect(put(w.director, 'staff', teacher, { consentGivenBy: bad })).toEqual({ ok: false, error: 'consent_required' });
    expect(w.db.prepare('SELECT count(*) c FROM person_photo').get()).toEqual({ c: 0 });
    ok(put(w.director, 'staff', teacher)); expect(JSON.stringify(w.db.prepare("SELECT after_json FROM audit_log WHERE action='photo.set'").all())).not.toContain('/9j/');
  });
  it('rejects non-JPEG, oversized and tiny images', () => {
    for (const j of [Buffer.from('GIF89a'.padEnd(300, 'x')), Buffer.alloc(300, 1), jpeg(50)]) expect(put(w.director, 'staff', teacher, { jpeg: j })).toEqual({ ok: false, error: 'invalid_image' });
    expect(put(w.director, 'staff', teacher, { jpeg: jpeg(1024 * 1024 + 1) })).toEqual({ ok: false, error: 'invalid_image' });
    expect(put(w.director, 'staff', teacher, { width: 8, height: 8 })).toEqual({ ok: false, error: 'invalid_image' }); expect(put(w.director, 'staff', teacher, { width: 5000 })).toEqual({ ok: false, error: 'invalid_image' });
  });
  it('replacing a photo ends the previous consent record and keeps exactly one photo', () => {
    ok(put(w.director, 'student', student)); ok(put(w.director, 'student', student, { jpeg: jpeg(700, 9), consentGivenBy: 'الأب' }));
    expect(w.db.prepare('SELECT count(*) c FROM person_photo').get()).toEqual({ c: 1 });
    expect(w.db.prepare('SELECT given_by g, withdrawn_at IS NOT NULL AS w FROM consent_record ORDER BY rowid').all()).toEqual([{ g: 'ولي الأمر', w: 1 }, { g: 'الأب', w: 0 }]);
    expect(Buffer.from(getPhoto(w.director, 'student', student)!.base64, 'base64').equals(jpeg(700, 9))).toBe(true);
  });
  it('removing a photo deletes the image and withdraws the consent, keeping the history of having consented', () => {
    ok(put(w.director, 'staff', teacher)); expect(removePhoto(w.director, 'staff', teacher)).toEqual({ ok: true }); expect(getPhoto(w.director, 'staff', teacher)).toBeNull();
    expect(w.db.prepare('SELECT count(*) c FROM person_photo').get()).toEqual({ c: 0 }); expect(w.db.prepare('SELECT withdrawn_at IS NOT NULL AS w FROM consent_record').get()).toEqual({ w: 1 });
    expect(removePhoto(w.director, 'staff', teacher)).toEqual({ ok: false, error: 'not_found' });
  });
  it('respects scope and roles: other branches do not exist, view-only cannot change', () => {
    ok(put(w.director, 'staff', teacher));
    expect(getPhoto(w.acadMen, 'staff', teacher)).not.toBeNull(); expect(put(w.acadMen, 'staff', teacher)).toEqual({ ok: false, error: 'forbidden' });
    const other = ok(createStaff(w.director, si(w.women))).id; ok(put(w.director, 'staff', other));
    expect(getPhoto(w.supMen, 'staff', other)).toBeNull(); expect(put(w.supMen, 'staff', other)).toEqual({ ok: false, error: 'not_found' }); expect(removePhoto(w.supMen, 'staff', other)).toEqual({ ok: false, error: 'not_found' });
    expect(put(w.director, 'staff', 'missing')).toEqual({ ok: false, error: 'not_found' });
    ok(put(w.director, 'student', student)); expect(getPhoto(w.regMen, 'staff', teacher)).toBeNull(); expect(getPhoto(w.regMen, 'student', student)).not.toBeNull();
  });
  it('the database itself refuses a photo without a consent record, and consent records are append-only', () => {
    const pid = (w.db.prepare('SELECT person_id p FROM staff_member WHERE id = ?').get(teacher) as { p: string }).p;
    expect(() => w.db.prepare('INSERT INTO person_photo(person_id,tenant_id,mime,width,height,bytes,sha256,consent_id,updated_at,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?)').run(pid, w.tenantId, 'image/jpeg', 320, 320, jpeg(), 'a'.repeat(64), newId(), NOW, 'u')).toThrow(/FOREIGN KEY/);
    ok(put(w.director, 'staff', teacher));
    expect(() => w.db.prepare("UPDATE consent_record SET given_by='x'").run()).toThrow(/only a first withdrawal/); expect(() => w.db.prepare('DELETE FROM consent_record').run()).toThrow(/append-only/);
  });
  it('photos travel with an encrypted backup and come back after a restore', async () => {
    ok(put(w.director, 'staff', teacher)); const dir = mkdtempSync(join(tmpdir(), 'mishkat-ph-')); const path = join(dir, 'live.db');
    const file = openDb(path); migrate(file); const k = generateRecoveryKey().key;
    runSetup(file, { admin: { givenName: 'م', familyName: 'ب', username: 'user1', password: 'a-long-test-password' }, association: { name: 'ج' }, branches: [{ name: 'ف' }], year: { name: 'y', startDate: '2026-09-01', endDate: '2027-06-30' } }, k, { argon2: FAST });
    const t2 = (file.prepare('SELECT id FROM association').get() as { id: string }).id; const br = (file.prepare('SELECT id FROM branch').get() as { id: string }).id;
    const c2: Ctx = { db: file, tenantId: t2, actorId: 'u', assignments: [{ role: 'director', branchId: null }], now: () => NOW };
    const tid = ok(createStaff(c2, si(br))).id; ok(setPhoto(c2, { kind: 'staff', id: tid, jpeg: jpeg(800, 3), width: 320, height: 320, consentGivenBy: 'صاحب الصورة' }));
    const bk = join(dir, 'b.mshkbk'); expect((await createBackup(file, { tenantId: t2, destFile: bk, key: { kind: 'recovery', key: k }, kind: 'manual', actorId: 'u' })).ok).toBe(true);
    ok(removePhoto(c2, 'staff', tid)); expect(getPhoto(c2, 'staff', tid)).toBeNull();
    const r = await restoreBackup({ db: file, dbPath: path, backupFile: bk, key: { kind: 'recovery', key: k }, tenantId: t2, preRestoreDir: join(dir, 'pre'), actorId: 'u' }); if (!r.ok) throw new Error(r.error);
    expect(Buffer.from(getPhoto({ ...c2, db: r.db }, 'staff', tid)!.base64, 'base64').equals(jpeg(800, 3))).toBe(true); r.db.close();
  });
});

describe('profile activity', () => {
  it('lists what happened to a record, newest first, naming the changed fields and the reasons', () => {
    const w = world(); const id = ok(createStaff(w.director, si(w.men))).id; const v = getStaff(w.director, id)!.version;
    ok(updateStaff(w.director, id, v, si(w.men, { phone: '0661 00 00 00', position: 'supervisor' }))); ok(archiveStaff(w.director, id, 'غادر')); ok(setPhoto(w.director, { kind: 'staff', id, jpeg: jpeg(), width: 320, height: 320, consentGivenBy: 'صاحب الصورة' }) as never);
    const a = profileActivity(w.director, 'staff', id)!;
    expect(a.map((r) => r.action)).toEqual(['photo.set', 'staff.archive', 'staff.update', 'staff.create']);
    expect(a[2]!.changes.sort()).toEqual(['phone', 'position']); expect(a[1]!.reason).toBe('غادر');
  });
  it('shows the history of a student and is hidden from people who cannot see the record', () => {
    const w = world(); const sid = ok(createStudent(w.director, { givenName: 'أحمد', familyName: 'ا', birthDate: null, phone: null, branchId: w.women, status: 'active', joinedOn: null, studentNo: '5' })).id;
    expect(profileActivity(w.director, 'student', sid)!.map((r) => r.action)).toEqual(['student.create']); expect(profileActivity(w.supMen, 'student', sid)).toBeNull(); expect(profileActivity(w.director, 'student', 'missing')).toBeNull();
  });
});
