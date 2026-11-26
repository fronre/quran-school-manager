import { authorize } from '@mishkat/domain';
import { appendAudit, newId, nowIso } from './index';
import type { Ctx } from './students';

/** End of academic year (OD-025, default: explicit, audited, nothing automatic). Closing the year ends every open enrollment at the end of the year (reason "year_end"), closes the year
 *  and opens the new one; groups (and their teachers) can be copied; students are NOT moved on their own: a carry-over step, group by group, enrolls them in the new year.
 *  Unpaid months of the closed year stay in that year's records. */
export type YearFail = 'forbidden' | 'invalid' | 'dates' | 'duplicate_name' | 'overlap' | 'not_found' | 'group_closed' | 'branch_mismatch' | 'not_closed_year' | 'no_active_year';
export type YearResult<T = object> = ({ ok: true } & T) | { ok: false; error: YearFail };

const clock = (c: Ctx) => (c.now ?? nowIso)();
const roleOf = (c: Ctx) => c.assignments.map((a) => a.role).join(',') || 'none';
const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
const activeYear = (c: Ctx) => c.db.prepare("SELECT id, name, start_date AS startDate, end_date AS endDate FROM academic_year WHERE tenant_id = ? AND status = 'active' AND deleted_at IS NULL").get(c.tenantId) as { id: string; name: string; startDate: string; endDate: string } | undefined;

export interface YearOverview { year: { id: string; name: string; startDate: string; endDate: string } | null; groups: number; openEnrollments: number; closedYears: { id: string; name: string }[] }
export function yearOverview(c: Ctx): YearOverview | null {
  if (!authorize(c.assignments, 'settings.manage', null).allowed) return null;
  const y = activeYear(c) ?? null;
  const groups = y ? (c.db.prepare("SELECT count(*) n FROM study_group WHERE academic_year_id = ? AND deleted_at IS NULL AND status = 'active'").get(y.id) as { n: number }).n : 0;
  const open = y ? (c.db.prepare('SELECT count(*) n FROM enrollment WHERE academic_year_id = ? AND end_date IS NULL AND deleted_at IS NULL').get(y.id) as { n: number }).n : 0;
  return { year: y, groups, openEnrollments: open, closedYears: c.db.prepare("SELECT id, name FROM academic_year WHERE tenant_id = ? AND status = 'closed' AND deleted_at IS NULL ORDER BY end_date DESC").all(c.tenantId) as { id: string; name: string }[] };
}

export interface NewYearInput { name: string; startDate: string; endDate: string; copyGroups: boolean }
export function startNewYear(c: Ctx, i: NewYearInput): YearResult<{ yearId: string; copiedGroups: number; endedEnrollments: number }> {
  if (!authorize(c.assignments, 'settings.manage', null).allowed) return { ok: false, error: 'forbidden' };
  const name = i.name.trim(); if (!name || [...name].length > 300) return { ok: false, error: 'invalid' };
  if (!isDate(i.startDate) || !isDate(i.endDate) || i.startDate >= i.endDate) return { ok: false, error: 'dates' };
  const old = activeYear(c); if (!old) return { ok: false, error: 'no_active_year' };
  if (i.startDate <= old.endDate) return { ok: false, error: 'overlap' }; // the new year must begin after the closing one ends
  if (c.db.prepare('SELECT 1 FROM academic_year WHERE tenant_id = ? AND name = ? AND deleted_at IS NULL').get(c.tenantId, name)) return { ok: false, error: 'duplicate_name' };
  if (c.db.prepare('SELECT 1 FROM academic_year WHERE tenant_id = ? AND deleted_at IS NULL AND start_date <= ? AND ? <= end_date').get(c.tenantId, i.endDate, i.startDate)) return { ok: false, error: 'overlap' };
  const now = clock(c); const today = now.slice(0, 10); const yearId = newId(); let copied = 0; let ended = 0;
  c.db.transaction(() => {
    const cut = today < old.endDate ? today : old.endDate; // closing early: enrollments end today; otherwise at the year's end
    ended = c.db.prepare("UPDATE enrollment SET end_date = max(start_date, ?), end_reason = 'year_end', updated_at = ?, updated_by = ?, version = version + 1 WHERE academic_year_id = ? AND end_date IS NULL AND deleted_at IS NULL").run(cut, now, c.actorId, old.id).changes;
    c.db.prepare("UPDATE academic_year SET status = 'closed', updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?").run(now, c.actorId, old.id);
    c.db.prepare("INSERT INTO academic_year(id,tenant_id,created_at,updated_at,created_by,updated_by,name,start_date,end_date,status) VALUES (?,?,?,?,?,?,?,?,?,'active')").run(yearId, c.tenantId, now, now, c.actorId, c.actorId, name, i.startDate, i.endDate);
    if (i.copyGroups) {
      const groups = c.db.prepare("SELECT id, branch_id AS b, name, level, capacity FROM study_group WHERE academic_year_id = ? AND deleted_at IS NULL AND status = 'active'").all(old.id) as { id: string; b: string; name: string; level: string | null; capacity: number }[];
      const teachers = c.db.prepare(`SELECT t.staff_member_id AS sid FROM group_teacher t JOIN staff_member m ON m.id = t.staff_member_id WHERE t.group_id = ? AND t.deleted_at IS NULL AND m.deleted_at IS NULL AND m.archived_at IS NULL`);
      for (const g of groups) {
        const gid = newId();
        c.db.prepare('INSERT INTO study_group(id,tenant_id,created_at,updated_at,created_by,updated_by,branch_id,academic_year_id,name,level,capacity) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(gid, c.tenantId, now, now, c.actorId, c.actorId, g.b, yearId, g.name, g.level, g.capacity);
        for (const t of teachers.all(g.id) as { sid: string }[]) c.db.prepare('INSERT INTO group_teacher(id,tenant_id,created_at,updated_at,created_by,updated_by,group_id,staff_member_id,branch_id) VALUES (?,?,?,?,?,?,?,?,?)').run(newId(), c.tenantId, now, now, c.actorId, c.actorId, gid, t.sid, g.b);
        copied++;
      }
    }
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: null, action: 'year.close_and_open', entity_type: 'academic_year', entity_id: yearId,
      before_json: JSON.stringify({ closedYear: old.name }), after_json: JSON.stringify({ newYear: name, startDate: i.startDate, endDate: i.endDate, copiedGroups: copied, endedEnrollments: ended }), reason: null });
  })();
  return { ok: true, yearId, copiedGroups: copied, endedEnrollments: ended };
}

export interface CarryPlanRow { fromGroupId: string; fromName: string; branchId: string; branchName: string; yearName: string; candidates: number; suggested: { id: string; name: string } | null; targets: { id: string; name: string }[] }
/** For each group of the most recently closed year: how many of its students are waiting to be carried over, the same-named group of the new year (if any) and the other possible targets. */
export function carryOverPlan(c: Ctx): CarryPlanRow[] | null {
  if (!authorize(c.assignments, 'settings.manage', null).allowed && !c.assignments.some((a) => authorize(c.assignments, 'enrollment.manage', a.branchId).allowed)) return null;
  const y = activeYear(c); if (!y) return [];
  const prev = c.db.prepare("SELECT id, name FROM academic_year WHERE tenant_id = ? AND status = 'closed' AND deleted_at IS NULL AND end_date < ? ORDER BY end_date DESC LIMIT 1").get(c.tenantId, y.startDate) as { id: string; name: string } | undefined; if (!prev) return [];
  const rows = c.db.prepare(`SELECT g.id, g.name, g.branch_id AS b, br.name AS bn,
      (SELECT count(DISTINCT e.student_id) FROM enrollment e JOIN student s ON s.id = e.student_id WHERE e.group_id = g.id AND e.end_reason = 'year_end' AND e.deleted_at IS NULL AND s.status = 'active' AND s.archived_at IS NULL AND s.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM enrollment n WHERE n.student_id = e.student_id AND n.academic_year_id = ? AND n.deleted_at IS NULL)) AS candidates
    FROM study_group g JOIN branch br ON br.id = g.branch_id WHERE g.academic_year_id = ? AND g.deleted_at IS NULL ORDER BY br.position, g.name`).all(y.id, prev.id) as { id: string; name: string; b: string; bn: string; candidates: number }[];
  const news = c.db.prepare("SELECT id, name, branch_id AS b FROM study_group WHERE academic_year_id = ? AND deleted_at IS NULL AND status = 'active'").all(y.id) as { id: string; name: string; b: string }[];
  return rows.filter((r) => authorize(c.assignments, 'enrollment.manage', r.b).allowed).map((r) => {
    const targets = news.filter((n) => n.b === r.b).map((n) => ({ id: n.id, name: n.name }));
    return { fromGroupId: r.id, fromName: r.name, branchId: r.b, branchName: r.bn, yearName: prev.name, candidates: r.candidates, suggested: targets.find((t) => t.name === r.name) ?? null, targets };
  });
}

/** Enrolls the students who were in `fromGroupId` when its year closed into `toGroupId` of the new year. They start on the new year's first day. Archived or non-active students are not moved. */
export function carryOver(c: Ctx, fromGroupId: string, toGroupId: string): YearResult<{ moved: number; skipped: number }> {
  const from = c.db.prepare('SELECT g.branch_id AS b, y.status AS ys FROM study_group g JOIN academic_year y ON y.id = g.academic_year_id WHERE g.id = ? AND g.tenant_id = ? AND g.deleted_at IS NULL').get(fromGroupId, c.tenantId) as { b: string; ys: string } | undefined;
  if (!from || !authorize(c.assignments, 'enrollment.manage', from.b).allowed) return { ok: false, error: from ? 'forbidden' : 'not_found' };
  if (from.ys !== 'closed') return { ok: false, error: 'not_closed_year' };
  const y = activeYear(c); if (!y) return { ok: false, error: 'no_active_year' };
  const to = c.db.prepare('SELECT branch_id AS b, status, academic_year_id AS y FROM study_group WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(toGroupId, c.tenantId) as { b: string; status: string; y: string } | undefined;
  if (!to || to.y !== y.id) return { ok: false, error: 'not_found' }; if (to.status === 'closed') return { ok: false, error: 'group_closed' }; if (to.b !== from.b) return { ok: false, error: 'branch_mismatch' };
  const cands = c.db.prepare(`SELECT DISTINCT e.student_id AS sid FROM enrollment e JOIN student s ON s.id = e.student_id WHERE e.group_id = ? AND e.end_reason = 'year_end' AND e.deleted_at IS NULL AND s.status = 'active' AND s.archived_at IS NULL AND s.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM enrollment n WHERE n.student_id = e.student_id AND n.academic_year_id = ? AND n.deleted_at IS NULL)`).all(fromGroupId, y.id) as { sid: string }[];
  const total = (c.db.prepare("SELECT count(DISTINCT student_id) n FROM enrollment WHERE group_id = ? AND end_reason = 'year_end' AND deleted_at IS NULL").get(fromGroupId) as { n: number }).n;
  const now = clock(c);
  c.db.transaction(() => {
    for (const s of cands) c.db.prepare('INSERT INTO enrollment(id,tenant_id,created_at,updated_at,created_by,updated_by,student_id,group_id,branch_id,academic_year_id,start_date) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(newId(), c.tenantId, now, now, c.actorId, c.actorId, s.sid, toGroupId, to.b, y.id, y.startDate);
    if (cands.length) appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: to.b, action: 'enrollment.carry_over', entity_type: 'study_group', entity_id: toGroupId, before_json: JSON.stringify({ fromGroupId }), after_json: JSON.stringify({ moved: cands.length }), reason: null });
  })();
  return { ok: true, moved: cands.length, skipped: total - cands.length };
}
