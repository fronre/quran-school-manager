import { authorize, fullNameKey, validateStudent, type Existing, type StudentInput } from '@mishkat/domain';
import { appendAudit, newId, nowIso } from './index';
import type { Ctx } from './students';

/** What the importer needs to know about the data that already exists (numbers in use, known people, next free number). */
export function existingForImport(c: Ctx): Existing {
  const rows = c.db.prepare('SELECT s.student_no AS no, p.search_key AS key, p.birth_date AS bd FROM student s JOIN person p ON p.id = s.person_id WHERE s.tenant_id = ? AND s.deleted_at IS NULL').all(c.tenantId) as { no: string; key: string | null; bd: string | null }[];
  const numbers = new Set(rows.map((r) => r.no));
  const people = rows.filter((r) => r.key && r.bd).map((r) => ({ key: r.key!, birthDate: r.bd! }));
  const maxNo = rows.reduce((m, r) => (/^\d+$/.test(r.no) ? Math.max(m, Number(r.no)) : m), 0);
  return { numbers, people, nextNo: maxNo + 1 };
}

export type ImportFail = 'forbidden' | 'invalid' | 'branch_not_found' | 'duplicate_number' | 'nothing_to_import' | 'too_many';
export type ImportResult = { ok: true; count: number } | { ok: false; error: ImportFail; index?: number };
export const MAX_IMPORT_ROWS = 20_000;

/** BR-045: all-or-nothing. Every input is re-validated here (the report the user saw is not trusted), then written in one
 *  transaction with ONE audit entry describing the file. A failure anywhere leaves the database untouched. */
export function importStudents(c: Ctx, inputs: StudentInput[], meta: { fileName: string; fileSha256: string; rowsInFile: number }): ImportResult {
  if (!authorize(c.assignments, 'import.run', null).allowed) return { ok: false, error: 'forbidden' };
  if (inputs.length === 0) return { ok: false, error: 'nothing_to_import' };
  if (inputs.length > MAX_IMPORT_ROWS) return { ok: false, error: 'too_many' };
  const now = (c.now ?? nowIso)(); const today = now.slice(0, 10);
  const branchIds = new Set(inputs.map((i) => i.branchId));
  for (const b of branchIds) {
    if (!authorize(c.assignments, 'student.edit', b).allowed) return { ok: false, error: 'forbidden' };
    if (!c.db.prepare('SELECT 1 FROM branch WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL AND active = 1').get(b, c.tenantId)) return { ok: false, error: 'branch_not_found' };
  }
  const taken = new Set((c.db.prepare('SELECT student_no n FROM student WHERE tenant_id = ? AND deleted_at IS NULL').all(c.tenantId) as { n: string }[]).map((r) => r.n));
  const cleaned = inputs.map((i) => ({ ...i, givenName: i.givenName.trim(), familyName: i.familyName.trim(), studentNo: i.studentNo.trim(), birthDate: i.birthDate || null, phone: i.phone?.trim() || null, joinedOn: i.joinedOn || null }));
  for (let n = 0; n < cleaned.length; n++) {
    const i = cleaned[n]!;
    if (validateStudent(i, today).length) return { ok: false, error: 'invalid', index: n };
    if (taken.has(i.studentNo)) return { ok: false, error: 'duplicate_number', index: n };
    taken.add(i.studentNo);
  }
  try {
    c.db.transaction(() => {
      const person = c.db.prepare('INSERT INTO person(id,tenant_id,created_at,updated_at,created_by,updated_by,given_name,family_name,birth_date,phone,search_key) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
      const student = c.db.prepare('INSERT INTO student(id,tenant_id,created_at,updated_at,created_by,updated_by,person_id,student_no,branch_id,status,joined_on) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
      for (const i of cleaned) {
        const pid = newId();
        person.run(pid, c.tenantId, now, now, c.actorId, c.actorId, i.givenName, i.familyName, i.birthDate, i.phone, fullNameKey(i.givenName, i.familyName));
        student.run(newId(), c.tenantId, now, now, c.actorId, c.actorId, pid, i.studentNo, i.branchId, i.status, i.joinedOn);
      }
      appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: c.assignments.map((a) => a.role).join(',') || 'none', branch_id: null, action: 'student.import', entity_type: 'student', entity_id: meta.fileSha256.slice(0, 36).padEnd(36, '0'), before_json: null, after_json: JSON.stringify({ file: meta.fileName, sha256: meta.fileSha256, rowsInFile: meta.rowsInFile, imported: cleaned.length, skipped: meta.rowsInFile - cleaned.length }), reason: null });
    })();
  } catch (e) {
    if (e instanceof Error && /UNIQUE/.test(e.message)) return { ok: false, error: 'duplicate_number' }; // a unique-index race
    throw e; // anything else is a real fault and must not be disguised
  }
  return { ok: true, count: cleaned.length };
}

// ---------------- update-existing mode ----------------
import { analyzeStudentUpdate, type RawCell as UpdRawCell, type UpdateMapping, type UpdateReport, type UpdateTarget } from '@mishkat/domain';
import { listStudents, updateStudent } from './students';

/** Students the caller may edit, by student number. */
export function updateTargets(c: Ctx): Map<string, UpdateTarget> {
  const out = new Map<string, UpdateTarget>(); let offset = 0;
  for (;;) {
    const page = listStudents(c, { archived: 'active', limit: 500, offset });
    for (const s of page.rows) if (authorize(c.assignments, 'student.edit', s.branchId).allowed) out.set(s.studentNo, { id: s.id, version: s.version, studentNo: s.studentNo, input: { givenName: s.givenName, familyName: s.familyName, birthDate: s.birthDate, phone: s.phone, branchId: s.branchId, status: s.status, joinedOn: s.joinedOn, studentNo: s.studentNo } });
    offset += 500; if (offset >= page.total) break;
  }
  return out;
}
export function previewStudentUpdate(c: Ctx, rows: UpdRawCell[][], firstRow: number, mapping: UpdateMapping): UpdateReport {
  return analyzeStudentUpdate(rows, firstRow, mapping, updateTargets(c), (c.now ?? nowIso)().slice(0, 10));
}
export type UpdateCommitResult = { ok: true; updated: number; skipped: number } | { ok: false; error: 'forbidden' | 'invalid' | 'nothing_to_import' | 'too_many' | 'failed' };
/** All-or-nothing, like the import that creates students: every change goes through the same rules as a manual edit (and its audit entry); a failure anywhere changes nothing. */
export function commitStudentUpdate(c: Ctx, rows: UpdRawCell[][], firstRow: number, mapping: UpdateMapping, skipInvalid: boolean): UpdateCommitResult {
  if (!authorize(c.assignments, 'import.run', null).allowed) return { ok: false, error: 'forbidden' };
  if (rows.length > MAX_IMPORT_ROWS) return { ok: false, error: 'too_many' };
  const targets = updateTargets(c); const rep = analyzeStudentUpdate(rows, firstRow, mapping, targets, (c.now ?? nowIso)().slice(0, 10));
  if (rep.withIssues > 0 && !skipInvalid) return { ok: false, error: 'invalid' };
  const todo = rep.rows.filter((r) => !r.issues.length && !r.unchanged && r.student); if (todo.length === 0) return { ok: false, error: 'nothing_to_import' };
  try {
    c.db.transaction(() => {
      for (const r of todo) {
        const t = targets.get(r.studentNo)!; const res = updateStudent(c, t.id, t.version, { ...t.input, ...r.changes }, { ignoreDuplicates: true });
        if (!res.ok) throw new Error('update failed: ' + res.error);
      }
      appendAudit(c.db, { tenant_id: c.tenantId, at: (c.now ?? nowIso)(), actor_id: c.actorId, actor_role: c.assignments.map((a) => a.role).join(',') || 'none', branch_id: null, action: 'student.import_update', entity_type: 'student', entity_id: c.actorId, before_json: null, after_json: JSON.stringify({ rows: rep.total, updated: todo.length, skipped: rep.withIssues, unchanged: rep.unchanged }), reason: null });
    })();
  } catch { return { ok: false, error: 'failed' }; }
  return { ok: true, updated: todo.length, skipped: rep.withIssues };
}
