import {
  arrears, authorize, backoffSeconds, billableMonths, branchFilter, fullNameKey, isMonth, isValidAmount, isLocked, monthOf, rateFor, statement, validatePayment, MIN_FINANCE_PASSWORD,
  type FeeRate, type FeeStudent, type MonthLine, type PaymentIssue,
} from '@mishkat/domain';
import { appendAudit, newId, nowIso, type Db } from './index';
import { hashPassword, verifyPassword, type Argon2Params } from './auth';
import { checkRecoveryKey, parseRecoveryKey } from './recovery';
import type { Ctx } from './students';

/** Monthly fees use cases (OD-034, OD-035). Only the Director may use them (matrix: finance.manage); the finance password
 *  that gates the screen is enforced one layer up, in the desktop main process. Payments are append-only: cancel, never edit. */
const clock = (c: Ctx) => (c.now ?? nowIso)();
const roleOf = (c: Ctx) => c.assignments.map((a) => a.role).join(',') || 'none';
const allowed = (c: Ctx) => authorize(c.assignments, 'finance.manage', null).allowed;

export interface YearInfo { id: string; name: string; startDate: string; endDate: string }
export function activeYear(c: Ctx): YearInfo | null {
  return (c.db.prepare("SELECT id, name, start_date AS startDate, end_date AS endDate FROM academic_year WHERE tenant_id = ? AND status = 'active' AND deleted_at IS NULL").get(c.tenantId) as YearInfo | undefined) ?? null;
}
export function loadRates(c: Ctx): FeeRate[] {
  return c.db.prepare('SELECT effective_from AS effectiveFrom, amount FROM fee_rate WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY effective_from').all(c.tenantId) as FeeRate[];
}
export function loadFreeMonths(c: Ctx, yearId: string): Set<string> {
  return new Set((c.db.prepare('SELECT month FROM fee_free_month WHERE academic_year_id = ? AND deleted_at IS NULL').all(yearId) as { month: string }[]).map((r) => r.month));
}
export function feeSettings(c: Ctx): { year: YearInfo | null; rates: FeeRate[]; freeMonths: string[]; months: string[] } | null {
  if (!allowed(c)) return null;
  const year = activeYear(c); const free = year ? loadFreeMonths(c, year.id) : new Set<string>();
  return { year, rates: loadRates(c), freeMonths: [...free].sort(), months: year ? billableMonths(year, new Set()) : [] };
}

export type FinFail = 'forbidden' | 'invalid' | 'no_active_year' | 'rate_in_use' | 'month_outside_year' | 'month_has_payments' | 'not_found' | 'already_cancelled' | 'reason_required' | PaymentIssue;
export type FinResult<T = object> = ({ ok: true } & T) | { ok: false; error: FinFail };

export function setRate(c: Ctx, effectiveFrom: string, amount: number): FinResult {
  if (!allowed(c)) return { ok: false, error: 'forbidden' };
  if (!isMonth(effectiveFrom) || !isValidAmount(amount)) return { ok: false, error: 'invalid' };
  const now = clock(c); const cur = c.db.prepare('SELECT id, amount, version FROM fee_rate WHERE tenant_id = ? AND effective_from = ? AND deleted_at IS NULL').get(c.tenantId, effectiveFrom) as { id: string; amount: number; version: number } | undefined;
  if (cur && cur.amount === amount) return { ok: true };
  if (cur && c.db.prepare('SELECT 1 FROM payment WHERE tenant_id = ? AND month >= ? AND cancelled_at IS NULL LIMIT 1').get(c.tenantId, effectiveFrom)) return { ok: false, error: 'rate_in_use' }; // changing it would rewrite history
  c.db.transaction(() => {
    if (cur) c.db.prepare('UPDATE fee_rate SET amount=?, updated_at=?, updated_by=?, version=version+1 WHERE id=?').run(amount, now, c.actorId, cur.id);
    else c.db.prepare('INSERT INTO fee_rate(id,tenant_id,created_at,updated_at,created_by,updated_by,effective_from,amount) VALUES (?,?,?,?,?,?,?,?)').run(newId(), c.tenantId, now, now, c.actorId, c.actorId, effectiveFrom, amount);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: null, action: 'fee.rate.set', entity_type: 'fee_rate', entity_id: effectiveFrom, before_json: cur ? JSON.stringify({ amount: cur.amount }) : null, after_json: JSON.stringify({ effectiveFrom, amount }), reason: null });
  })();
  return { ok: true };
}

/** Marks a month of the active year as not billable (or billable again). Refused when live payments exist for that month. */
export function setFreeMonth(c: Ctx, month: string, free: boolean, reason?: string): FinResult {
  if (!allowed(c)) return { ok: false, error: 'forbidden' };
  const year = activeYear(c); if (!year) return { ok: false, error: 'no_active_year' };
  if (!isMonth(month)) return { ok: false, error: 'invalid' };
  if (month < monthOf(year.startDate) || month > monthOf(year.endDate)) return { ok: false, error: 'month_outside_year' };
  const now = clock(c); const cur = c.db.prepare('SELECT id FROM fee_free_month WHERE academic_year_id = ? AND month = ? AND deleted_at IS NULL').get(year.id, month) as { id: string } | undefined;
  if (free) {
    if (cur) return { ok: true };
    if (c.db.prepare('SELECT 1 FROM payment WHERE academic_year_id = ? AND month = ? AND cancelled_at IS NULL LIMIT 1').get(year.id, month)) return { ok: false, error: 'month_has_payments' };
  } else if (!cur) return { ok: true };
  c.db.transaction(() => {
    if (free) c.db.prepare('INSERT INTO fee_free_month(id,tenant_id,created_at,updated_at,created_by,updated_by,academic_year_id,month,reason) VALUES (?,?,?,?,?,?,?,?,?)').run(newId(), c.tenantId, now, now, c.actorId, c.actorId, year.id, month, reason?.trim() || null);
    else c.db.prepare('UPDATE fee_free_month SET deleted_at=?, deleted_by=?, updated_at=?, updated_by=?, version=version+1 WHERE id=?').run(now, c.actorId, now, c.actorId, cur!.id);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: null, action: free ? 'fee.month.free' : 'fee.month.billable', entity_type: 'fee_free_month', entity_id: month, before_json: null, after_json: JSON.stringify({ month }), reason: reason?.trim() || null });
  })();
  return { ok: true };
}

const likeOf = (t: string) => '%' + t.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
/** Same matching as the students screen: every word of the normalized name, or the student number. */
function searchClause(term: string, extra: string[] = []): { sql: string; params: string[] } {
  const words = fullNameKey(term, '').split(' ').filter(Boolean);
  const name = words.map(() => "p.search_key LIKE ? ESCAPE '\\'").join(' AND ') || '1=1';
  return { sql: `((${name}) OR s.student_no LIKE ? ESCAPE '\\'${extra.map((e) => ` OR ${e}`).join('')})`, params: [...words.map(likeOf), likeOf(term)] };
}

interface StudentLite extends FeeStudent { id: string; no: string; name: string; branchId: string; branchName: string }
function scopedStudents(c: Ctx, o: { branchId?: string; search?: string; id?: string } = {}): StudentLite[] {
  const f = branchFilter(c.assignments, 'student.view'); if (f.kind === 'none') return [];
  const where = ['s.deleted_at IS NULL', 's.tenant_id = ?']; const p: unknown[] = [c.tenantId];
  if (f.kind === 'branches') { where.push(`s.branch_id IN (${f.ids.map(() => '?').join(',')})`); p.push(...f.ids); }
  if (o.branchId) { where.push('s.branch_id = ?'); p.push(o.branchId); }
  if (o.id) { where.push('s.id = ?'); p.push(o.id); }
  if (o.search?.trim()) { const sc = searchClause(o.search.trim()); where.push(sc.sql); p.push(...sc.params); }
  return c.db.prepare(`SELECT s.id, s.student_no AS no, p.given_name || ' ' || p.family_name AS name, s.branch_id AS branchId, b.name AS branchName, s.joined_on AS joinedOn, s.created_at AS createdAt, s.archived_at AS archivedAt
    FROM student s JOIN person p ON p.id = s.person_id JOIN branch b ON b.id = s.branch_id WHERE ${where.join(' AND ')} ORDER BY p.search_key, s.student_no`).all(...p) as StudentLite[];
}
function paymentsByStudent(c: Ctx, yearId: string): Map<string, { month: string; receiptNo: number; paidOn: string; cancelled: boolean }[]> {
  const m = new Map<string, { month: string; receiptNo: number; paidOn: string; cancelled: boolean }[]>();
  for (const r of c.db.prepare('SELECT student_id AS sid, month, receipt_no AS receiptNo, paid_on AS paidOn, cancelled_at IS NOT NULL AS cancelled FROM payment WHERE academic_year_id = ?').all(yearId) as { sid: string; month: string; receiptNo: number; paidOn: string; cancelled: number }[]) {
    (m.get(r.sid) ?? m.set(r.sid, []).get(r.sid)!).push({ month: r.month, receiptNo: r.receiptNo, paidOn: r.paidOn, cancelled: !!r.cancelled });
  }
  return m;
}

export function recordPayment(c: Ctx, i: { studentId: string; month: string; paidOn: string; collectorName: string }): FinResult<{ id: string; receiptNo: number; amount: number }> {
  if (!allowed(c)) return { ok: false, error: 'forbidden' };
  const year = activeYear(c); if (!year) return { ok: false, error: 'no_active_year' };
  const s = scopedStudents(c, { id: i.studentId })[0]; if (!s) return { ok: false, error: 'not_found' };
  const rates = loadRates(c), free = loadFreeMonths(c, year.id);
  const dup = !!c.db.prepare('SELECT 1 FROM payment WHERE student_id = ? AND month = ? AND cancelled_at IS NULL').get(i.studentId, i.month);
  const v = validatePayment({ ...i, collectorName: i.collectorName.trim() }, year, rates, free, dup);
  if (v.issue || v.amount === null) return { ok: false, error: v.issue ?? 'invalid' };
  const now = clock(c); const id = newId(); let receiptNo = 0;
  c.db.transaction(() => {
    receiptNo = (c.db.prepare('SELECT coalesce(max(receipt_no), 0) + 1 AS n FROM payment WHERE academic_year_id = ?').get(year.id) as { n: number }).n;
    c.db.prepare('INSERT INTO payment(id,tenant_id,receipt_no,academic_year_id,student_id,month,amount,paid_on,collector_name,recorded_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, c.tenantId, receiptNo, year.id, i.studentId, i.month, v.amount, i.paidOn, i.collectorName.trim(), c.actorId, now);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: s.branchId, action: 'payment.record', entity_type: 'payment', entity_id: id, before_json: null, after_json: JSON.stringify({ receiptNo, student: s.no, month: i.month, amount: v.amount, paidOn: i.paidOn, collector: i.collectorName.trim() }), reason: null });
  })();
  return { ok: true, id, receiptNo, amount: v.amount };
}

/** A mistake is cancelled with a reason and then re-entered (OD-035 f). The receipt number stays in the register as cancelled. */
export function cancelPayment(c: Ctx, paymentId: string, reason: string): FinResult {
  if (!allowed(c)) return { ok: false, error: 'forbidden' };
  const why = reason.trim(); if (!why || [...why].length > 300) return { ok: false, error: 'reason_required' };
  const p = c.db.prepare('SELECT id, receipt_no AS receiptNo, student_id AS sid, month, amount, cancelled_at AS cancelledAt FROM payment WHERE id = ? AND tenant_id = ?').get(paymentId, c.tenantId) as { id: string; receiptNo: number; sid: string; month: string; amount: number; cancelledAt: string | null } | undefined;
  if (!p) return { ok: false, error: 'not_found' }; if (p.cancelledAt) return { ok: false, error: 'already_cancelled' };
  const now = clock(c);
  c.db.transaction(() => {
    c.db.prepare('UPDATE payment SET cancelled_at=?, cancelled_by=?, cancel_reason=? WHERE id=?').run(now, c.actorId, why, paymentId);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: null, action: 'payment.cancel', entity_type: 'payment', entity_id: paymentId, before_json: JSON.stringify({ receiptNo: p.receiptNo, month: p.month, amount: p.amount }), after_json: null, reason: why });
  })();
  return { ok: true };
}

export interface Receipt { id: string; receiptNo: number; yearName: string; association: string; studentName: string; studentNo: string; branchName: string; month: string; amount: number; paidOn: string; collectorName: string; cancelledAt: string | null; cancelReason: string | null }
export function getReceipt(c: Ctx, paymentId: string): Receipt | null {
  if (!allowed(c)) return null;
  return (c.db.prepare(`SELECT pay.id, pay.receipt_no AS receiptNo, y.name AS yearName, a.name AS association, p.given_name || ' ' || p.family_name AS studentName, s.student_no AS studentNo, b.name AS branchName,
    pay.month, pay.amount, pay.paid_on AS paidOn, pay.collector_name AS collectorName, pay.cancelled_at AS cancelledAt, pay.cancel_reason AS cancelReason
    FROM payment pay JOIN student s ON s.id = pay.student_id JOIN person p ON p.id = s.person_id JOIN branch b ON b.id = s.branch_id JOIN academic_year y ON y.id = pay.academic_year_id JOIN association a ON a.id = pay.tenant_id
    WHERE pay.id = ? AND pay.tenant_id = ?`).get(paymentId, c.tenantId) as Receipt | undefined) ?? null;
}

export interface PaymentRow extends Omit<Receipt, 'yearName' | 'association'> { }
export function listPayments(c: Ctx, q: { search?: string; month?: string; status?: 'live' | 'cancelled' | 'all'; limit?: number; offset?: number } = {}): { rows: PaymentRow[]; total: number } {
  if (!allowed(c)) return { rows: [], total: 0 };
  const where = ['pay.tenant_id = ?']; const p: unknown[] = [c.tenantId];
  if (q.month && isMonth(q.month)) { where.push('pay.month = ?'); p.push(q.month); }
  if ((q.status ?? 'all') === 'live') where.push('pay.cancelled_at IS NULL'); else if (q.status === 'cancelled') where.push('pay.cancelled_at IS NOT NULL');
  if (q.search?.trim()) { const sc = searchClause(q.search.trim(), ['CAST(pay.receipt_no AS TEXT) = ?']); where.push(sc.sql); p.push(...sc.params, q.search.trim()); }
  const from = `FROM payment pay JOIN student s ON s.id = pay.student_id JOIN person p ON p.id = s.person_id JOIN branch b ON b.id = s.branch_id WHERE ${where.join(' AND ')}`;
  const total = (c.db.prepare(`SELECT count(*) n ${from}`).get(...p) as { n: number }).n;
  const rows = c.db.prepare(`SELECT pay.id, pay.receipt_no AS receiptNo, p.given_name || ' ' || p.family_name AS studentName, s.student_no AS studentNo, b.name AS branchName, pay.month, pay.amount, pay.paid_on AS paidOn,
    pay.collector_name AS collectorName, pay.cancelled_at AS cancelledAt, pay.cancel_reason AS cancelReason ${from} ORDER BY pay.created_at DESC, pay.receipt_no DESC LIMIT ? OFFSET ?`)
    .all(...p, Math.min(Math.max(q.limit ?? 50, 1), 500), Math.max(q.offset ?? 0, 0)) as PaymentRow[];
  return { rows, total };
}

export function studentStatement(c: Ctx, studentId: string, today: string): { student: { id: string; no: string; name: string; branchName: string }; year: YearInfo; lines: MonthLine[]; arrears: ReturnType<typeof arrears> } | null {
  if (!allowed(c)) return null;
  const year = activeYear(c); if (!year) return null;
  const s = scopedStudents(c, { id: studentId })[0]; if (!s) return null;
  const lines = statement(s, year, loadRates(c), loadFreeMonths(c, year.id), paymentsByStudent(c, year.id).get(s.id) ?? [], today);
  return { student: { id: s.id, no: s.no, name: s.name, branchName: s.branchName }, year, lines, arrears: arrears(lines) };
}

export interface ArrearsRow { studentId: string; studentNo: string; name: string; branchName: string; archived: boolean; months: string[]; count: number; total: number; unpriced: number }
export function arrearsReport(c: Ctx, o: { today: string; branchId?: string; search?: string; limit?: number; offset?: number }): { rows: ArrearsRow[]; total: number; totalAmount: number; unpricedMonths: number } | null {
  if (!allowed(c)) return null;
  const year = activeYear(c); if (!year) return { rows: [], total: 0, totalAmount: 0, unpricedMonths: 0 };
  const rates = loadRates(c), free = loadFreeMonths(c, year.id), pays = paymentsByStudent(c, year.id);
  const all: ArrearsRow[] = [];
  for (const s of scopedStudents(c, { branchId: o.branchId, search: o.search })) {
    const a = arrears(statement(s, year, rates, free, pays.get(s.id) ?? [], o.today));
    if (a.months.length || a.unpriced) all.push({ studentId: s.id, studentNo: s.no, name: s.name, branchName: s.branchName, archived: !!s.archivedAt, months: a.months, count: a.months.length, total: a.total, unpriced: a.unpriced });
  }
  all.sort((x, y) => y.total - x.total || x.name.localeCompare(y.name, 'ar'));
  const off = Math.max(o.offset ?? 0, 0), lim = Math.min(Math.max(o.limit ?? 50, 1), 20000);
  return { rows: all.slice(off, off + lim), total: all.length, totalAmount: all.reduce((a, r) => a + r.total, 0), unpricedMonths: all.reduce((a, r) => a + r.unpriced, 0) };
}

/** The current month at a glance: how many students owe it, how many paid, and the money involved. */
export function monthSummary(c: Ctx, today: string): { month: string; rate: number | null; owing: number; paid: number; unpaid: number; expected: number; collected: number } | null {
  if (!allowed(c)) return null;
  const year = activeYear(c); const month = monthOf(today); if (!year) return null;
  const rates = loadRates(c), free = loadFreeMonths(c, year.id), pays = paymentsByStudent(c, year.id); const rate = rateFor(rates, month);
  let paid = 0, unpaid = 0, collected = 0;
  for (const s of scopedStudents(c)) {
    const l = statement(s, year, rates, free, pays.get(s.id) ?? [], today).find((x) => x.month === month);
    if (l?.status === 'paid') { paid++; collected += l.amount ?? 0; } else if (l?.status === 'due') unpaid++;
  }
  return { month, rate, owing: paid + unpaid, paid, unpaid, expected: (paid + unpaid) * (rate ?? 0), collected };
}

// ---- finance password (OD-036 option A) ----
export interface FinCtx { db: Db; tenantId: string; actorId: string; now?: () => string; argon2?: Argon2Params }
export const financePasswordSet = (db: Db, tenantId: string): boolean => !!db.prepare('SELECT 1 FROM finance_access WHERE tenant_id = ?').get(tenantId);
const fin = (c: FinCtx) => (c.now ?? nowIso)();
const finAudit = (c: FinCtx, action: string, extra: Record<string, unknown> = {}) =>
  appendAudit(c.db, { tenant_id: c.tenantId, at: fin(c), actor_id: c.actorId, actor_role: 'finance', branch_id: null, action, entity_type: 'finance_access', entity_id: c.tenantId, before_json: null, after_json: JSON.stringify(extra), reason: null });
export type PwResult = { ok: true } | { ok: false; error: 'weak' | 'already_set' | 'not_set' | 'wrong' | 'locked' | 'bad_key'; retryAfterSeconds?: number };

export function setFinancePassword(c: FinCtx, password: string): PwResult {
  if ([...password].length < MIN_FINANCE_PASSWORD || !password.trim()) return { ok: false, error: 'weak' };
  if (financePasswordSet(c.db, c.tenantId)) return { ok: false, error: 'already_set' };
  c.db.transaction(() => { c.db.prepare('INSERT INTO finance_access(tenant_id,password_hash,updated_at,updated_by) VALUES (?,?,?,?)').run(c.tenantId, hashPassword(password, c.argon2), fin(c), c.actorId); finAudit(c, 'finance.password.set'); })();
  return { ok: true };
}
export function verifyFinancePassword(c: FinCtx, password: string): PwResult {
  const r = c.db.prepare('SELECT password_hash h, failed_attempts f, locked_until l FROM finance_access WHERE tenant_id = ?').get(c.tenantId) as { h: string; f: number; l: string | null } | undefined;
  if (!r) return { ok: false, error: 'not_set' };
  const now = fin(c);
  if (isLocked(r.l, now)) return { ok: false, error: 'locked', retryAfterSeconds: Math.ceil((Date.parse(r.l!) - Date.parse(now)) / 1000) };
  if (verifyPassword(password, r.h)) { if (r.f) c.db.prepare('UPDATE finance_access SET failed_attempts = 0, locked_until = NULL WHERE tenant_id = ?').run(c.tenantId); finAudit(c, 'finance.unlock'); return { ok: true }; }
  const failed = r.f + 1, delay = backoffSeconds(failed);
  c.db.prepare('UPDATE finance_access SET failed_attempts = ?, locked_until = ? WHERE tenant_id = ?').run(failed, delay ? new Date(Date.parse(now) + delay * 1000).toISOString() : null, c.tenantId);
  finAudit(c, 'finance.unlock.failed', { failed_attempts: failed });
  return { ok: false, error: 'wrong', retryAfterSeconds: delay || undefined };
}
export function changeFinancePassword(c: FinCtx, oldPassword: string, newPassword: string): PwResult {
  const v = verifyFinancePassword(c, oldPassword); if (!v.ok) return v;
  if ([...newPassword].length < MIN_FINANCE_PASSWORD || !newPassword.trim()) return { ok: false, error: 'weak' };
  c.db.transaction(() => { c.db.prepare('UPDATE finance_access SET password_hash=?, failed_attempts=0, locked_until=NULL, updated_at=?, updated_by=? WHERE tenant_id=?').run(hashPassword(newPassword, c.argon2), fin(c), c.actorId, c.tenantId); finAudit(c, 'finance.password.changed'); })();
  return { ok: true };
}
/** Forgot the finance password: the recovery key (the same one written on paper at setup) resets it. A security event. */
export function resetFinancePassword(c: FinCtx, recoveryKeyText: string, newPassword: string): PwResult {
  if (!financePasswordSet(c.db, c.tenantId)) return { ok: false, error: 'not_set' };
  const k = parseRecoveryKey(recoveryKeyText); if (!k.ok || !checkRecoveryKey(c.db, c.tenantId, k.key)) return { ok: false, error: 'bad_key' };
  if ([...newPassword].length < MIN_FINANCE_PASSWORD || !newPassword.trim()) return { ok: false, error: 'weak' };
  c.db.transaction(() => { c.db.prepare('UPDATE finance_access SET password_hash=?, failed_attempts=0, locked_until=NULL, updated_at=?, updated_by=? WHERE tenant_id=?').run(hashPassword(newPassword, c.argon2), fin(c), c.actorId, c.tenantId); finAudit(c, 'finance.password.reset', { by: 'recovery_key' }); })();
  return { ok: true };
}
