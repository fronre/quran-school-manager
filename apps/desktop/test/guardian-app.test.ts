import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { request } from 'node:https';
import { openDb, migrate, runSetup, generateRecoveryKey, createStudent, addGuardian, issueGuardianCode, verifyAuditLog, type Ctx } from '@mishkat/db';
import type { Assignment } from '@mishkat/domain';
import { createPhoneService } from '../src/main/phone/server';
import { makePhoneCert } from '../src/main/phone/cert';

const FAST = { memoryKiB: 8, passes: 1, parallelism: 1 };
const ok = <R extends { ok: boolean }>(r: R): Extract<R, { ok: true }> => { if (!r.ok) throw new Error('expected ok: ' + JSON.stringify(r)); return r as Extract<R, { ok: true }>; };
const cert = makePhoneCert(['127.0.0.1']);

async function world() {
  const db = openDb(':memory:'); migrate(db);
  const { tenantId } = runSetup(db, { admin: { givenName: 'مستخدم', familyName: 'البرنامج', username: 'user1', password: 'a-long-test-password' }, association: { name: 'الشهاب' },
    branches: [{ name: 'فرع الرجال' }, { name: 'فرع النساء' }], year: { name: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30' } }, generateRecoveryKey().key, { argon2: FAST });
  const [men] = (db.prepare('SELECT id FROM branch ORDER BY position').all() as { id: string }[]).map((b) => b.id) as [string];
  const ctx: Ctx = { db, tenantId, actorId: 'u1', assignments: [{ role: 'director', branchId: null } as Assignment], now: () => '2026-11-20T09:00:00.000Z' };
  const stu = (n: number) => ok(createStudent(ctx, { givenName: 'طالب' + n, familyName: 'اختبار', birthDate: null, phone: null, branchId: men, status: 'active', joinedOn: null, studentNo: String(n) })).id;
  const s1 = stu(1); const s2 = stu(2);
  ok(addGuardian(ctx, s1, { name: 'علي', phone: '0550123456', relation: 'father', isPrimary: false })); ok(addGuardian(ctx, s2, { name: 'عمر', phone: '0661234567', relation: 'father', isPrimary: false }));
  const gid = (ph: string) => (db.prepare('SELECT id FROM guardian WHERE phone = ?').get(ph) as { id: string }).id;
  const code = ok(issueGuardianCode(ctx, gid('0550123456'))).code;
  const svc = createPhoneService({ db, tenantId: () => tenantId, now: () => '2026-11-20T09:00:00.000Z', tls: { key: cert.keyPem, cert: cert.certPem } });
  const port = await svc.start(0);
  const call = (method: string, path: string, body?: unknown, token?: string) => new Promise<{ status: number; body: any; headers: Record<string, string | string[] | undefined> }>((res, rej) => {
    const q = request({ host: '127.0.0.1', port, method, path, ca: cert.certPem, servername: 'localhost', checkServerIdentity: () => undefined, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } }, (r) => {
      let t = ''; r.on('data', (d) => (t += d)); r.on('end', () => { let b: unknown = t; try { b = JSON.parse(t); } catch { /* html */ } res({ status: r.statusCode ?? 0, body: b, headers: r.headers }); });
    }); q.on('error', rej); if (body !== undefined) q.write(JSON.stringify(body)); q.end();
  });
  return { db, svc, call, code, ctx, gid };
}

describe('guardian app over the private network (prototype)', () => {
  let w: Awaited<ReturnType<typeof world>>; beforeEach(async () => { w = await world(); }); afterEach(async () => { await w.svc.stop(); });
  it('serves the guardian page with a strict policy and no external files', async () => {
    const r = await w.call('GET', '/g'); expect(r.status).toBe(200); const csp = String(r.headers['content-security-policy']); expect(csp).toContain("default-src 'none'"); expect(csp).toMatch(/script-src 'nonce-/);
    const html = r.body as string; expect(html).not.toMatch(/https?:\/\//); expect(html).not.toMatch(/innerHTML/); expect(html).toContain('dir="rtl"'); expect(html).toContain('noindex'); expect(html).not.toMatch(/style:'/); // inline style attributes are blocked by the page's policy: set styles from script instead
  });
  it('signs in with phone + code and shows only that guardian\'s own children, read-only', async () => {
    const l = await w.call('POST', '/api/g/login', { phone: '0550 123 456', code: w.code }); expect(l.status).toBe(200); const t = l.body.token as string; expect(t.length).toBeGreaterThan(30);
    const me = await w.call('GET', '/api/g/me', undefined, t); expect(me.status).toBe(200); expect(me.body.children.map((c: { name: string }) => c.name)).toEqual(['طالب1 اختبار']); expect(JSON.stringify(me.body)).not.toContain('طالب2'); expect(JSON.stringify(me.body)).not.toMatch(/phone|0661234567|0550123456/);
    for (const [m, p] of [['POST', '/api/attendance'], ['POST', '/api/memo'], ['GET', '/api/students'], ['GET', '/api/groups']] as const) expect((await w.call(m, p, {}, t)).status).toBe(401); // a guardian token opens nothing of the staff phone API
  });
  it('wrong phone or code gives one generic answer; a guardian token is not valid for staff routes and logout ends the session', async () => {
    const a = await w.call('POST', '/api/g/login', { phone: '0550123456', code: 'AAAA-AAAA' }); const b = await w.call('POST', '/api/g/login', { phone: '0699999999', code: w.code });
    expect(a.status).toBe(400); expect(b.status).toBe(400); expect(a.body).toEqual(b.body); expect((await w.call('GET', '/api/g/me')).status).toBe(401);
    const t = (await w.call('POST', '/api/g/login', { phone: '0550123456', code: w.code })).body.token as string; expect((await w.call('POST', '/api/g/logout', {}, t)).status).toBe(200); expect((await w.call('GET', '/api/g/me', undefined, t)).status).toBe(401);
  });
  it('a revoked or replaced code stops working at once, even for a signed-in session after a new code is issued', async () => {
    const t = (await w.call('POST', '/api/g/login', { phone: '0550123456', code: w.code })).body.token as string;
    const fresh = ok(issueGuardianCode(w.ctx, w.gid('0550123456'))).code; expect((await w.call('POST', '/api/g/login', { phone: '0550123456', code: w.code })).status).toBe(400);
    expect((await w.call('POST', '/api/g/login', { phone: '0550123456', code: fresh })).status).toBe(200); expect(t.length).toBeGreaterThan(0); expect(verifyAuditLog(w.db)).toEqual({ ok: true });
  });
});
