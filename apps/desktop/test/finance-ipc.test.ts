import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, migrate, runSetup, generateRecoveryKey, createUser, assignRole, verifyAuditLog, type Protector } from '@mishkat/db';
import { readXlsx } from '@mishkat/files';
import { createDispatcher, type Deps } from '../src/main/ipc';

const FAST = { memoryKiB: 8, passes: 1, parallelism: 1 };
const xor = (b: Buffer) => Buffer.from(b.map((x) => x ^ 0x5a));
const prot: Protector = { available: () => true, encrypt: xor, decrypt: xor };
const PW = 'a-long-test-password'; const FPW = 'صندوق-2026';

function app() {
  const db = openDb(':memory:'); migrate(db);
  const rk = generateRecoveryKey();
  const { tenantId } = runSetup(db, { admin: { givenName: 'علي', familyName: 'المدير', username: 'dir', password: PW }, association: { name: 'جمعية علماء المسلمين في سيدي عون' },
    branches: [{ name: 'فرع الرجال' }, { name: 'فرع النساء' }], year: { name: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30' } }, rk.key, { argon2: FAST });
  const [men, women] = (db.prepare('SELECT id FROM branch ORDER BY position').all() as { id: string }[]).map((b) => b.id) as [string, string];
  const t0 = '2026-09-01T08:00:00.000Z'; const p = crypto.randomUUID(), s = crypto.randomUUID();
  db.prepare('INSERT INTO person(id,tenant_id,created_at,updated_at,created_by,updated_by,given_name,family_name) VALUES (?,?,?,?,?,?,?,?)').run(p, tenantId, t0, t0, 's', 's', 'regm', 'م');
  db.prepare("INSERT INTO staff_member(id,tenant_id,created_at,updated_at,created_by,updated_by,person_id,kind) VALUES (?,?,?,?,?,?,?,'employee')").run(s, tenantId, t0, t0, 's', 's', p);
  const u = createUser(db, { tenantId, staffMemberId: s, username: 'regm', password: PW, actor: { id: 's', role: 'system' } }, { argon2: FAST });
  if (!u.ok) throw new Error('setup'); assignRole(db, { tenantId, userId: u.userId, role: 'registrar', branchId: men, actor: { id: 's', role: 'system' } });
  const dir = mkdtempSync(join(tmpdir(), 'mishkat-fin-'));
  const clock = { ms: Date.parse('2026-11-20T09:00:00.000Z') };
  const saved: { name: string; data: Buffer | string }[] = [];
  const d: Deps = { db, version: '0', session: { current: null }, authOptions: { argon2: FAST }, dataDir: dir, protector: prot, settings: { get: () => ({ backupFolder: null }), set: () => {} },
    pickFolder: async () => null, defaultBackupFolder: dir, wizard: { key: null, backupFolder: null }, tenantId: () => tenantId, now: () => new Date(clock.ms).toISOString(), importJob: { current: null }, finance: { lastActive: null }, dbPath: '', restart: () => {}, pickImage: async () => null, processImage: () => null,
    nowMs: () => clock.ms, financeIdleMs: 10 * 60 * 1000, pickOpenFile: async () => null, saveFile: async (name, data) => { saved.push({ name, data }); return name; } };
  const run = createDispatcher(d);
  const as = async (u: string) => { await run('auth.logout', {}); if (!((await run('auth.login', { username: u, password: PW })) as { ok: boolean }).ok) throw new Error('login'); };
  const student = async (no: string, given: string, branchId: string) => ((await run('students.create', { input: { givenName: given, familyName: 'اختبار', birthDate: null, phone: null, branchId, status: 'active', joinedOn: '2026-09-05', studentNo: no } })) as { id: string }).id;
  return { db, run, as, men, women, d, clock, saved, student, recovery: rk.display };
}
const FIN = ['finance.settings', 'finance.setRate', 'finance.setFreeMonth', 'finance.record', 'finance.cancel', 'finance.receipt', 'finance.payments', 'finance.statement', 'finance.arrears', 'finance.summary', 'finance.exportArrears'] as const;
const GOOD: Record<string, unknown> = {
  'finance.settings': {}, 'finance.setRate': { effectiveFrom: '2026-09', amount: 1000 }, 'finance.setFreeMonth': { month: '2026-12', free: true }, 'finance.record': { studentId: 'x', month: '2026-10', paidOn: '2026-10-05', collectorName: 'ب' },
  'finance.cancel': { id: 'x', reason: 'r' }, 'finance.receipt': { id: 'x' }, 'finance.payments': {}, 'finance.statement': { studentId: 'x' }, 'finance.arrears': {}, 'finance.summary': {}, 'finance.exportArrears': {},
};

describe('finance lock and access (OD-036 option A)', () => {
  let a: ReturnType<typeof app>; beforeEach(async () => { a = app(); await a.as('dir'); });

  it('reports whether the password exists and whether the section is unlocked, for the Director only', async () => {
    expect(await a.run('finance.status', {})).toEqual({ canUse: true, configured: false, unlocked: false });
    await a.as('regm'); expect(await a.run('finance.status', {})).toEqual({ canUse: false, configured: false, unlocked: false });
  });
  it('every finance data channel is refused while locked, and for non-Directors even when the Director unlocked it', async () => {
    for (const c of FIN) await expect(a.run(c, GOOD[c]), c).rejects.toMatchObject({ code: 'forbidden' });
    await a.run('finance.setPassword', { password: FPW });
    await a.as('regm');
    const PW_PAYLOADS: Record<string, unknown> = { 'finance.setPassword': { password: FPW }, 'finance.unlock': { password: FPW }, 'finance.changePassword': { oldPassword: 'x', newPassword: 'yyyyyy' }, 'finance.resetPassword': { recoveryKey: 'x', newPassword: 'yyyyyy' } };
    for (const c of FIN) await expect(a.run(c, GOOD[c]), c).rejects.toMatchObject({ code: 'forbidden' });
    for (const c of Object.keys(PW_PAYLOADS)) await expect(a.run(c, PW_PAYLOADS[c]), c).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('needs a signed-in user', async () => {
    await a.run('auth.logout', {});
    for (const [c, p] of [['finance.status', {}], ['finance.unlock', { password: 'x' }], ['finance.lock', {}]] as const) await expect(a.run(c, p), c).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('setting the password unlocks the section; a weak or repeated password is rejected', async () => {
    expect(await a.run('finance.setPassword', { password: '123' })).toEqual({ ok: false, error: 'weak' });
    expect(await a.run('finance.setPassword', { password: FPW })).toEqual({ ok: true }); expect(await a.run('finance.status', {})).toEqual({ canUse: true, configured: true, unlocked: true });
    expect(await a.run('finance.setPassword', { password: 'another-one' })).toEqual({ ok: false, error: 'already_set' });
  });
  it('locks on request, unlocks with the right password, and refuses the wrong one with a growing delay', async () => {
    await a.run('finance.setPassword', { password: FPW }); await a.run('finance.lock', {}); expect(await a.run('finance.status', {})).toMatchObject({ unlocked: false });
    expect(await a.run('finance.unlock', { password: 'wrong-pass-1' })).toMatchObject({ ok: false, error: 'wrong' });
    for (let i = 0; i < 4; i++) await a.run('finance.unlock', { password: 'wrong-pass-1' });
    expect(await a.run('finance.unlock', { password: FPW })).toMatchObject({ ok: false, error: 'locked' });
    a.clock.ms += 31_000; expect(await a.run('finance.unlock', { password: FPW })).toEqual({ ok: true }); expect(await a.run('finance.status', {})).toMatchObject({ unlocked: true });
  });
  it('relocks after 10 idle minutes, and each use of the section renews the timer', async () => {
    await a.run('finance.setPassword', { password: FPW });
    a.clock.ms += 9 * 60_000; await a.run('finance.summary', {}); a.clock.ms += 9 * 60_000; expect(await a.run('finance.status', {})).toMatchObject({ unlocked: true });
    a.clock.ms += 11 * 60_000; expect(await a.run('finance.status', {})).toMatchObject({ unlocked: false }); await expect(a.run('finance.summary', {})).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('signing out locks the section', async () => {
    await a.run('finance.setPassword', { password: FPW }); await a.as('dir'); expect(await a.run('finance.status', {})).toMatchObject({ unlocked: false });
  });
  it('changes the password with the old one and resets it with the recovery key written down at setup', async () => {
    await a.run('finance.setPassword', { password: FPW });
    expect(await a.run('finance.changePassword', { oldPassword: 'nope-nope', newPassword: 'جديدة-2027' })).toMatchObject({ ok: false, error: 'wrong' });
    expect(await a.run('finance.changePassword', { oldPassword: FPW, newPassword: 'جديدة-2027' })).toEqual({ ok: true });
    await a.run('finance.lock', {}); expect(await a.run('finance.resetPassword', { recoveryKey: generateRecoveryKey().display, newPassword: 'ثالثة-2028' })).toEqual({ ok: false, error: 'bad_key' });
    expect(await a.run('finance.resetPassword', { recoveryKey: a.recovery, newPassword: 'ثالثة-2028' })).toEqual({ ok: true }); expect(await a.run('finance.status', {})).toMatchObject({ unlocked: true });
    await a.run('finance.lock', {}); expect(await a.run('finance.unlock', { password: 'ثالثة-2028' })).toEqual({ ok: true });
  });
  it('rejects malformed payloads at the schema', async () => {
    await a.run('finance.setPassword', { password: FPW });
    for (const [c, p] of [['finance.setRate', { effectiveFrom: '2026-09', amount: '1000' }], ['finance.setRate', { effectiveFrom: '2026-09', amount: 1000, extra: 1 }], ['finance.record', { studentId: 'x' }],
      ['finance.payments', { status: 'weird' }], ['finance.arrears', { limit: 0 }], ['finance.setFreeMonth', { month: '2026-12' }], ['finance.cancel', {}]] as const)
      await expect(a.run(c, p), c + JSON.stringify(p)).rejects.toMatchObject({ code: 'invalid_payload' });
  });
});

describe('finance flow through IPC (OD-034, OD-035)', () => {
  let a: ReturnType<typeof app>; let s1: string, s2: string;
  beforeEach(async () => {
    a = app(); await a.as('dir'); await a.run('finance.setPassword', { password: FPW });
    s1 = await a.student('1', 'أحمد', a.men); s2 = await a.student('2', 'فاطمة', a.women);
    await a.run('finance.setRate', { effectiveFrom: '2026-09', amount: 1000 });
  });
  const rec = (studentId: string, month: string, over: Record<string, string> = {}) => a.run('finance.record', { studentId, month, paidOn: '2026-11-05', collectorName: 'أمين الصندوق', ...over }) as Promise<{ ok: boolean; id?: string; receiptNo?: number; amount?: number; error?: string }>;

  it('shows the settings with the active year, the rate and the months', async () => {
    const r = (await a.run('finance.settings', {})) as { ok: boolean; year: { name: string }; rates: unknown[]; months: string[]; today: string };
    expect(r.year.name).toBe('2026-2027'); expect(r.rates).toEqual([{ effectiveFrom: '2026-09', amount: 1000 }]); expect(r.months).toHaveLength(10); expect(r.today).toBe('2026-11-20');
  });
  it('records a payment with the fixed amount and a sequential receipt, and refuses a repeat', async () => {
    expect(await rec(s1, '2026-09')).toMatchObject({ ok: true, receiptNo: 1, amount: 1000 }); expect(await rec(s2, '2026-09')).toMatchObject({ ok: true, receiptNo: 2 });
    expect(await rec(s1, '2026-09')).toEqual({ ok: false, error: 'already_paid' }); expect(await rec(s1, '2026-10', { collectorName: ' ' })).toEqual({ ok: false, error: 'collector_required' });
    expect(await rec(s1, '2026-08')).toEqual({ ok: false, error: 'month_outside_year' });
  });
  it('returns a printable receipt and lists payments', async () => {
    const r = await rec(s1, '2026-10'); const { receipt } = (await a.run('finance.receipt', { id: r.id })) as { receipt: Record<string, unknown> };
    expect(receipt).toMatchObject({ receiptNo: 1, association: 'جمعية علماء المسلمين في سيدي عون', studentName: 'أحمد اختبار', month: '2026-10', amount: 1000, collectorName: 'أمين الصندوق' });
    expect(((await a.run('finance.payments', {})) as { total: number }).total).toBe(1);
  });
  it('cancels a payment with a reason, keeps its number, and allows paying the month again', async () => {
    const r = await rec(s1, '2026-10'); expect(await a.run('finance.cancel', { id: r.id, reason: ' ' })).toEqual({ ok: false, error: 'reason_required' });
    expect(await a.run('finance.cancel', { id: r.id, reason: 'خطأ في الطالب' })).toEqual({ ok: true }); expect((await rec(s1, '2026-10')).receiptNo).toBe(2);
    expect(((await a.run('finance.payments', { status: 'cancelled' })) as { total: number }).total).toBe(1); expect(verifyAuditLog(a.db)).toEqual({ ok: true });
  });
  it('treats a free month as not owed and not payable, and refuses to rewrite a used rate', async () => {
    expect(await a.run('finance.setFreeMonth', { month: '2026-10', free: true })).toEqual({ ok: true }); expect(await rec(s1, '2026-10')).toEqual({ ok: false, error: 'month_not_billable' });
    await rec(s1, '2026-09'); expect(await a.run('finance.setRate', { effectiveFrom: '2026-09', amount: 1500 })).toEqual({ ok: false, error: 'rate_in_use' });
    expect(await a.run('finance.setRate', { effectiveFrom: '2027-01', amount: 1500 })).toEqual({ ok: true });
  });
  it('gives a student statement, an arrears list and the month summary', async () => {
    await rec(s1, '2026-09'); await rec(s1, '2026-10'); await rec(s1, '2026-11');
    const st = ((await a.run('finance.statement', { studentId: s2 })) as { statement: { lines: { status: string }[]; arrears: { total: number } } }).statement;
    expect(st.lines.slice(0, 3).map((l) => l.status)).toEqual(['due', 'due', 'due']); expect(st.arrears.total).toBe(3000);
    const ar = (await a.run('finance.arrears', {})) as { rows: { studentNo: string; total: number }[]; totalAmount: number; total: number };
    expect(ar.rows.map((r) => [r.studentNo, r.total])).toEqual([['2', 3000]]); expect(ar.totalAmount).toBe(3000);
    expect(((await a.run('finance.arrears', { branchId: a.men })) as { total: number }).total).toBe(0);
    expect(((await a.run('finance.summary', {})) as { summary: Record<string, number> }).summary).toMatchObject({ month: '2026-11', owing: 2, paid: 1, unpaid: 1, expected: 2000, collected: 1000 });
  });
  it('exports the arrears to Excel and audits the export', async () => {
    expect(await a.run('finance.exportArrears', {})).toEqual({ ok: true, count: 2 });
    const f = a.saved[0]!; expect(f.name).toBe('المتأخرات-2026-11-20.xlsx');
    const t = await readXlsx(f.data as Buffer); if (!t.ok) throw new Error('unreadable');
    expect(t.table.headers).toEqual(['رقم الطالب', 'الاسم', 'الفرع', 'عدد الأشهر', 'الأشهر غير المدفوعة', 'المبلغ المستحق (دج)', 'مؤرشف']);
    expect(t.table.rows.map((r) => r[5])).toEqual([3000, 3000]); expect(a.db.prepare("SELECT count(*) c FROM audit_log WHERE action='export.arrears'").get()).toEqual({ c: 1 });
  });
  it('finance actions never reach a locked section even with a valid session', async () => {
    await a.run('finance.lock', {}); await expect(rec(s1, '2026-10')).rejects.toMatchObject({ code: 'forbidden' }); await expect(a.run('finance.exportArrears', {})).rejects.toMatchObject({ code: 'forbidden' });
  });
});
