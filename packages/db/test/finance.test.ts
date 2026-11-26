import { describe, it, expect, beforeEach } from 'vitest';
import type { Assignment, StudentInput } from '@mishkat/domain';
import {
  openDb, migrate, newId, verifyAuditLog, createStudent, archiveStudent, generateRecoveryKey, storeRecoveryVerifier,
  setRate, setFreeMonth, recordPayment, cancelPayment, getReceipt, listPayments, studentStatement, arrearsReport, monthSummary, feeSettings, activeYear,
  setFinancePassword, verifyFinancePassword, changeFinancePassword, resetFinancePassword, financePasswordSet, type Ctx, type FinCtx,
} from '../src';

const FAST = { memoryKiB: 8, passes: 1, parallelism: 1 };
const T = newId();
let clockMs = Date.parse('2026-11-20T09:00:00.000Z');
const NOW = () => new Date(clockMs).toISOString();

function world(withYear = true) {
  const db = openDb(':memory:'); migrate(db);
  const t0 = '2026-09-01T08:00:00.000Z';
  db.prepare('INSERT INTO association(id,tenant_id,created_at,updated_at,created_by,updated_by,name) VALUES (?,?,?,?,?,?,?)').run(T, T, t0, t0, 's', 's', 'جمعية علماء المسلمين في سيدي عون');
  const br = (n: string, p: number) => { const id = newId(); db.prepare('INSERT INTO branch(id,tenant_id,created_at,updated_at,created_by,updated_by,name,position) VALUES (?,?,?,?,?,?,?,?)').run(id, T, t0, t0, 's', 's', n, p); return id; };
  const men = br('فرع الرجال', 1), women = br('فرع النساء', 2);
  let year = '';
  if (withYear) { year = newId(); db.prepare("INSERT INTO academic_year(id,tenant_id,created_at,updated_at,created_by,updated_by,name,start_date,end_date,status) VALUES (?,?,?,?,?,?,?,?,?,'active')").run(year, T, t0, t0, 's', 's', '2026-2027', '2026-09-01', '2027-06-30'); }
  const ctx = (a: Assignment[]): Ctx => ({ db, tenantId: T, actorId: 'u1', assignments: a, now: NOW });
  const director = ctx([{ role: 'director', branchId: null }]), registrar = ctx([{ role: 'registrar', branchId: men }]);
  const mk = (b: string, no: string, g: string, over: Partial<StudentInput> = {}) => {
    const r = createStudent(director, { givenName: g, familyName: 'اختبار', birthDate: null, phone: null, branchId: b, status: 'active', joinedOn: '2026-09-05', studentNo: no, ...over });
    if (!r.ok) throw new Error('setup ' + JSON.stringify(r)); return r.id;
  };
  return { db, men, women, year, director, registrar, mk };
}
const ok = <R extends { ok: boolean }>(r: R): Extract<R, { ok: true }> => { if (!r.ok) throw new Error('expected ok: ' + JSON.stringify(r)); return r as Extract<R, { ok: true }>; };
const pay = (w: ReturnType<typeof world>, student: string, month: string, over: Record<string, string> = {}) => recordPayment(w.director, { studentId: student, month, paidOn: '2026-11-05', collectorName: 'أمين الصندوق', ...over });
beforeEach(() => { clockMs = Date.parse('2026-11-20T09:00:00.000Z'); });

describe('database invariants (OD-035 e, f)', () => {
  let w: ReturnType<typeof world>; let s: string;
  beforeEach(() => { w = world(); ok(setRate(w.director, '2026-09', 1000)); s = w.mk(w.men, '1', 'أحمد'); ok(pay(w, s, '2026-09')); });
  it('a payment cannot be edited or deleted with SQL', () => {
    expect(() => w.db.prepare('UPDATE payment SET amount = 1').run()).toThrow(/immutable/);
    expect(() => w.db.prepare("UPDATE payment SET collector_name = 'x'").run()).toThrow(/immutable/);
    expect(() => w.db.prepare('DELETE FROM payment').run()).toThrow(/append-only/);
  });
  it('allows one first cancellation, then the row is final', () => {
    w.db.prepare("UPDATE payment SET cancelled_at='2026-11-20T09:00:00.000Z', cancelled_by='u', cancel_reason='خطأ'").run();
    expect(() => w.db.prepare("UPDATE payment SET cancel_reason='غيره'").run()).toThrow(/immutable/);
  });
  it('a cancellation needs all three fields together and a non-blank reason', () => {
    expect(() => w.db.prepare("UPDATE payment SET cancelled_at='2026-11-20T09:00:00.000Z'").run()).toThrow();
    expect(() => w.db.prepare("UPDATE payment SET cancelled_at='2026-11-20T09:00:00.000Z', cancelled_by='u', cancel_reason='  '").run()).toThrow();
  });
  it('rejects a second live payment for the same month and a month outside the year (DB level)', () => {
    const row = w.db.prepare('SELECT * FROM payment').get() as Record<string, unknown>;
    const ins = (over: Record<string, unknown>) => { const r = { ...row, id: newId(), ...over }; w.db.prepare(`INSERT INTO payment(${Object.keys(r).join(',')}) VALUES (${Object.keys(r).map((k) => '@' + k).join(',')})`).run(r); };
    expect(() => ins({ receipt_no: 99 })).toThrow(/UNIQUE/);
    expect(() => ins({ receipt_no: 98, month: '2026-08' })).toThrow(/outside the academic year/);
    expect(() => ins({ receipt_no: 1, month: '2026-10' })).toThrow(/UNIQUE/); // receipt numbers are unique per year
  });
  it('rate and free-month tables keep the tombstone and envelope rules', () => {
    expect(() => w.db.prepare('DELETE FROM fee_rate').run()).toThrow(/physical delete/);
    expect(() => w.db.prepare('UPDATE fee_rate SET amount = 5').run()).toThrow(/envelope violation/);
    expect(() => w.db.prepare("INSERT INTO fee_rate(id,tenant_id,created_at,updated_at,created_by,updated_by,effective_from,amount) VALUES (?,?,?,?,?,?,'2026-13',100)").run(newId(), T, NOW(), NOW(), 'u', 'u')).toThrow();
  });
});

describe('rates and non-billable months', () => {
  let w: ReturnType<typeof world>; beforeEach(() => { w = world(); });
  it('only the Director may change them; invalid input is rejected', () => {
    expect(setRate(w.registrar, '2026-09', 1000)).toEqual({ ok: false, error: 'forbidden' });
    for (const [m, a] of [['2026-13', 1000], ['2026-09', 0], ['2026-09', 10.5], ['2026-09', 2_000_000]] as const) expect(setRate(w.director, m, a), `${m} ${a}`).toEqual({ ok: false, error: 'invalid' });
    expect(feeSettings(w.registrar)).toBeNull();
  });
  it('sets a rate, audits it, treats the same value as a no-op, and corrects a rate nobody has paid at yet', () => {
    ok(setRate(w.director, '2026-09', 1000)); ok(setRate(w.director, '2026-09', 1000)); expect(w.db.prepare("SELECT count(*) c FROM audit_log WHERE action='fee.rate.set'").get()).toEqual({ c: 1 });
    ok(setRate(w.director, '2026-09', 1200)); expect(feeSettings(w.director)!.rates).toEqual([{ effectiveFrom: '2026-09', amount: 1200 }]);
    expect(JSON.parse((w.db.prepare("SELECT before_json b FROM audit_log WHERE action='fee.rate.set' ORDER BY seq DESC LIMIT 1").get() as { b: string }).b)).toEqual({ amount: 1000 });
  });
  it('refuses to rewrite a rate once live payments exist from that month on; a later rate is fine', () => {
    ok(setRate(w.director, '2026-09', 1000)); ok(pay(w, w.mk(w.men, '1', 'أحمد'), '2026-10'));
    expect(setRate(w.director, '2026-09', 1500)).toEqual({ ok: false, error: 'rate_in_use' });
    ok(setRate(w.director, '2027-01', 1500)); expect(feeSettings(w.director)!.rates).toHaveLength(2);
  });
  it('marks months as not billable and back, inside the active year only', () => {
    ok(setFreeMonth(w.director, '2026-12', true, 'عطلة الشتاء')); expect(feeSettings(w.director)!.freeMonths).toEqual(['2026-12']);
    ok(setFreeMonth(w.director, '2026-12', true)); ok(setFreeMonth(w.director, '2026-12', false)); expect(feeSettings(w.director)!.freeMonths).toEqual([]);
    expect(setFreeMonth(w.director, '2025-12', true)).toEqual({ ok: false, error: 'month_outside_year' }); expect(setFreeMonth(w.director, 'x', true)).toEqual({ ok: false, error: 'invalid' });
    expect(setFreeMonth(w.registrar, '2026-12', true)).toEqual({ ok: false, error: 'forbidden' });
  });
  it('cannot free a month that already has live payments', () => {
    ok(setRate(w.director, '2026-09', 1000)); ok(pay(w, w.mk(w.men, '1', 'أحمد'), '2026-10'));
    expect(setFreeMonth(w.director, '2026-10', true)).toEqual({ ok: false, error: 'month_has_payments' });
  });
  it('needs an active academic year', () => {
    const n = world(false); expect(setFreeMonth(n.director, '2026-10', true)).toEqual({ ok: false, error: 'no_active_year' }); expect(activeYear(n.director)).toBeNull();
    expect(recordPayment(n.director, { studentId: 'x', month: '2026-10', paidOn: '2026-10-01', collectorName: 'ب' })).toEqual({ ok: false, error: 'no_active_year' });
  });
});

describe('recording payments (OD-034)', () => {
  let w: ReturnType<typeof world>; let s: string;
  beforeEach(() => { w = world(); ok(setRate(w.director, '2026-09', 1000)); s = w.mk(w.men, '1', 'أحمد'); });
  it('takes the amount from the rate, numbers receipts 1, 2, 3 and audits each payment', () => {
    const a = ok(pay(w, s, '2026-09')), b = ok(pay(w, s, '2026-10')), c = ok(pay(w, s, '2026-11'));
    expect([a.receiptNo, b.receiptNo, c.receiptNo, a.amount]).toEqual([1, 2, 3, 1000]);
    const e = JSON.parse((w.db.prepare("SELECT after_json j FROM audit_log WHERE action='payment.record' ORDER BY seq LIMIT 1").get() as { j: string }).j);
    expect(e).toEqual({ receiptNo: 1, student: '1', month: '2026-09', amount: 1000, paidOn: '2026-11-05', collector: 'أمين الصندوق' }); expect(verifyAuditLog(w.db)).toEqual({ ok: true });
  });
  it('refuses a second payment of the same month and a missing collector name', () => {
    ok(pay(w, s, '2026-09')); expect(pay(w, s, '2026-09')).toEqual({ ok: false, error: 'already_paid' });
    expect(pay(w, s, '2026-10', { collectorName: '  ' })).toEqual({ ok: false, error: 'collector_required' });
  });
  it('refuses unpriced, non-billable and out-of-year months', () => {
    expect(pay(w, s, '2026-08')).toEqual({ ok: false, error: 'month_outside_year' });
    ok(setFreeMonth(w.director, '2026-12', true)); expect(pay(w, s, '2026-12')).toEqual({ ok: false, error: 'month_not_billable' });
    const w2 = world(); const s2 = w2.mk(w2.men, '1', 'ب'); expect(pay(w2, s2, '2026-10')).toEqual({ ok: false, error: 'no_rate' });
  });
  it('is Director-only and cannot reach students that do not exist', () => {
    expect(recordPayment(w.registrar, { studentId: s, month: '2026-10', paidOn: '2026-10-05', collectorName: 'ب' })).toEqual({ ok: false, error: 'forbidden' });
    expect(pay(w, 'missing', '2026-10')).toEqual({ ok: false, error: 'not_found' });
  });
  it('an archived student can still settle what he owed', () => {
    ok(archiveStudent(w.director, s, 'انتقل')); expect(pay(w, s, '2026-10').ok).toBe(true);
  });
});

describe('cancelling and receipts (OD-035 e, f)', () => {
  let w: ReturnType<typeof world>; let s: string;
  beforeEach(() => { w = world(); ok(setRate(w.director, '2026-09', 1000)); s = w.mk(w.men, '1', 'أحمد'); });
  it('needs a reason, keeps the receipt number in the register, and lets the month be paid again with the next number', () => {
    const a = ok(pay(w, s, '2026-10')); expect(cancelPayment(w.director, a.id, '  ')).toEqual({ ok: false, error: 'reason_required' });
    ok(cancelPayment(w.director, a.id, 'أُدخل المبلغ لطالب آخر'));
    expect(cancelPayment(w.director, a.id, 'مرة أخرى')).toEqual({ ok: false, error: 'already_cancelled' });
    const b = ok(pay(w, s, '2026-10')); expect(b.receiptNo).toBe(2);
    expect(listPayments(w.director, { status: 'all' }).rows.map((r) => [r.receiptNo, !!r.cancelledAt])).toEqual([[2, false], [1, true]]);
    expect(w.db.prepare("SELECT reason FROM audit_log WHERE action='payment.cancel'").get()).toEqual({ reason: 'أُدخل المبلغ لطالب آخر' }); expect(verifyAuditLog(w.db)).toEqual({ ok: true });
  });
  it('is Director-only and rejects unknown payments', () => {
    const a = ok(pay(w, s, '2026-10')); expect(cancelPayment(w.registrar, a.id, 'x')).toEqual({ ok: false, error: 'forbidden' }); expect(cancelPayment(w.director, 'nope', 'x')).toEqual({ ok: false, error: 'not_found' });
  });
  it('builds a receipt with everything printed on it, and hides it from other roles', () => {
    const a = ok(pay(w, s, '2026-10')); const r = getReceipt(w.director, a.id)!;
    expect(r).toMatchObject({ receiptNo: 1, association: 'جمعية علماء المسلمين في سيدي عون', yearName: '2026-2027', studentName: 'أحمد اختبار', studentNo: '1', branchName: 'فرع الرجال', month: '2026-10', amount: 1000, paidOn: '2026-11-05', collectorName: 'أمين الصندوق', cancelledAt: null });
    expect(getReceipt(w.registrar, a.id)).toBeNull();
  });
  it('lists and filters payments by month, status and search (name, number or receipt)', () => {
    const t = w.mk(w.women, '2', 'فاطمة'); ok(pay(w, s, '2026-09')); const x = ok(pay(w, t, '2026-09')); ok(pay(w, s, '2026-10')); ok(cancelPayment(w.director, x.id, 'خطأ'));
    expect(listPayments(w.director, { month: '2026-09' }).total).toBe(2); expect(listPayments(w.director, { status: 'live' }).total).toBe(2); expect(listPayments(w.director, { status: 'cancelled' }).total).toBe(1);
    expect(listPayments(w.director, { search: 'فاطمة' }).total).toBe(1); expect(listPayments(w.director, { search: '3' }).rows[0]!.receiptNo).toBe(3);
    expect(listPayments(w.registrar)).toEqual({ rows: [], total: 0 });
  });
});

describe('statement, arrears and month summary (OD-035 g)', () => {
  let w: ReturnType<typeof world>;
  beforeEach(() => { w = world(); ok(setRate(w.director, '2026-09', 1000)); });
  it('shows each month of the year for a student, paid and owed', () => {
    const s = w.mk(w.men, '1', 'أحمد'); ok(pay(w, s, '2026-09'));
    const st = studentStatement(w.director, s, '2026-11-20')!;
    expect(st.lines.slice(0, 4).map((l) => l.status)).toEqual(['paid', 'due', 'due', 'upcoming']); expect(st.arrears).toEqual({ months: ['2026-10', '2026-11'], total: 2000, unpriced: 0 });
    expect(studentStatement(w.registrar, s, '2026-11-20')).toBeNull(); expect(studentStatement(w.director, 'nope', '2026-11-20')).toBeNull();
  });
  it('lists students with arrears, biggest first, with a total, branch filter and archived flag', () => {
    const a = w.mk(w.men, '1', 'أحمد'), b = w.mk(w.women, '2', 'بلال'), c = w.mk(w.men, '3', 'جمال');
    ok(pay(w, a, '2026-09')); ok(pay(w, a, '2026-10')); ok(pay(w, a, '2026-11')); ok(pay(w, c, '2026-09')); ok(archiveStudent(w.director, c, 'انتقل'));
    const r = arrearsReport(w.director, { today: '2026-11-20' })!;
    expect(r.rows.map((x) => [x.studentNo, x.count, x.total, x.archived])).toEqual([['2', 3, 3000, false], ['3', 2, 2000, true]]); expect(r).toMatchObject({ total: 2, totalAmount: 5000 });
    expect(arrearsReport(w.director, { today: '2026-11-20', branchId: w.women })!.rows.map((x) => x.studentNo)).toEqual(['2']);
    expect(arrearsReport(w.director, { today: '2026-11-20', search: 'بلال' })!.total).toBe(1);
    expect(arrearsReport(w.registrar, { today: '2026-11-20' })).toBeNull(); void b;
  });
  it('a student who joins later owes only from his join month', () => {
    w.mk(w.men, '1', 'أحمد', { joinedOn: '2026-11-02' }); expect(arrearsReport(w.director, { today: '2026-11-20' })!.rows[0]).toMatchObject({ count: 1, total: 1000 });
  });
  it('months without a rate are counted separately and never as zero', () => {
    const w2 = world(); w2.mk(w2.men, '1', 'أحمد'); const r = arrearsReport(w2.director, { today: '2026-11-20' })!;
    expect(r.rows[0]).toMatchObject({ total: 0, unpriced: 3 }); expect(r.unpricedMonths).toBe(3);
  });
  it('pages the report', () => {
    for (let i = 1; i <= 5; i++) w.mk(w.men, String(i), 'طالب' + i);
    const p = arrearsReport(w.director, { today: '2026-11-20', limit: 2, offset: 2 })!; expect([p.rows.length, p.total]).toEqual([2, 5]);
  });
  it('summarises the current month: who owes, who paid, expected and collected', () => {
    const a = w.mk(w.men, '1', 'أحمد'), b = w.mk(w.men, '2', 'بلال'); w.mk(w.women, '3', 'جمال', { joinedOn: '2026-11-20' });
    ok(pay(w, a, '2026-11')); void b;
    expect(monthSummary(w.director, '2026-11-20')).toEqual({ month: '2026-11', rate: 1000, owing: 3, paid: 1, unpaid: 2, expected: 3000, collected: 1000 });
    expect(monthSummary(w.registrar, '2026-11-20')).toBeNull();
  });
});

describe('finance password (OD-036 option A)', () => {
  const fc = (db: ReturnType<typeof world>['db']): FinCtx => ({ db, tenantId: T, actorId: 'u1', now: NOW, argon2: FAST });
  let w: ReturnType<typeof world>; beforeEach(() => { w = world(); });
  it('is set once, needs at least 6 characters, and stores only a hash', () => {
    expect(financePasswordSet(w.db, T)).toBe(false); expect(setFinancePassword(fc(w.db), '123')).toEqual({ ok: false, error: 'weak' });
    expect(setFinancePassword(fc(w.db), '      ')).toEqual({ ok: false, error: 'weak' });
    expect(setFinancePassword(fc(w.db), 'صندوق-2026')).toEqual({ ok: true }); expect(setFinancePassword(fc(w.db), 'another1')).toEqual({ ok: false, error: 'already_set' });
    expect(JSON.stringify(w.db.prepare('SELECT * FROM finance_access').all())).not.toContain('صندوق'); expect(JSON.stringify(w.db.prepare('SELECT * FROM audit_log').all())).not.toContain('صندوق');
  });
  it('unlocks with the right password and says when it is not set', () => {
    expect(verifyFinancePassword(fc(w.db), 'x')).toEqual({ ok: false, error: 'not_set' });
    setFinancePassword(fc(w.db), 'صندوق-2026'); expect(verifyFinancePassword(fc(w.db), 'صندوق-2026')).toEqual({ ok: true }); expect(verifyFinancePassword(fc(w.db), 'خطأ-خطأ')).toMatchObject({ ok: false, error: 'wrong' });
  });
  it('slows guessing: locked after 5 wrong tries, free again after the delay, and failures are audited', () => {
    setFinancePassword(fc(w.db), 'صندوق-2026'); for (let i = 0; i < 4; i++) verifyFinancePassword(fc(w.db), 'bad-pass-1');
    expect(verifyFinancePassword(fc(w.db), 'bad-pass-1')).toEqual({ ok: false, error: 'wrong', retryAfterSeconds: 30 });
    expect(verifyFinancePassword(fc(w.db), 'صندوق-2026')).toMatchObject({ ok: false, error: 'locked' });
    clockMs += 31_000; expect(verifyFinancePassword(fc(w.db), 'صندوق-2026')).toEqual({ ok: true });
    expect((w.db.prepare("SELECT count(*) c FROM audit_log WHERE action='finance.unlock.failed'").get() as { c: number }).c).toBe(5); expect(verifyAuditLog(w.db)).toEqual({ ok: true });
  });
  it('changes the password only with the old one', () => {
    setFinancePassword(fc(w.db), 'صندوق-2026');
    expect(changeFinancePassword(fc(w.db), 'wrong-old', 'جديدة-2027')).toMatchObject({ ok: false, error: 'wrong' }); expect(changeFinancePassword(fc(w.db), 'صندوق-2026', '123')).toEqual({ ok: false, error: 'weak' });
    expect(changeFinancePassword(fc(w.db), 'صندوق-2026', 'جديدة-2027')).toEqual({ ok: true }); expect(verifyFinancePassword(fc(w.db), 'جديدة-2027')).toEqual({ ok: true });
  });
  it('can be reset with the recovery key written down at setup, and not with a wrong key', () => {
    const { key, display } = generateRecoveryKey(); storeRecoveryVerifier(w.db, T, key, '2026-09-01T08:00:00.000Z'); setFinancePassword(fc(w.db), 'صندوق-2026');
    expect(resetFinancePassword(fc(w.db), generateRecoveryKey().display, 'جديدة-2027')).toEqual({ ok: false, error: 'bad_key' }); expect(resetFinancePassword(fc(w.db), 'not a key', 'جديدة-2027')).toEqual({ ok: false, error: 'bad_key' });
    expect(resetFinancePassword(fc(w.db), display, '123')).toEqual({ ok: false, error: 'weak' });
    expect(resetFinancePassword(fc(w.db), display, 'جديدة-2027')).toEqual({ ok: true }); expect(verifyFinancePassword(fc(w.db), 'جديدة-2027')).toEqual({ ok: true });
    expect(w.db.prepare("SELECT count(*) c FROM audit_log WHERE action='finance.password.reset'").get()).toEqual({ c: 1 });
    const w2 = world(); expect(resetFinancePassword(fc(w2.db), display, 'جديدة-2027')).toEqual({ ok: false, error: 'not_set' });
  });
});
