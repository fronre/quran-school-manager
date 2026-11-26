import { describe, it, expect } from 'vitest';
import { isMonth, monthOf, nextMonth, monthsBetween, rateFor, billableMonths, firstOwedMonth, lastOwedMonth, statement, arrears, validatePayment, isValidAmount, type FeeRate, type FeeStudent } from '../src';

const YEAR = { startDate: '2026-09-01', endDate: '2027-06-30' };
const RATES: FeeRate[] = [{ effectiveFrom: '2026-09', amount: 1000 }];
const NONE = new Set<string>();
const stu = (over: Partial<FeeStudent> = {}): FeeStudent => ({ joinedOn: '2026-09-05', createdAt: '2026-09-05T08:00:00.000Z', archivedAt: null, ...over });
const st = (s: FeeStudent, today: string, pay: { month: string; receiptNo: number; paidOn: string; cancelled: boolean }[] = [], rates = RATES, free: Set<string> = NONE) => statement(s, YEAR, rates, free, pay, today);

describe('months', () => {
  it('validates and navigates months, across year ends', () => {
    expect(isMonth('2026-09')).toBe(true); for (const b of ['2026-13', '2026-00', '26-09', '2026-9', '']) expect(isMonth(b), b).toBe(false);
    expect(nextMonth('2026-12')).toBe('2027-01'); expect(nextMonth('2026-09')).toBe('2026-10'); expect(monthOf('2026-09-05')).toBe('2026-09');
    expect(monthsBetween('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']); expect(monthsBetween('2027-02', '2026-11')).toEqual([]);
  });
  it('lists the billable months of a year minus the free ones', () => {
    expect(billableMonths(YEAR, NONE)).toHaveLength(10);
    expect(billableMonths(YEAR, new Set(['2026-12', '2027-01']))).not.toContain('2027-01');
  });
});

describe('rates (OD-035 d)', () => {
  it('uses the latest rate that started on or before the month; a change never touches earlier months', () => {
    const r: FeeRate[] = [{ effectiveFrom: '2026-09', amount: 1000 }, { effectiveFrom: '2027-01', amount: 1200 }];
    expect(rateFor(r, '2026-09')).toBe(1000); expect(rateFor(r, '2026-12')).toBe(1000); expect(rateFor(r, '2027-01')).toBe(1200); expect(rateFor(r, '2027-06')).toBe(1200);
    expect(rateFor(r, '2026-08')).toBeNull(); expect(rateFor([], '2026-09')).toBeNull();
  });
  it('is independent of the order rates are given', () => {
    expect(rateFor([{ effectiveFrom: '2027-01', amount: 1200 }, { effectiveFrom: '2026-09', amount: 1000 }], '2026-10')).toBe(1000);
  });
  it('accepts only whole positive dinar amounts within a sane bound', () => {
    for (const ok of [1, 1000, 1_000_000]) expect(isValidAmount(ok)).toBe(true);
    for (const bad of [0, -5, 10.5, NaN, 1_000_001]) expect(isValidAmount(bad), String(bad)).toBe(false);
  });
});

describe('who owes what (OD-035 b, c)', () => {
  it('starts at the join month, never before the year, and falls back to the record creation month', () => {
    expect(firstOwedMonth(stu({ joinedOn: '2026-11-20' }), YEAR)).toBe('2026-11');
    expect(firstOwedMonth(stu({ joinedOn: '2020-01-01' }), YEAR)).toBe('2026-09');
    expect(firstOwedMonth(stu({ joinedOn: null, createdAt: '2026-10-03T00:00:00.000Z' }), YEAR)).toBe('2026-10');
  });
  it('stops after the archive month (inclusive) and after the year end', () => {
    expect(lastOwedMonth(stu(), YEAR, '2026-11-20')).toBe('2026-11');
    expect(lastOwedMonth(stu({ archivedAt: '2026-10-15T00:00:00.000Z' }), YEAR, '2026-11-20')).toBe('2026-10');
    expect(lastOwedMonth(stu(), YEAR, '2028-01-01')).toBe('2027-06');
  });
});

describe('statement and arrears (OD-035 g)', () => {
  it('marks paid, due, upcoming and free months, with the receipt number on paid ones', () => {
    const lines = st(stu(), '2026-11-20', [{ month: '2026-09', receiptNo: 1, paidOn: '2026-09-10', cancelled: false }], RATES, new Set(['2026-12']));
    const by = Object.fromEntries(lines.map((l) => [l.month, l.status]));
    expect(by['2026-09']).toBe('paid'); expect(by['2026-10']).toBe('due'); expect(by['2026-11']).toBe('due'); expect(by['2026-12']).toBe('free'); expect(by['2027-01']).toBe('upcoming');
    expect(lines[0]).toMatchObject({ receiptNo: 1, paidOn: '2026-09-10', amount: 1000 });
    expect(arrears(lines)).toEqual({ months: ['2026-10', '2026-11'], total: 2000, unpriced: 0 });
  });
  it('a cancelled payment leaves the month unpaid again', () => {
    const lines = st(stu(), '2026-09-20', [{ month: '2026-09', receiptNo: 1, paidOn: '2026-09-10', cancelled: true }]);
    expect(lines[0]!.status).toBe('due'); expect(arrears(lines).total).toBe(1000);
  });
  it('a student who joined late owes nothing before joining; one who left owes nothing after', () => {
    expect(arrears(st(stu({ joinedOn: '2026-11-02' }), '2026-12-10')).months).toEqual(['2026-11', '2026-12']);
    expect(arrears(st(stu({ archivedAt: '2026-10-31T10:00:00.000Z' }), '2027-03-01')).months).toEqual(['2026-09', '2026-10']);
  });
  it('a free (non-billable) month is never owed, even if it would otherwise be due', () => {
    expect(arrears(st(stu(), '2026-12-10', [], RATES, new Set(['2026-10']))).months).toEqual(['2026-09', '2026-11', '2026-12']);
  });
  it('without a rate the month cannot be priced and is reported separately, not as zero', () => {
    const lines = st(stu(), '2026-11-10', [], [{ effectiveFrom: '2026-10', amount: 900 }]);
    expect(lines[0]!.status).toBe('no_rate'); expect(arrears(lines)).toEqual({ months: ['2026-10', '2026-11'], total: 1800, unpriced: 1 });
  });
  it('a rate change prices each month by its own rate', () => {
    const rates: FeeRate[] = [{ effectiveFrom: '2026-09', amount: 1000 }, { effectiveFrom: '2026-11', amount: 1500 }];
    expect(arrears(st(stu(), '2026-11-10', [], rates)).total).toBe(1000 + 1000 + 1500);
  });
  it('no arrears for a student who is fully paid up', () => {
    const pay = ['2026-09', '2026-10', '2026-11'].map((m, i) => ({ month: m, receiptNo: i + 1, paidOn: `${m}-05`, cancelled: false }));
    expect(arrears(st(stu(), '2026-11-30', pay))).toEqual({ months: [], total: 0, unpriced: 0 });
  });
});

describe('validatePayment (OD-034)', () => {
  const ok = { month: '2026-10', paidOn: '2026-10-05', collectorName: 'أمين الصندوق' };
  it('takes the amount from the month\'s rate; the user never types it', () => { expect(validatePayment(ok, YEAR, RATES, NONE, false)).toEqual({ issue: null, amount: 1000 }); });
  it('rejects bad months, months outside the year and free months', () => {
    expect(validatePayment({ ...ok, month: '2026-13' }, YEAR, RATES, NONE, false).issue).toBe('bad_month');
    expect(validatePayment({ ...ok, month: '2026-08' }, YEAR, RATES, NONE, false).issue).toBe('month_outside_year');
    expect(validatePayment({ ...ok, month: '2027-07' }, YEAR, RATES, NONE, false).issue).toBe('month_outside_year');
    expect(validatePayment(ok, YEAR, RATES, new Set(['2026-10']), false).issue).toBe('month_not_billable');
  });
  it('rejects a second payment of the same month, a missing rate, a bad date and a missing collector name', () => {
    expect(validatePayment(ok, YEAR, RATES, NONE, true).issue).toBe('already_paid');
    expect(validatePayment(ok, YEAR, [], NONE, false).issue).toBe('no_rate');
    expect(validatePayment({ ...ok, paidOn: '10/10/2026' }, YEAR, RATES, NONE, false).issue).toBe('bad_date');
    expect(validatePayment({ ...ok, collectorName: '  ' }, YEAR, RATES, NONE, false).issue).toBe('collector_required');
    expect(validatePayment({ ...ok, collectorName: 'ا'.repeat(101) }, YEAR, RATES, NONE, false).issue).toBe('collector_required');
  });
  it('allows paying a future month of the same year in advance', () => { expect(validatePayment({ ...ok, month: '2027-03' }, YEAR, RATES, NONE, false).issue).toBeNull(); });
});
