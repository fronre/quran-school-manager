import { authorize } from '@mishkat/domain';
import { appendAudit, newId, nowIso } from './index';
import type { Ctx } from './students';

/** Attendance (REQ: attendance references a valid enrollment and session; corrections are explicit records, never silent edits).
 *  One session per group per day. A sheet lists the students enrolled in the group ON THAT DATE; each student is recorded once per session (BR-027).
 *  Provisional choices are listed in OD-042. */
export const ATT_STATUSES = ['present', 'absent', 'late', 'excused'] as const;
export type AttStatus = (typeof ATT_STATUSES)[number];
export const ATT_STATUS_AR: Record<AttStatus, string> = { present: 'حاضر', absent: 'غائب', late: 'متأخر', excused: 'غائب بعذر' };

export type AttFail = 'forbidden' | 'not_found' | 'invalid' | 'future_date' | 'outside_year' | 'group_closed' | 'cancelled' | 'already_recorded' | 'not_enrolled' | 'has_records' | 'already_cancelled' | 'reason_required' | 'same_status' | 'no_session';
export type AttResult<T = object> = ({ ok: true } & T) | { ok: false; error: AttFail };

export interface SheetRow { studentId: string; studentNo: string; name: string; enrollmentId: string; recordId: string | null; status: AttStatus | null; lateMinutes: number | null; note: string | null; enteredLate: boolean }
export interface Sheet {
  group: { id: string; name: string; branchId: string; branchName: string; status: 'active' | 'closed' };
  date: string; session: { id: string; startTime: string; endTime: string; status: 'scheduled' | 'held' | 'cancelled'; cancelReason: string | null } | null; rows: SheetRow[];
}
export interface EntryInput { studentId: string; status: AttStatus; lateMinutes?: number | null; note?: string | null }

const clock = (c: Ctx) => (c.now ?? nowIso)();
const today = (c: Ctx) => clock(c).slice(0, 10);
const roleOf = (c: Ctx) => c.assignments.map((a) => a.role).join(',') || 'none';
const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
const isTime = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

interface G { id: string; name: string; branchId: string; branchName: string; status: 'active' | 'closed'; yearStart: string; yearEnd: string }
function groupFor(c: Ctx, id: string): G | null {
  return (c.db.prepare(`SELECT g.id, g.name, g.branch_id AS branchId, b.name AS branchName, g.status, y.start_date AS yearStart, y.end_date AS yearEnd FROM study_group g JOIN branch b ON b.id = g.branch_id JOIN academic_year y ON y.id = g.academic_year_id
    WHERE g.id = ? AND g.tenant_id = ? AND g.deleted_at IS NULL`).get(id, c.tenantId) as G | undefined) ?? null;
}
const sessionOf = (c: Ctx, groupId: string, date: string) => c.db.prepare('SELECT id, start_time AS startTime, end_time AS endTime, status, cancel_reason AS cancelReason FROM session WHERE group_id = ? AND session_date = ? AND deleted_at IS NULL')
  .get(groupId, date) as { id: string; startTime: string; endTime: string; status: 'scheduled' | 'held' | 'cancelled'; cancelReason: string | null } | undefined;

/** The attendance sheet of a group for one date: who was enrolled that day and what has been recorded. */
export function getSheet(c: Ctx, groupId: string, date: string): Sheet | null {
  const g = groupFor(c, groupId); if (!g || !authorize(c.assignments, 'attendance.view', g.branchId).allowed || !isDate(date)) return null; // out of scope looks absent
  const s = sessionOf(c, groupId, date);
  const rows = c.db.prepare(`SELECT st.id AS studentId, st.student_no AS studentNo, p.given_name || ' ' || p.family_name AS name, e.id AS enrollmentId,
      a.id AS recordId, a.status AS status, a.late_minutes AS lateMinutes, a.note AS note, ifnull(a.entered_late, 0) AS enteredLate
    FROM enrollment e JOIN student st ON st.id = e.student_id JOIN person p ON p.id = st.person_id
    LEFT JOIN attendance_record a ON a.enrollment_id = e.id AND a.session_id = ? AND a.deleted_at IS NULL
    WHERE e.group_id = ? AND e.deleted_at IS NULL AND e.start_date <= ? AND ifnull(e.end_date, '9999-12-31') >= ?
      AND (a.id IS NOT NULL OR (st.status = 'active' AND st.archived_at IS NULL AND st.deleted_at IS NULL))
    ORDER BY p.search_key`).all(s?.id ?? '', groupId, date, date) as (Omit<SheetRow, 'enteredLate'> & { enteredLate: number })[];
  return { group: { id: g.id, name: g.name, branchId: g.branchId, branchName: g.branchName, status: g.status }, date, session: s ?? null, rows: rows.map((r) => ({ ...r, enteredLate: !!r.enteredLate })) };
}

function checkEntry(e: EntryInput): boolean {
  if (!(ATT_STATUSES as readonly string[]).includes(e.status)) return false;
  if (e.status === 'late') { if (e.lateMinutes != null && (!Number.isInteger(e.lateMinutes) || e.lateMinutes < 1 || e.lateMinutes > 600)) return false; } else if (e.lateMinutes != null) return false;
  return !e.note || [...e.note].length <= 300;
}

/** Records the sheet for a day. Creates the day's session when needed. All-or-nothing: students already recorded are rejected (change them with a correction). */
export function saveSheet(c: Ctx, groupId: string, date: string, times: { startTime: string; endTime: string }, entries: EntryInput[]): AttResult<{ saved: number }> {
  const g = groupFor(c, groupId); if (!g || !authorize(c.assignments, 'attendance.view', g.branchId).allowed) return { ok: false, error: 'not_found' };
  if (!authorize(c.assignments, 'attendance.record', g.branchId).allowed) return { ok: false, error: 'forbidden' };
  if (!isDate(date) || !isTime(times.startTime) || !isTime(times.endTime) || times.startTime >= times.endTime || entries.length === 0 || entries.length > 1000 || !entries.every(checkEntry)) return { ok: false, error: 'invalid' };
  if (new Set(entries.map((e) => e.studentId)).size !== entries.length) return { ok: false, error: 'invalid' };
  const now = clock(c), t = today(c);
  if (date > t) return { ok: false, error: 'future_date' };
  if (date < g.yearStart || date > g.yearEnd) return { ok: false, error: 'outside_year' };
  if (g.status === 'closed') return { ok: false, error: 'group_closed' };
  let s = sessionOf(c, groupId, date); if (s?.status === 'cancelled') return { ok: false, error: 'cancelled' };
  const enrolled = new Map((c.db.prepare(`SELECT e.student_id AS sid, e.id AS eid FROM enrollment e JOIN student st ON st.id = e.student_id
    WHERE e.group_id = ? AND e.deleted_at IS NULL AND e.start_date <= ? AND ifnull(e.end_date, '9999-12-31') >= ? AND st.status = 'active' AND st.archived_at IS NULL`).all(groupId, date, date) as { sid: string; eid: string }[]).map((r) => [r.sid, r.eid]));
  if (!entries.every((e) => enrolled.has(e.studentId))) return { ok: false, error: 'not_enrolled' };
  const sid0 = s?.id;
  if (sid0 && entries.some((e) => c.db.prepare('SELECT 1 FROM attendance_record WHERE session_id = ? AND student_id = ? AND deleted_at IS NULL').get(sid0, e.studentId))) return { ok: false, error: 'already_recorded' };
  const late = date < t ? 1 : 0; // entered after the day: kept visible in reports
  c.db.transaction(() => {
    if (!s) {
      const id = newId();
      c.db.prepare('INSERT INTO session(id,tenant_id,created_at,updated_at,created_by,updated_by,group_id,branch_id,session_date,start_time,end_time,status,confirmed_at,confirmed_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, c.tenantId, now, now, c.actorId, c.actorId, groupId, g.branchId, date, times.startTime, times.endTime, 'held', now, c.actorId);
      s = { id, startTime: times.startTime, endTime: times.endTime, status: 'held', cancelReason: null };
    } else if (s.status !== 'held') {
      c.db.prepare("UPDATE session SET status='held', confirmed_at=?, confirmed_by=?, updated_at=?, updated_by=?, version=version+1 WHERE id=?").run(now, c.actorId, now, c.actorId, s.id);
    }
    const ins = c.db.prepare('INSERT INTO attendance_record(id,tenant_id,created_at,updated_at,created_by,updated_by,session_id,student_id,group_id,branch_id,enrollment_id,status,late_minutes,note,entered_late,recorded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const e of entries) ins.run(newId(), c.tenantId, now, now, c.actorId, c.actorId, s!.id, e.studentId, groupId, g.branchId, enrolled.get(e.studentId), e.status, e.status === 'late' ? e.lateMinutes ?? null : null, e.note?.trim() || null, late, c.actorId);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: g.branchId, action: 'attendance.record', entity_type: 'session', entity_id: s!.id, before_json: null,
      after_json: JSON.stringify({ groupId, date, count: entries.length, counts: ATT_STATUSES.map((k) => [k, entries.filter((e) => e.status === k).length]) }), reason: null });
  })();
  return { ok: true, saved: entries.length };
}

/** Marks a day as "no class" (holiday, rain...). Only when nothing has been recorded for it. */
export function cancelSession(c: Ctx, groupId: string, date: string, reason: string, times = { startTime: '16:00', endTime: '17:00' }): AttResult {
  const g = groupFor(c, groupId); if (!g || !authorize(c.assignments, 'attendance.view', g.branchId).allowed) return { ok: false, error: 'not_found' };
  if (!authorize(c.assignments, 'attendance.record', g.branchId).allowed) return { ok: false, error: 'forbidden' };
  const why = reason.trim(); if (!why || [...why].length > 300) return { ok: false, error: 'reason_required' };
  if (!isDate(date) || !isTime(times.startTime) || !isTime(times.endTime) || times.startTime >= times.endTime) return { ok: false, error: 'invalid' };
  if (date < g.yearStart || date > g.yearEnd) return { ok: false, error: 'outside_year' };
  const s = sessionOf(c, groupId, date); if (s?.status === 'cancelled') return { ok: false, error: 'already_cancelled' };
  if (s && c.db.prepare('SELECT 1 FROM attendance_record WHERE session_id = ? AND deleted_at IS NULL').get(s.id)) return { ok: false, error: 'has_records' };
  const now = clock(c);
  c.db.transaction(() => {
    let id = s?.id;
    if (s) c.db.prepare("UPDATE session SET status='cancelled', cancel_reason=?, updated_at=?, updated_by=?, version=version+1 WHERE id=?").run(why, now, c.actorId, s.id);
    else { id = newId(); c.db.prepare("INSERT INTO session(id,tenant_id,created_at,updated_at,created_by,updated_by,group_id,branch_id,session_date,start_time,end_time,status,cancel_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,'cancelled',?)").run(id, c.tenantId, now, now, c.actorId, c.actorId, groupId, g.branchId, date, times.startTime, times.endTime, why); }
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: g.branchId, action: 'session.cancel', entity_type: 'session', entity_id: id!, before_json: null, after_json: JSON.stringify({ groupId, date }), reason: why });
  })();
  return { ok: true };
}

/** A correction is a separate, permanent record (old status, new status, reason, who, when); the record itself carries the current value. */
export function correctRecord(c: Ctx, recordId: string, status: AttStatus, lateMinutes: number | null, reason: string): AttResult {
  const r = c.db.prepare('SELECT id, group_id AS groupId, branch_id AS branchId, status, late_minutes AS lateMinutes FROM attendance_record WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(recordId, c.tenantId) as { id: string; groupId: string; branchId: string; status: AttStatus; lateMinutes: number | null } | undefined;
  if (!r || !authorize(c.assignments, 'attendance.view', r.branchId).allowed) return { ok: false, error: 'not_found' };
  if (!authorize(c.assignments, 'attendance.correct', r.branchId).allowed) return { ok: false, error: 'forbidden' };
  const why = reason.trim(); if (!why || [...why].length > 300) return { ok: false, error: 'reason_required' };
  if (!checkEntry({ studentId: '', status, lateMinutes })) return { ok: false, error: 'invalid' };
  if (r.status === status && (r.lateMinutes ?? null) === (status === 'late' ? lateMinutes : null)) return { ok: false, error: 'same_status' };
  const now = clock(c);
  c.db.transaction(() => {
    if (r.status !== status) c.db.prepare('INSERT INTO attendance_correction(id,tenant_id,attendance_id,old_status,new_status,reason,corrected_by,corrected_at) VALUES (?,?,?,?,?,?,?,?)').run(newId(), c.tenantId, r.id, r.status, status, why, c.actorId, now);
    c.db.prepare('UPDATE attendance_record SET status=?, late_minutes=?, updated_at=?, updated_by=?, version=version+1 WHERE id=?').run(status, status === 'late' ? lateMinutes : null, now, c.actorId, r.id);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: r.branchId, action: 'attendance.correct', entity_type: 'attendance_record', entity_id: r.id, before_json: JSON.stringify({ status: r.status, lateMinutes: r.lateMinutes }), after_json: JSON.stringify({ status, lateMinutes: status === 'late' ? lateMinutes : null }), reason: why });
  })();
  return { ok: true };
}

export interface HistoryRow { studentId: string; studentNo: string; name: string; present: number; late: number; excused: number; absent: number; recorded: number }
/** Per-student totals for a group over a date range (held sessions only), plus the list of days. */
export function groupHistory(c: Ctx, groupId: string, from: string, to: string): { sessions: { date: string; status: string; recorded: number }[]; students: HistoryRow[] } | null {
  const g = groupFor(c, groupId); if (!g || !authorize(c.assignments, 'attendance.view', g.branchId).allowed || !isDate(from) || !isDate(to) || from > to) return null;
  const sessions = c.db.prepare(`SELECT s.session_date AS date, s.status AS status, (SELECT count(*) FROM attendance_record a WHERE a.session_id = s.id AND a.deleted_at IS NULL) AS recorded
    FROM session s WHERE s.group_id = ? AND s.deleted_at IS NULL AND s.session_date BETWEEN ? AND ? ORDER BY s.session_date DESC`).all(groupId, from, to) as { date: string; status: string; recorded: number }[];
  const students = c.db.prepare(`SELECT st.id AS studentId, st.student_no AS studentNo, p.given_name || ' ' || p.family_name AS name,
      sum(a.status = 'present') AS present, sum(a.status = 'late') AS late, sum(a.status = 'excused') AS excused, sum(a.status = 'absent') AS absent, count(a.id) AS recorded
    FROM attendance_record a JOIN session s ON s.id = a.session_id JOIN student st ON st.id = a.student_id JOIN person p ON p.id = st.person_id
    WHERE a.group_id = ? AND a.deleted_at IS NULL AND s.deleted_at IS NULL AND s.status = 'held' AND s.session_date BETWEEN ? AND ? GROUP BY st.id ORDER BY p.search_key`).all(groupId, from, to) as HistoryRow[];
  return { sessions, students };
}

/** Attendance totals for one student this academic year (for the student's profile). */
export function studentAttendance(c: Ctx, studentId: string): { present: number; late: number; excused: number; absent: number; recorded: number } | null {
  const s = c.db.prepare('SELECT branch_id AS b FROM student WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(studentId, c.tenantId) as { b: string } | undefined;
  if (!s || !authorize(c.assignments, 'attendance.view', s.b).allowed) return null;
  const r = c.db.prepare(`SELECT ifnull(sum(a.status = 'present'), 0) AS present, ifnull(sum(a.status = 'late'), 0) AS late, ifnull(sum(a.status = 'excused'), 0) AS excused, ifnull(sum(a.status = 'absent'), 0) AS absent, count(a.id) AS recorded
    FROM attendance_record a JOIN session s ON s.id = a.session_id JOIN study_group g ON g.id = a.group_id JOIN academic_year y ON y.id = g.academic_year_id AND y.status = 'active'
    WHERE a.student_id = ? AND a.deleted_at IS NULL AND s.status = 'held'`).get(studentId) as { present: number; late: number; excused: number; absent: number; recorded: number };
  return r;
}

export interface TodayRow { groupId: string; groupName: string; branchName: string; members: number; recorded: number; state: 'not_recorded' | 'partial' | 'done' | 'cancelled' }
/** For the home page: every active group of the active year the caller can see, with the state of attendance for the given day. */
export function todayOverview(c: Ctx, date: string): TodayRow[] {
  if (!isDate(date)) return [];
  const rows = c.db.prepare(`SELECT g.id AS groupId, g.name AS groupName, b.name AS branchName, g.branch_id AS branchId,
      (SELECT count(*) FROM enrollment e JOIN student st ON st.id = e.student_id WHERE e.group_id = g.id AND e.deleted_at IS NULL AND e.start_date <= @d AND ifnull(e.end_date, '9999-12-31') >= @d AND st.status = 'active' AND st.archived_at IS NULL) AS members,
      (SELECT s.status FROM session s WHERE s.group_id = g.id AND s.session_date = @d AND s.deleted_at IS NULL) AS sstatus,
      (SELECT count(*) FROM attendance_record a JOIN session s ON s.id = a.session_id WHERE s.group_id = g.id AND s.session_date = @d AND a.deleted_at IS NULL) AS recorded
    FROM study_group g JOIN branch b ON b.id = g.branch_id JOIN academic_year y ON y.id = g.academic_year_id
    WHERE g.tenant_id = @t AND g.deleted_at IS NULL AND g.status = 'active' AND y.status = 'active' AND @d BETWEEN y.start_date AND y.end_date ORDER BY b.position, g.name`).all({ d: date, t: c.tenantId }) as (Omit<TodayRow, 'state'> & { branchId: string; sstatus: string | null })[];
  return rows.filter((r) => r.members > 0 && authorize(c.assignments, 'attendance.view', r.branchId).allowed)
    .map((r) => ({ groupId: r.groupId, groupName: r.groupName, branchName: r.branchName, members: r.members, recorded: r.recorded, state: r.sstatus === 'cancelled' ? 'cancelled' as const : r.recorded === 0 ? 'not_recorded' as const : r.recorded < r.members ? 'partial' as const : 'done' as const }));
}
