import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { request } from 'node:https';
import {
  openDb, migrate, runSetup, generateRecoveryKey, createStudent, createGroup, enrollStudent, verifyAuditLog, type Ctx,
} from '@mishkat/db';
import type { Assignment } from '@mishkat/domain';
import { createPhoneService, isPrivateAddress, type PhoneService } from '../src/main/phone/server';
import { makePhoneCert } from '../src/main/phone/cert';

const FAST = { memoryKiB: 8, passes: 1, parallelism: 1 };
const ok = <R extends { ok: boolean }>(r: R): Extract<R, { ok: true }> => { if (!r.ok) throw new Error('expected ok: ' + JSON.stringify(r)); return r as Extract<R, { ok: true }>; };
const cert = makePhoneCert(['127.0.0.1']);

async function world() {
  const db = openDb(':memory:'); migrate(db);
  const { tenantId } = runSetup(db, { admin: { givenName: 'مستخدم', familyName: 'البرنامج', username: 'user1', password: 'a-long-test-password' }, association: { name: 'جمعية تجربة' },
    branches: [{ name: 'فرع الرجال' }, { name: 'فرع النساء' }], year: { name: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30' } }, generateRecoveryKey().key, { argon2: FAST });
  const [men, women] = (db.prepare('SELECT id FROM branch ORDER BY position').all() as { id: string }[]).map((b) => b.id) as [string, string];
  const day = '2026-11-20'; let clockDay = '2026-10-01';
  const ctx = (a: Assignment[]): Ctx => ({ db, tenantId, actorId: 'u1', assignments: a, now: () => clockDay + 'T09:00:00.000Z' });
  const director = ctx([{ role: 'director', branchId: null }]);
  const stu = (b: string, n: number) => ok(createStudent(director, { givenName: 'طالب' + n, familyName: 'اختبار', birthDate: null, phone: '0550123456', branchId: b, status: 'active', joinedOn: null, studentNo: String(n) })).id;
  const gM = ok(createGroup(director, { branchId: men, name: 'فوج الرجال', level: null, capacity: 10 })).id; const gW = ok(createGroup(director, { branchId: women, name: 'فوج النساء', level: null, capacity: 10 })).id;
  const sM = [stu(men, 1), stu(men, 2)]; const sW = [stu(women, 3)]; for (const s of sM) ok(enrollStudent(director, gM, s)); ok(enrollStudent(director, gW, sW[0]!)); clockDay = day;
  const svc = createPhoneService({ db, tenantId: () => tenantId, now: () => day + 'T09:00:00.000Z', tls: { key: cert.keyPem, cert: cert.certPem }, maxDevices: 3 });
  const port = await svc.start(0);
  const call = (method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) => new Promise<{ status: number; body: any; headers: Record<string, string | string[] | undefined> }>((res, rej) => {
    const q = request({ host: '127.0.0.1', port, method, path, ca: cert.certPem, servername: 'localhost', checkServerIdentity: () => undefined, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers } }, (r) => {
      let t = ''; r.on('data', (d) => (t += d)); r.on('end', () => { let b: unknown = t; try { b = JSON.parse(t); } catch { /* html or empty */ } res({ status: r.statusCode ?? 0, body: b, headers: r.headers }); });
    }); q.on('error', rej); if (body !== undefined) q.write(typeof body === 'string' ? body : JSON.stringify(body)); q.end();
  });
  const pair = async (branches: string[] | 'all', name = 'هاتف الأستاذ') => { const c = ok(svc.newPairingCode(branches)); const r = await call('POST', '/api/pair', { code: c.code, name }); return { token: r.body.token as string, id: r.body.device?.id as string, status: r.status }; };
  return { db, men, women, gM, gW, sM, sW, svc, call, pair, day };
}

describe('phone page and server', () => {
  let w: Awaited<ReturnType<typeof world>>; beforeEach(async () => { w = await world(); }); afterEach(async () => { await w.svc.stop(); });

  it('serves one page with a strict content security policy and no external files', async () => {
    const r = await w.call('GET', '/'); expect(r.status).toBe(200); expect(String(r.headers['content-type'])).toContain('text/html');
    const csp = String(r.headers['content-security-policy']); expect(csp).toContain("default-src 'none'"); expect(csp).toMatch(/script-src 'nonce-/); expect(csp).toContain("frame-ancestors 'none'");
    const html = r.body as string; expect(html).not.toMatch(/https?:\/\/(?!phone\.local)/); expect(html).not.toMatch(/innerHTML/); expect(html).toContain('dir="rtl"'); expect(html).toContain('viewport');
    const r2 = await w.call('GET', '/'); expect(String(r2.headers['content-security-policy'])).not.toBe(csp); // a new nonce each time
  });
  it('only exposes a fixed list of actions: everything else is not found or needs a token', async () => {
    for (const p of ['/api/finance', '/api/students/export', '/admin', '/api/backup', '/../etc/passwd', '/api/pair/x']) expect((await w.call('GET', p)).status, p).toBeOneOf([401, 404]);
    const { token } = await w.pair('all'); for (const p of ['/api/finance', '/api/payments', '/api/guardians', '/api/settings', '/api/backup', '/api/staff', '/api/photo']) expect((await w.call('GET', p, undefined, token)).status, p).toBe(404);
    expect((await w.call('DELETE', '/api/attendance', undefined, token)).status).toBe(404); expect((await w.call('PUT', '/api/me', {}, token)).status).toBe(404);
  });

  describe('pairing', () => {
    it('a code works once, makes a device with a hashed token, and is audited', async () => {
      const c = ok(w.svc.newPairingCode('all')); expect(c.code).toMatch(/^\d{6}$/);
      const r = await w.call('POST', '/api/pair', { code: c.code, name: ' هاتف 1 ' }); expect(r.status).toBe(200); expect(r.body.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
      expect((await w.call('POST', '/api/pair', { code: c.code, name: 'x' })).body).toEqual({ error: 'bad_code' }); // used
      const row = w.db.prepare('SELECT name, token_hash h FROM phone_device').get() as { name: string; h: string }; expect(row.name).toBe('هاتف 1'); expect(row.h).toMatch(/^[0-9a-f]{64}$/); expect(JSON.stringify(row)).not.toContain(r.body.token);
      expect(w.db.prepare("SELECT count(*) c FROM audit_log WHERE action = 'phone.pair'").get()).toEqual({ c: 1 }); expect(verifyAuditLog(w.db)).toEqual({ ok: true });
    });
    it('rejects wrong or expired codes, missing names, and locks the address after five failures', async () => {
      const c = ok(w.svc.newPairingCode('all', -1)); expect((await w.call('POST', '/api/pair', { code: c.code, name: 'x' })).status).toBe(400); // expired
      const c2 = ok(w.svc.newPairingCode('all')); expect((await w.call('POST', '/api/pair', { code: c2.code, name: ' ' })).body).toEqual({ error: 'name_required' });
      for (let i = 0; i < 3; i++) await w.call('POST', '/api/pair', { code: '000000', name: 'x' });
      expect((await w.call('POST', '/api/pair', { code: '000000', name: 'x' })).status).toBe(429); expect((await w.call('POST', '/api/pair', { code: c2.code, name: 'ok' })).status).toBe(429); // even the right code, while locked
    });
    it('limits the number of active devices, and a revoked one frees a place', async () => {
      const a = await w.pair('all', 'a'); await w.pair('all', 'b'); await w.pair('all', 'c'); expect(w.svc.newPairingCode('all')).toEqual({ ok: false, error: 'too_many_devices' });
      expect(w.svc.revoke(a.id, 'u1')).toBe(true); expect(w.svc.newPairingCode('all').ok).toBe(true); expect(w.svc.newPairingCode([] as string[])).toEqual({ ok: false, error: 'no_branch' });
    });
  });

  describe('devices', () => {
    it('need a valid token, and a revoked device is refused at once', async () => {
      expect((await w.call('GET', '/api/me')).status).toBe(401); expect((await w.call('GET', '/api/me', undefined, 'x'.repeat(43))).status).toBe(401);
      const d = await w.pair('all'); const me = await w.call('GET', '/api/me', undefined, d.token); expect(me.status).toBe(200); expect(me.body).toMatchObject({ association: 'جمعية تجربة', device: { name: 'هاتف الأستاذ' } }); expect(me.body.branches).toHaveLength(2);
      expect(w.svc.revoke(d.id, 'u1')).toBe(true); expect((await w.call('GET', '/api/me', undefined, d.token)).status).toBe(401); expect(w.svc.revoke(d.id, 'u1')).toBe(false);
      expect(() => w.db.prepare('UPDATE phone_device SET revoked_at = NULL, revoked_by = NULL').run()).toThrow(/revoked/); expect(() => w.db.prepare('DELETE FROM phone_device').run()).toThrow(/physical delete/);
    });
    it('are limited to the branches chosen when the code was made', async () => {
      const m = await w.pair([w.men], 'رجال'); const f = await w.pair([w.women], 'نساء');
      const gm = await w.call('GET', '/api/groups', undefined, m.token); expect(gm.body.all.map((g: any) => g.name)).toEqual(['فوج الرجال']); expect((await w.call('GET', '/api/groups', undefined, f.token)).body.all.map((g: any) => g.name)).toEqual(['فوج النساء']);
      expect((await w.call('GET', `/api/sheet?group=${w.gW}&date=${w.day}`, undefined, m.token)).status).toBe(404); expect((await w.call('GET', `/api/sheet?group=${w.gM}&date=${w.day}`, undefined, m.token)).status).toBe(200);
      expect((await w.call('GET', '/api/students?search=', undefined, m.token)).body.rows.map((s: any) => s.studentNo).sort()).toEqual(['1', '2']); expect((await w.call('GET', `/api/memo?student=${w.sW[0]}`, undefined, m.token)).status).toBe(404);
      expect((await w.call('POST', '/api/attendance', { groupId: w.gW, date: w.day, startTime: '16:00', endTime: '17:00', entries: [{ studentId: w.sW[0], status: 'present' }] }, m.token)).status).toBe(400);
      expect(w.db.prepare('SELECT count(*) c FROM attendance_record').get()).toEqual({ c: 0 });
    });
    it('never show a student\'s phone number or any money data', async () => {
      const d = await w.pair('all'); const s = await w.call('GET', '/api/students?search=', undefined, d.token); expect(JSON.stringify(s.body)).not.toContain('0550123456'); expect(Object.keys(s.body.rows[0]).sort()).toEqual(['branchName', 'id', 'name', 'studentNo']);
    });
  });

  describe('taking attendance from the phone', () => {
    it('lists the groups with their state, records a sheet, and audits the device as the actor', async () => {
      const d = await w.pair('all', 'هاتف الأستاذ'); const g = await w.call('GET', '/api/groups', undefined, d.token); expect(g.body.groups.map((x: any) => [x.groupName, x.state])).toEqual([['فوج الرجال', 'not_recorded'], ['فوج النساء', 'not_recorded']]);
      const sh = await w.call('GET', `/api/sheet?group=${w.gM}&date=${w.day}`, undefined, d.token); expect(sh.body.rows.map((r: any) => [r.studentNo, r.recorded])).toEqual([['1', false], ['2', false]]);
      const r = await w.call('POST', '/api/attendance', { groupId: w.gM, date: w.day, startTime: '16:00', endTime: '17:00', entries: [{ studentId: w.sM[0], status: 'present' }, { studentId: w.sM[1], status: 'late', lateMinutes: 12 }] }, d.token); expect(r.body).toMatchObject({ ok: true, saved: 2 });
      expect(w.db.prepare("SELECT a.status s, a.late_minutes l, a.recorded_by r FROM attendance_record a ORDER BY a.status").all()).toEqual([{ s: 'late', l: 12, r: 'phone:' + d.id }, { s: 'present', l: null, r: 'phone:' + d.id }]);
      expect((await w.call('GET', '/api/groups', undefined, d.token)).body.groups[0]).toMatchObject({ groupName: 'فوج الرجال', state: 'done' });
      expect((await w.call('POST', '/api/attendance', { groupId: w.gM, date: w.day, startTime: '16:00', endTime: '17:00', entries: [{ studentId: w.sM[0], status: 'absent' }] }, d.token)).body).toEqual({ ok: false, error: 'already_recorded' });
      expect(w.db.prepare("SELECT actor_id a FROM audit_log WHERE action = 'attendance.record'").get()).toEqual({ a: 'phone:' + d.id }); expect(verifyAuditLog(w.db)).toEqual({ ok: true });
    });
    it('cannot correct, cancel or edit past records: those routes do not exist', async () => {
      const d = await w.pair('all'); for (const p of ['/api/attendance/correct', '/api/attendance/cancel', '/api/sheet/cancel']) expect((await w.call('POST', p, {}, d.token)).status).toBe(404);
    });
    it('rejects bad bodies, bad json, oversized bodies and future dates', async () => {
      const d = await w.pair('all'); expect((await w.call('POST', '/api/attendance', { groupId: w.gM }, d.token)).status).toBe(400); expect((await w.call('POST', '/api/attendance', '{not json', d.token)).status).toBe(400);
      expect((await w.call('POST', '/api/attendance', JSON.stringify({ x: 'a'.repeat(70_000) }), d.token)).status).toBe(400);
      expect((await w.call('POST', '/api/attendance', { groupId: w.gM, date: '2026-11-21', startTime: '16:00', endTime: '17:00', entries: [{ studentId: w.sM[0], status: 'present' }] }, d.token)).body).toEqual({ ok: false, error: 'future_date' });
    });
  });

  describe('memorization from the phone', () => {
    it('shows the scale and surahs, records progress, and shows the summary', async () => {
      const d = await w.pair('all'); const q = await w.call('GET', '/api/quran', undefined, d.token); expect(q.body.surahs).toHaveLength(114); expect(q.body.surahs[0]).toEqual([1, 'الفاتحة', 7]); expect(q.body.scale.map((x: any) => x.rank)).toEqual([5, 4, 3, 2, 1]);
      const body = { studentId: w.sM[0], date: w.day, type: 'new', start: { surah: 1, ayah: 1 }, end: { surah: 1, ayah: 7 }, evalRank: 4 }; expect((await w.call('POST', '/api/memo', body, d.token)).body).toEqual({ ok: true });
      const m = await w.call('GET', `/api/memo?student=${w.sM[0]}`, undefined, d.token); expect(m.body.summary).toMatchObject({ memorizedAyat: 7, wholeSurahs: 1 }); expect(m.body.records[0]).toMatchObject({ type: 'new', rangeText: 'الفاتحة 1–7', evalLabel: 'جيد جداً' });
      expect((await w.call('POST', '/api/memo', { ...body, end: { surah: 1, ayah: 8 } }, d.token)).body).toMatchObject({ ok: false, error: 'invalid_range' }); expect((await w.call('POST', '/api/memo', { ...body, evalRank: null }, d.token)).body).toMatchObject({ error: 'eval_required' });
      expect((await w.call('POST', '/api/memo', { ...body, type: 'zzz' }, d.token)).status).toBe(400); expect(w.db.prepare("SELECT created_by c FROM memorization_record").get()).toEqual({ c: 'phone:' + d.id });
    });
  });

  describe('network protection', () => {
    it('only private network addresses are accepted', () => {
      for (const ok of ['192.168.1.5', '10.1.2.3', '172.16.0.9', '172.31.255.1', '127.0.0.1', '::ffff:192.168.0.7', '::1', 'fd00::1', 'fe80::1']) expect(isPrivateAddress(ok), ok).toBe(true);
      for (const bad of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '193.168.1.1', '2001:4860:4860::8888', '', undefined]) expect(isPrivateAddress(bad as string), String(bad)).toBe(false);
    });
    it('refuses requests that claim to come from another website', async () => { expect((await w.call('GET', '/', undefined, undefined, { Origin: 'https://evil.example' })).status).toBe(403); });
    it('stops listening when switched off and clears pending codes', async () => {
      const c = ok(w.svc.newPairingCode('all')); await w.svc.stop(); expect(w.svc.running()).toBe(false); await expect(w.call('GET', '/')).rejects.toBeTruthy();
      const port = await w.svc.start(0); expect(port).toBeGreaterThan(0); void c; expect(w.svc.running()).toBe(true);
    });
  });
});
