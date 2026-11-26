/** Monthly fees (OD-034, OD-035). Pure. Money is whole dinars (integers). Months are "YYYY-MM".
 *  A student owes one fixed amount for each billable month from the month he joined until he is archived (inclusive) or the current month. */
export type Month = string;
export const isMonth = (s: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export const monthOf = (date: string): Month => date.slice(0, 7);

export function nextMonth(m: Month): Month { const [y, mo] = m.split('-').map(Number) as [number, number]; return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; }
/** Inclusive list of months from `from` to `to` (empty if from > to). */
export function monthsBetween(from: Month, to: Month): Month[] {
  const out: Month[] = []; for (let m = from; m <= to && out.length < 600; m = nextMonth(m)) out.push(m); return out;
}

export interface FeeRate { effectiveFrom: Month; amount: number }
/** The latest rate whose start month is on or before `m`; null when none applies yet. A change affects future months only (OD-035 d). */
export function rateFor(rates: FeeRate[], m: Month): number | null {
  let best: FeeRate | null = null;
  for (const r of rates) if (r.effectiveFrom <= m && (!best || r.effectiveFrom > best.effectiveFrom)) best = r;
  return best ? best.amount : null;
}

export interface YearSpan { startDate: string; endDate: string }
/** Months of the academic year, minus the months the Director marked as not billable (OD-035 a). */
export function billableMonths(year: YearSpan, freeMonths: ReadonlySet<Month>): Month[] {
  return monthsBetween(monthOf(year.startDate), monthOf(year.endDate)).filter((m) => !freeMonths.has(m));
}

export interface FeeStudent { joinedOn: string | null; createdAt: string; archivedAt: string | null }
/** First month owed: the join month, else the month the record was created (OD-035 b), never before the year starts. */
export function firstOwedMonth(s: FeeStudent, year: YearSpan): Month {
  const join = monthOf(s.joinedOn ?? s.createdAt); const start = monthOf(year.startDate);
  return join > start ? join : start;
}
/** Last month that can be owed as of `today`: owes through the month of archiving, nothing after (OD-035 c). */
export function lastOwedMonth(s: FeeStudent, year: YearSpan, today: string): Month {
  const caps = [monthOf(today), monthOf(year.endDate)]; if (s.archivedAt) caps.push(monthOf(s.archivedAt));
  return caps.reduce((a, b) => (a < b ? a : b));
}

export type MonthStatus = 'paid' | 'due' | 'upcoming' | 'free' | 'no_rate';
export interface MonthLine { month: Month; status: MonthStatus; amount: number | null; receiptNo: number | null; paidOn: string | null }
export interface PaymentRef { month: Month; receiptNo: number; paidOn: string; cancelled: boolean }

/** One line per month of the year for a student: paid / due (owed now) / upcoming (not owed yet) / free (not billable) / no_rate (cannot compute). */
export function statement(s: FeeStudent, year: YearSpan, rates: FeeRate[], free: ReadonlySet<Month>, payments: PaymentRef[], today: string): MonthLine[] {
  const live = new Map(payments.filter((p) => !p.cancelled).map((p) => [p.month, p] as const));
  const first = firstOwedMonth(s, year), last = lastOwedMonth(s, year, today);
  return monthsBetween(monthOf(year.startDate), monthOf(year.endDate)).map((m): MonthLine => {
    const amount = rateFor(rates, m); const paid = live.get(m);
    if (paid) return { month: m, status: 'paid', amount, receiptNo: paid.receiptNo, paidOn: paid.paidOn };
    if (free.has(m)) return { month: m, status: 'free', amount: null, receiptNo: null, paidOn: null };
    if (m < first || m > last) return { month: m, status: 'upcoming', amount, receiptNo: null, paidOn: null };
    if (amount === null) return { month: m, status: 'no_rate', amount: null, receiptNo: null, paidOn: null };
    return { month: m, status: 'due', amount, receiptNo: null, paidOn: null };
  });
}

/** Arrears = unpaid billable months owed up to the current month (OD-035 g). */
export function arrears(lines: MonthLine[]): { months: Month[]; total: number; unpriced: number } {
  const due = lines.filter((l) => l.status === 'due'); const unpriced = lines.filter((l) => l.status === 'no_rate').length;
  return { months: due.map((l) => l.month), total: due.reduce((a, l) => a + (l.amount ?? 0), 0), unpriced };
}

export type PaymentIssue = 'bad_month' | 'month_outside_year' | 'month_not_billable' | 'no_rate' | 'already_paid' | 'bad_date' | 'collector_required' | 'reason_required';
/** Validates a payment before it is recorded. The amount is never typed: it is the fixed rate of that month (no partial payments, OD-034). */
export function validatePayment(i: { month: Month; paidOn: string; collectorName: string }, year: YearSpan, rates: FeeRate[], free: ReadonlySet<Month>, alreadyPaid: boolean): { issue: PaymentIssue | null; amount: number | null } {
  if (!isMonth(i.month)) return { issue: 'bad_month', amount: null };
  if (i.month < monthOf(year.startDate) || i.month > monthOf(year.endDate)) return { issue: 'month_outside_year', amount: null };
  if (free.has(i.month)) return { issue: 'month_not_billable', amount: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.paidOn) || Number.isNaN(Date.parse(i.paidOn))) return { issue: 'bad_date', amount: null };
  if (!i.collectorName.trim() || [...i.collectorName].length > 100) return { issue: 'collector_required', amount: null };
  const amount = rateFor(rates, i.month); if (amount === null) return { issue: 'no_rate', amount: null };
  if (alreadyPaid) return { issue: 'already_paid', amount };
  return { issue: null, amount };
}

export const MAX_FEE_AMOUNT = 1_000_000;
export const isValidAmount = (n: number): boolean => Number.isInteger(n) && n > 0 && n <= MAX_FEE_AMOUNT;

/** Finance password policy: same minimum as sign-in passwords is too heavy for a quick cash desk, so 6 characters minimum, no composition rules. */
export const MIN_FINANCE_PASSWORD = 6;
