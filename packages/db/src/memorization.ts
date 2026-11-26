import {
  authorize, validateRange, ordinalOf, rangeText, refOf, memorizedSet, memorizedCount, surahPieces, QURAN_DATASET_VERSION, MEMO_TYPES, SURAHS, TOTAL_AYAT,
  type AyahRange, type MemoType, type MemoRecordLite,
} from '@mishkat/domain';
import { appendAudit, newId, nowIso } from './index';
import { getMemoSettings, scaleList } from './appsettings';
import type { Ctx } from './students';

/** Memorization progress (REQ-050, 051, 054). Records are tied to a student's enrollment on the record date (BR-037) and are never edited:
 *  a wrong record is voided with a reason and a new one entered. Provisional rules: OD-044. */
export type MemoFail = 'forbidden' | 'not_found' | 'invalid_range' | 'invalid' | 'future_date' | 'not_enrolled' | 'invalid_eval' | 'reason_required' | 'already_voided' | 'eval_required';
export type MemoResult<T = object> = ({ ok: true } & T) | { ok: false; error: MemoFail; detail?: string };

export interface MemoInput { studentId: string; date: string; type: MemoType; range: AyahRange; evalRank: number | null; comment?: string | null }
export interface MemoRow {
  id: string; date: string; type: MemoType; rangeText: string; ayat: number; groupName: string; evalRank: number | null; evalLabel: string | null; comment: string | null;
  voided: boolean; voidReason: string | null; counts: boolean; enteredBy: string;
}
const clock = (c: Ctx) => (c.now ?? nowIso)();
const roleOf = (c: Ctx) => c.assignments.map((a) => a.role).join(',') || 'none';
const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
const studentBranch = (c: Ctx, id: string) => (c.db.prepare('SELECT branch_id AS b FROM student WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(id, c.tenantId) as { b: string } | undefined)?.b ?? null;

export function recordMemorization(c: Ctx, i: MemoInput): MemoResult<{ id: string }> {
  const branch = studentBranch(c, i.studentId); if (!branch || !authorize(c.assignments, 'memorization.view', branch).allowed) return { ok: false, error: 'not_found' };
  if (!authorize(c.assignments, 'memorization.record', branch).allowed) return { ok: false, error: 'forbidden' };
  if (!(MEMO_TYPES as readonly string[]).includes(i.type) || !isDate(i.date)) return { ok: false, error: 'invalid' };
  const issue = validateRange(i.range); if (issue) return { ok: false, error: 'invalid_range', detail: issue };
  const comment = i.comment?.trim() || null; if (comment && [...comment].length > 300) return { ok: false, error: 'invalid' };
  let label: string | null = null; const scale = getMemoSettings(c);
  if (i.evalRank !== null) { label = scale.labels[i.evalRank] ?? null; if (!label) return { ok: false, error: 'invalid_eval' }; }
  else if (i.type === 'new') return { ok: false, error: 'eval_required' }; // a new memorization without an evaluation could never count (BR-035)
  const now = clock(c); if (i.date > now.slice(0, 10)) return { ok: false, error: 'future_date' };
  const enr = c.db.prepare(`SELECT e.id, e.group_id AS groupId FROM enrollment e WHERE e.student_id = ? AND e.deleted_at IS NULL AND e.start_date <= ? AND ifnull(e.end_date, '9999-12-31') >= ?`).get(i.studentId, i.date, i.date) as { id: string; groupId: string } | undefined;
  if (!enr) return { ok: false, error: 'not_enrolled' };
  const id = newId(), s = ordinalOf(i.range.start), e = ordinalOf(i.range.end);
  c.db.transaction(() => {
    c.db.prepare(`INSERT INTO memorization_record(id,tenant_id,created_at,updated_at,created_by,updated_by,student_id,enrollment_id,group_id,branch_id,record_date,type,start_surah,start_ayah,end_surah,end_ayah,start_ordinal,end_ordinal,dataset_version,eval_rank,eval_label,scale_version,comment)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, c.tenantId, now, now, c.actorId, c.actorId, i.studentId, enr.id, enr.groupId, branch, i.date, i.type, i.range.start.surah, i.range.start.ayah, i.range.end.surah, i.range.end.ayah, s, e,
      QURAN_DATASET_VERSION, i.evalRank, label, i.evalRank === null ? null : scale.version, comment);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: branch, action: 'memorization.record', entity_type: 'student', entity_id: i.studentId, before_json: null,
      after_json: JSON.stringify({ recordId: id, date: i.date, type: i.type, range: rangeText(i.range), evalRank: i.evalRank }), reason: null });
  })();
  return { ok: true, id };
}

/** Voiding keeps the record visible (struck through) with who/when/why, and removes its effect on progress. */
export function voidMemorization(c: Ctx, recordId: string, reason: string): MemoResult {
  const r = c.db.prepare('SELECT id, student_id AS studentId, branch_id AS branchId, voided_at AS voidedAt FROM memorization_record WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(recordId, c.tenantId) as { id: string; studentId: string; branchId: string; voidedAt: string | null } | undefined;
  if (!r || !authorize(c.assignments, 'memorization.view', r.branchId).allowed) return { ok: false, error: 'not_found' };
  if (!authorize(c.assignments, 'memorization.record', r.branchId).allowed) return { ok: false, error: 'forbidden' };
  const why = reason.trim(); if (!why || [...why].length > 300) return { ok: false, error: 'reason_required' };
  if (r.voidedAt) return { ok: false, error: 'already_voided' };
  const now = clock(c);
  c.db.transaction(() => {
    c.db.prepare('UPDATE memorization_record SET voided_at=?, voided_by=?, void_reason=?, updated_at=?, updated_by=?, version=version+1 WHERE id=?').run(now, c.actorId, why, now, c.actorId, r.id);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: r.branchId, action: 'memorization.void', entity_type: 'student', entity_id: r.studentId, before_json: JSON.stringify({ recordId: r.id }), after_json: null, reason: why });
  })();
  return { ok: true };
}

interface Raw { id: string; date: string; type: MemoType; ss: number; sa: number; es: number; ea: number; so: number; eo: number; groupName: string; evalRank: number | null; evalLabel: string | null; comment: string | null; voidedAt: string | null; voidReason: string | null; enteredBy: string }
export interface MemoSummary {
  memorizedAyat: number; totalAyat: number; passRank: number; scale: { rank: number; label: string }[]; pieces: { surah: number; name: string; from: number; to: number; whole: boolean }[]; wholeSurahs: number;
  counts: { new: number; revision: number; consolidation: number }; lastDate: string | null;
}
/** A student's progress: the memorized set (union of qualifying ranges), per-type counts of live records, and the history, newest first. */
export function studentProgress(c: Ctx, studentId: string, limit = 200): { summary: MemoSummary; records: MemoRow[] } | null {
  const b = studentBranch(c, studentId); if (!b || !authorize(c.assignments, 'memorization.view', b).allowed) return null;
  const raw = c.db.prepare(`SELECT m.id, m.record_date AS date, m.type, m.start_surah AS ss, m.start_ayah AS sa, m.end_surah AS es, m.end_ayah AS ea, m.start_ordinal AS so, m.end_ordinal AS eo, g.name AS groupName,
      m.eval_rank AS evalRank, m.eval_label AS evalLabel, m.comment, m.voided_at AS voidedAt, m.void_reason AS voidReason, m.created_by AS enteredBy
    FROM memorization_record m JOIN study_group g ON g.id = m.group_id WHERE m.student_id = ? AND m.deleted_at IS NULL ORDER BY m.record_date DESC, m.created_at DESC`).all(studentId) as Raw[];
  const ms = getMemoSettings(c); const PASS = ms.passRank;
  const lite: MemoRecordLite[] = raw.map((r) => ({ type: r.type, startOrdinal: r.so, endOrdinal: r.eo, evalRank: r.evalRank, voided: !!r.voidedAt }));
  const set = memorizedSet(lite, PASS); const pieces = surahPieces(set).map((p) => ({ ...p, name: SURAHS[p.surah - 1]!.name }));
  const live = raw.filter((r) => !r.voidedAt);
  const summary: MemoSummary = { memorizedAyat: memorizedCount(lite, PASS), totalAyat: TOTAL_AYAT, passRank: PASS, scale: scaleList(ms), pieces, wholeSurahs: pieces.filter((p) => p.whole).length,
    counts: { new: live.filter((r) => r.type === 'new').length, revision: live.filter((r) => r.type === 'revision').length, consolidation: live.filter((r) => r.type === 'consolidation').length }, lastDate: live[0]?.date ?? null };
  const records = raw.slice(0, Math.min(Math.max(limit, 1), 1000)).map((r, i): MemoRow => ({
    id: r.id, date: r.date, type: r.type, rangeText: rangeText({ start: { surah: r.ss, ayah: r.sa }, end: { surah: r.es, ayah: r.ea } }), ayat: r.eo - r.so + 1, groupName: r.groupName, evalRank: r.evalRank, evalLabel: r.evalLabel, comment: r.comment,
    voided: !!r.voidedAt, voidReason: r.voidReason, counts: !r.voidedAt && lite[i] !== undefined && lite[i]!.type === 'new' && (r.evalRank ?? 0) >= PASS, enteredBy: r.enteredBy }));
  return { summary, records };
}

export interface ProgressRow { studentId: string; studentNo: string; name: string; memorizedAyat: number; pct: number; wholeSurahs: number; lastDate: string | null; newCount: number; revisionCount: number; consolidationCount: number }
/** Progress of every student of a group (current members), for the group's progress page and reports. */
export function groupProgress(c: Ctx, groupId: string): ProgressRow[] | null {
  const g = c.db.prepare('SELECT branch_id AS b FROM study_group WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(groupId, c.tenantId) as { b: string } | undefined;
  if (!g || !authorize(c.assignments, 'memorization.view', g.b).allowed) return null;
  const members = c.db.prepare(`SELECT st.id, st.student_no AS no, p.given_name || ' ' || p.family_name AS name FROM enrollment e JOIN student st ON st.id = e.student_id JOIN person p ON p.id = st.person_id
    WHERE e.group_id = ? AND e.end_date IS NULL AND e.deleted_at IS NULL ORDER BY p.search_key`).all(groupId) as { id: string; no: string; name: string }[];
  return members.map((m) => { const p = studentProgress(c, m.id)!; return { studentId: m.id, studentNo: m.no, name: m.name, memorizedAyat: p.summary.memorizedAyat, pct: Math.round((p.summary.memorizedAyat / TOTAL_AYAT) * 1000) / 10, wholeSurahs: p.summary.wholeSurahs, lastDate: p.summary.lastDate,
    newCount: p.summary.counts.new, revisionCount: p.summary.counts.revision, consolidationCount: p.summary.counts.consolidation }; });
}

/** For the entry form: where the student's memorized set ends, to suggest the next ayah (a convenience, never enforced). */
export function nextAyahSuggestion(c: Ctx, studentId: string): { surah: number; ayah: number } | null {
  const p = studentProgress(c, studentId); if (!p) return null;
  const last = c.db.prepare("SELECT end_ordinal AS e FROM memorization_record WHERE student_id = ? AND type = 'new' AND voided_at IS NULL AND deleted_at IS NULL ORDER BY record_date DESC, created_at DESC LIMIT 1").get(studentId) as { e: number } | undefined;
  return last && last.e < TOTAL_AYAT ? refOf(last.e + 1) : null;
}
