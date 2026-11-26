// Attendance (الحضور): typed wrappers over the IPC channels. The main process validates everything again.
export type AttStatus = 'present' | 'absent' | 'late' | 'excused';
export const ATT_LABEL: Record<AttStatus, string> = { present: 'حاضر', late: 'متأخر', absent: 'غائب', excused: 'بعذر' };
export const ATT_ORDER: AttStatus[] = ['present', 'late', 'absent', 'excused'];
export interface SheetRow { studentId: string; studentNo: string; name: string; enrollmentId: string; recordId: string | null; status: AttStatus | null; lateMinutes: number | null; note: string | null; enteredLate: boolean }
export interface Sheet {
  group: { id: string; name: string; branchId: string; branchName: string; status: 'active' | 'closed' }; date: string;
  session: { id: string; startTime: string; endTime: string; status: 'scheduled' | 'held' | 'cancelled'; cancelReason: string | null } | null; rows: SheetRow[];
}
export interface HistoryRow { studentId: string; studentNo: string; name: string; present: number; late: number; excused: number; absent: number; recorded: number }
export type AttResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export const ATT_ERROR_TEXT: Record<string, string> = {
  forbidden: 'لا تملكون صلاحية هذا الإجراء.', not_found: 'لم يعد هذا العنصر متاحاً. أعيدوا تحميل الصفحة.', invalid: 'راجعوا البيانات: الوقت (من/إلى) والدقائق والملاحظة.',
  future_date: 'لا يمكن تسجيل حضور يوم لم يأتِ بعد.', outside_year: 'هذا التاريخ خارج العام الدراسي.', group_closed: 'الفوج مغلق.', cancelled: 'هذا اليوم مُعلَّم «بلا حصة». لا يُسجَّل فيه حضور.',
  already_recorded: 'سُجّل حضور بعض هؤلاء الطلاب من قبل. أعيدوا فتح الورقة.', not_enrolled: 'بعض الطلاب لم يكونوا مسجَّلين في الفوج في ذلك اليوم.',
  has_records: 'سُجّل حضور في هذا اليوم، فلا يمكن تعليمه «بلا حصة».', already_cancelled: 'اليوم مُعلَّم «بلا حصة» من قبل.', reason_required: 'اكتبوا السبب (حتى 300 حرف).', same_status: 'لم يتغير شيء.',
};
declare global { interface Window { mishkat: { invoke(channel: string, payload?: unknown): Promise<unknown> } } }
const call = <T>(channel: string, payload?: unknown) => window.mishkat.invoke(channel, payload) as Promise<T>;
export const attApi = {
  sheet: (groupId: string, date: string) => call<{ sheet: Sheet | null }>('attendance.sheet', { groupId, date }),
  save: (groupId: string, date: string, startTime: string, endTime: string, entries: { studentId: string; status: AttStatus; lateMinutes?: number | null; note?: string | null }[]) => call<AttResult<{ saved: number }>>('attendance.save', { groupId, date, startTime, endTime, entries }),
  cancel: (groupId: string, date: string, reason: string, startTime?: string, endTime?: string) => call<AttResult>('attendance.cancel', { groupId, date, reason, startTime, endTime }),
  correct: (recordId: string, status: AttStatus, lateMinutes: number | null, reason: string) => call<AttResult>('attendance.correct', { recordId, status, lateMinutes, reason }),
  history: (groupId: string, from: string, to: string) => call<{ history: { sessions: { date: string; status: string; recorded: number }[]; students: HistoryRow[] } | null }>('attendance.history', { groupId, from, to }),
  ofStudent: (studentId: string) => call<{ totals: { present: number; late: number; excused: number; absent: number; recorded: number } | null }>('attendance.ofStudent', { studentId }),
};
