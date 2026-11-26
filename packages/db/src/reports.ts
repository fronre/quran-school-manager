import { branchFilter, type BranchFilter } from '@mishkat/domain';
import type { Ctx } from './students';

/** Standard reports (REQ-070, REQ-045, REQ-024). Read-only. Branch-scoped like everything else.
 *  Enrollment is available to anyone with report.view OR report.view_limited (registrar); attendance and activity need report.view (OD-043). */
export type ReportFail = 'forbidden' | 'invalid';
export type ReportResult<T> = ({ ok: true } & T) | { ok: false; error: ReportFail };

const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
function scope(f: BranchFilter, col: string, branchId?: string): { sql: string; p: unknown[] } | null {
  if (f.kind === 'none') return null;
  const where: string[] = []; const p: unknown[] = [];
  if (f.kind === 'branches') { where.push(`${col} IN (${f.ids.map(() => '?').join(',')})`); p.push(...f.ids); }
  if (branchId) { if (f.kind === 'branches' && !f.ids.includes(branchId)) return null; where.push(`${col} = ?`); p.push(branchId); }
  return { sql: where.length ? ' AND ' + where.join(' AND ') : '', p };
}

export interface EnrollmentRow { groupId: string; groupName: string; branchName: string; level: string | null; capacity: number; students: number; teachers: string }
export interface EnrollmentReport { year: string | null; groups: EnrollmentRow[]; totals: { students: number; unassigned: number; groups: number } }

/** Students per group, plus how many active students still have no group (per caller's branches). */
export function enrollmentReport(c: Ctx, q: { branchId?: string } = {}): ReportResult<{ report: EnrollmentReport }> {
  const f1 = branchFilter(c.assignments, 'report.view'), f2 = branchFilter(c.assignments, 'report.view_limited');
  const f: BranchFilter = f1.kind !== 'none' ? f1 : f2; const sc = scope(f, 'g.branch_id', q.branchId);
  if (!sc) return { ok: false, error: 'forbidden' };
  const y = c.db.prepare("SELECT id, name FROM academic_year WHERE tenant_id = ? AND status = 'active' AND deleted_at IS NULL").get(c.tenantId) as { id: string; name: string } | undefined;
  if (!y) return { ok: true, report: { year: null, groups: [], totals: { students: 0, unassigned: 0, groups: 0 } } };
  const groups = c.db.prepare(`SELECT g.id AS groupId, g.name AS groupName, b.name AS branchName, g.level, g.capacity,
      (SELECT count(*) FROM enrollment e WHERE e.group_id = g.id AND e.end_date IS NULL AND e.deleted_at IS NULL) AS students,
      ifnull((SELECT group_concat(p.given_name || ' ' || p.family_name, '، ') FROM group_teacher t JOIN staff_member m ON m.id = t.staff_member_id JOIN person p ON p.id = m.person_id WHERE t.group_id = g.id AND t.deleted_at IS NULL), '') AS teachers
    FROM study_group g JOIN branch b ON b.id = g.branch_id WHERE g.tenant_id = ? AND g.academic_year_id = ? AND g.deleted_at IS NULL AND g.status = 'active'${sc.sql} ORDER BY b.position, g.name`).all(c.tenantId, y.id, ...sc.p) as EnrollmentRow[];
  const sc2 = scope(f, 's.branch_id', q.branchId)!;
  const unassigned = (c.db.prepare(`SELECT count(*) AS n FROM student s WHERE s.tenant_id = ? AND s.status = 'active' AND s.archived_at IS NULL AND s.deleted_at IS NULL${sc2.sql}
    AND NOT EXISTS (SELECT 1 FROM enrollment e WHERE e.student_id = s.id AND e.academic_year_id = ? AND e.end_date IS NULL AND e.deleted_at IS NULL)`).get(c.tenantId, ...sc2.p, y.id) as { n: number }).n;
  return { ok: true, report: { year: y.name, groups, totals: { students: groups.reduce((a, g) => a + g.students, 0), unassigned, groups: groups.length } } };
}

export interface AttendanceReportRow { studentId: string; studentNo: string; name: string; groupName: string; branchName: string; present: number; late: number; excused: number; absent: number; recorded: number; ratePct: number | null }
/** Attendance rate = (present + late) / recorded days, as a whole percent; excused counts as recorded but not attended (OD-043). */
export function attendanceReport(c: Ctx, q: { branchId?: string; groupId?: string; from: string; to: string }): ReportResult<{ rows: AttendanceReportRow[]; heldSessions: number }> {
  if (!isDate(q.from) || !isDate(q.to) || q.from > q.to) return { ok: false, error: 'invalid' };
  const sc = scope(branchFilter(c.assignments, 'report.view'), 'a.branch_id', q.branchId); if (!sc) return { ok: false, error: 'forbidden' };
  const gsql = q.groupId ? ' AND a.group_id = ?' : ''; const gp = q.groupId ? [q.groupId] : [];
  const rows = (c.db.prepare(`SELECT st.id AS studentId, st.student_no AS studentNo, p.given_name || ' ' || p.family_name AS name, g.name AS groupName, b.name AS branchName,
      sum(a.status = 'present') AS present, sum(a.status = 'late') AS late, sum(a.status = 'excused') AS excused, sum(a.status = 'absent') AS absent, count(a.id) AS recorded
    FROM attendance_record a JOIN session s ON s.id = a.session_id JOIN student st ON st.id = a.student_id JOIN person p ON p.id = st.person_id JOIN study_group g ON g.id = a.group_id JOIN branch b ON b.id = a.branch_id
    WHERE a.tenant_id = ? AND a.deleted_at IS NULL AND s.deleted_at IS NULL AND s.status = 'held' AND s.session_date BETWEEN ? AND ?${sc.sql}${gsql}
    GROUP BY st.id, g.id ORDER BY b.position, g.name, p.search_key`).all(c.tenantId, q.from, q.to, ...sc.p, ...gp) as Omit<AttendanceReportRow, 'ratePct'>[])
    .map((r) => ({ ...r, ratePct: r.recorded ? Math.round(((r.present + r.late) / r.recorded) * 100) : null }));
  const sc3 = scope(branchFilter(c.assignments, 'report.view'), 's.branch_id', q.branchId)!;
  const held = (c.db.prepare(`SELECT count(*) AS n FROM session s WHERE s.tenant_id = ? AND s.deleted_at IS NULL AND s.status = 'held' AND s.session_date BETWEEN ? AND ?${sc3.sql}${q.groupId ? ' AND s.group_id = ?' : ''}`).get(c.tenantId, q.from, q.to, ...sc3.p, ...gp) as { n: number }).n;
  return { ok: true, rows, heldSessions: held };
}

export interface GroupActivityRow { groupId: string; groupName: string; branchName: string; teachers: string; held: number; cancelled: number; recorded: number }
/** Per group: days held, days marked "no class", and attendance entries made. Records are not tied to one teacher (shared login), so the teachers shown are those assigned to the group. */
export function activityReport(c: Ctx, q: { branchId?: string; from: string; to: string }): ReportResult<{ rows: GroupActivityRow[] }> {
  if (!isDate(q.from) || !isDate(q.to) || q.from > q.to) return { ok: false, error: 'invalid' };
  const sc = scope(branchFilter(c.assignments, 'report.view'), 'g.branch_id', q.branchId); if (!sc) return { ok: false, error: 'forbidden' };
  const rows = c.db.prepare(`SELECT g.id AS groupId, g.name AS groupName, b.name AS branchName,
      ifnull((SELECT group_concat(p.given_name || ' ' || p.family_name, '، ') FROM group_teacher t JOIN staff_member m ON m.id = t.staff_member_id JOIN person p ON p.id = m.person_id WHERE t.group_id = g.id AND t.deleted_at IS NULL), '') AS teachers,
      (SELECT count(*) FROM session s WHERE s.group_id = g.id AND s.deleted_at IS NULL AND s.status = 'held' AND s.session_date BETWEEN ? AND ?) AS held,
      (SELECT count(*) FROM session s WHERE s.group_id = g.id AND s.deleted_at IS NULL AND s.status = 'cancelled' AND s.session_date BETWEEN ? AND ?) AS cancelled,
      (SELECT count(*) FROM attendance_record a JOIN session s ON s.id = a.session_id WHERE a.group_id = g.id AND a.deleted_at IS NULL AND s.status = 'held' AND s.session_date BETWEEN ? AND ?) AS recorded
    FROM study_group g JOIN branch b ON b.id = g.branch_id WHERE g.tenant_id = ? AND g.deleted_at IS NULL${sc.sql} ORDER BY b.position, g.name`)
    .all(q.from, q.to, q.from, q.to, q.from, q.to, c.tenantId, ...sc.p) as GroupActivityRow[];
  return { ok: true, rows };
}
