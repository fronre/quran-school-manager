import { describe, it, expect } from 'vitest';
import type { Assignment } from '@mishkat/domain';
import { openDb, migrate, verifyAuditLog, runSetup, generateRecoveryKey, createStudent, createGroup, enrollStudent, getMemoSettings, saveMemoSettings, scaleList, recordMemorization, studentProgress, readLogo, saveLogo, type Ctx } from '../src';

const FAST = { memoryKiB: 8, passes: 1, parallelism: 1 };
const ok = <R extends { ok: boolean }>(r: R): Extract<R, { ok: true }> => { if (!r.ok) throw new Error('expected ok: ' + JSON.stringify(r)); return r as Extract<R, { ok: true }>; };
const L = (over: Record<number, string> = {}) => ({ 5: 'ممتاز', 4: 'جيد جداً', 3: 'جيد', 2: 'مقبول', 1: 'ضعيف', ...over });

function world() {
  const db = openDb(':memory:'); migrate(db);
  const { tenantId } = runSetup(db, { admin: { givenName: 'مستخدم', familyName: 'البرنامج', username: 'user1', password: 'a-long-test-password' }, association: { name: 'جمعية' },
    branches: [{ name: 'فرع الرجال' }], year: { name: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30' } }, generateRecoveryKey().key, { argon2: FAST });
  const [men] = (db.prepare('SELECT id FROM branch').all() as { id: string }[]).map((b) => b.id) as [string];
  const ctx = (a: Assignment[]): Ctx => ({ db, tenantId, actorId: 'u1', assignments: a, now: () => '2026-11-20T09:00:00.000Z' });
  const director = ctx([{ role: 'director', branchId: null }]);
  const s = ok(createStudent(director, { givenName: 'ط', familyName: 'ا', birthDate: null, phone: null, branchId: men, status: 'active', joinedOn: null, studentNo: '1' })).id;
  const g = ok(createGroup(director, { branchId: men, name: 'ف', level: null, capacity: 5 })).id; ok(enrollStudent(director, g, s));
  return { db, director, s, acad: ctx([{ role: 'academic_supervisor', branchId: men }]), sup: ctx([{ role: 'branch_supervisor', branchId: men }]) };
}
const rec = (w: ReturnType<typeof world>, rank: number, from: number, to: number) => recordMemorization(w.director, { studentId: w.s, date: '2026-11-20', type: 'new', range: { start: { surah: 2, ayah: from }, end: { surah: 2, ayah: to } }, evalRank: rank });

describe('memorization scale and pass mark settings', () => {
  it('starts with the built-in scale (version 1) and everyone can read it', () => { const w = world(); const s = getMemoSettings(w.acad); expect(s).toMatchObject({ passRank: 2, version: 1 }); expect(scaleList(s).map((x) => x.label)).toEqual(['ممتاز', 'جيد جداً', 'جيد', 'مقبول', 'يحتاج مراجعة']); });
  it('saves new labels and pass mark, versions the change, and audits it', () => {
    const w = world(); ok(saveMemoSettings(w.director, { passRank: 3, labels: L(), expectedVersion: 1 })); const s = getMemoSettings(w.sup);
    expect(s).toMatchObject({ passRank: 3, version: 2 }); expect(s.labels[1]).toBe('ضعيف'); expect(saveMemoSettings(w.director, { passRank: 3, labels: L(), expectedVersion: 2 })).toEqual({ ok: true }); expect(getMemoSettings(w.sup).version).toBe(2); // no change, no new version
    expect(w.db.prepare("SELECT count(*) c FROM audit_log WHERE action = 'settings.memo_scale'").get()).toEqual({ c: 1 }); expect(verifyAuditLog(w.db)).toEqual({ ok: true });
  });
  it('validates labels and the pass mark, detects stale edits, and needs the right to manage settings', () => {
    const w = world();
    expect(saveMemoSettings(w.director, { passRank: 0, labels: L(), expectedVersion: 1 })).toEqual({ ok: false, error: 'invalid' }); expect(saveMemoSettings(w.director, { passRank: 6, labels: L(), expectedVersion: 1 })).toEqual({ ok: false, error: 'invalid' });
    expect(saveMemoSettings(w.director, { passRank: 2, labels: L({ 3: ' ' }), expectedVersion: 1 })).toEqual({ ok: false, error: 'invalid' }); expect(saveMemoSettings(w.director, { passRank: 2, labels: L({ 3: 'ا'.repeat(31) }), expectedVersion: 1 })).toEqual({ ok: false, error: 'invalid' });
    expect(saveMemoSettings(w.director, { passRank: 2, labels: L({ 1: 'جيد' }), expectedVersion: 1 })).toEqual({ ok: false, error: 'duplicate_labels' }); expect(saveMemoSettings(w.director, { passRank: 2, labels: L(), expectedVersion: 7 })).toEqual({ ok: false, error: 'conflict' });
    expect(saveMemoSettings(w.sup, { passRank: 2, labels: L(), expectedVersion: 1 })).toEqual({ ok: false, error: 'forbidden' }); expect(getMemoSettings(w.director).version).toBe(1);
  });
  it('new records use the new label and scale version; old records keep what they were entered with (BR-036)', () => {
    const w = world(); ok(rec(w, 2, 1, 10)); ok(saveMemoSettings(w.director, { passRank: 2, labels: L({ 2: 'كافٍ' }), expectedVersion: 1 })); ok(rec(w, 2, 11, 20));
    expect(w.db.prepare('SELECT eval_label l, scale_version v FROM memorization_record ORDER BY start_ordinal').all()).toEqual([{ l: 'مقبول', v: 1 }, { l: 'كافٍ', v: 2 }]); expect(studentProgress(w.director, w.s)!.summary.scale.map((x) => x.label)).toEqual(['ممتاز', 'جيد جداً', 'جيد', 'كافٍ', 'ضعيف']);
  });
  it('the pass mark decides what counts as memorized from then on', () => {
    const w = world(); ok(rec(w, 2, 1, 10)); ok(rec(w, 4, 11, 20)); expect(studentProgress(w.director, w.s)!.summary.memorizedAyat).toBe(20);
    ok(saveMemoSettings(w.director, { passRank: 4, labels: L(), expectedVersion: 1 })); expect(studentProgress(w.director, w.s)!.summary).toMatchObject({ memorizedAyat: 10, passRank: 4 });
  });
});

describe('association logo', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const tenant = (w: ReturnType<typeof world>) => w.director.tenantId;
  it('starts empty, saves and removes a PNG, and audits both', () => {
    const w = world(); expect(readLogo(w.db, tenant(w))).toBeNull();
    expect(saveLogo(w.director, PNG)).toEqual({ ok: true }); expect(readLogo(w.db, tenant(w))).toBe(PNG);
    expect(saveLogo(w.director, null)).toEqual({ ok: true }); expect(readLogo(w.db, tenant(w))).toBeNull();
    expect(w.db.prepare("SELECT count(*) c FROM audit_log WHERE action IN ('settings.logo_set','settings.logo_removed')").get()).toEqual({ c: 2 }); expect(verifyAuditLog(w.db)).toEqual({ ok: true });
  });
  it('refuses non-images, scripts, oversized data and people without the right to manage settings', () => {
    const w = world();
    for (const bad of ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:text/html;base64,PGI+', 'javascript:alert(1)', PNG + '"onerror="x', 'data:image/png;base64,']) expect(saveLogo(w.director, bad)).toEqual({ ok: false, error: 'invalid' });
    expect(saveLogo(w.director, 'data:image/png;base64,' + 'A'.repeat(400_001))).toEqual({ ok: false, error: 'too_big' });
    expect(saveLogo(w.sup, PNG)).toEqual({ ok: false, error: 'forbidden' }); expect(readLogo(w.db, tenant(w))).toBeNull();
  });
});
