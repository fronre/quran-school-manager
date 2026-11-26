import { authorize, fullNameKey, normalizePhone, validateGuardian, analyzeGuardianImport, nameWords, parseRelation, type GuardianInput, type GuardianIssue, type GuardianMapping, type GImportReport, type RawCell, type Relation, type StudentIndexEntry } from '@mishkat/domain';
import { appendAudit, newId, nowIso } from './index';
import type { Ctx } from './students';

/** Guardians and their phone numbers (OD-037). Seen through the student: whoever may view a student may see their guardians' phones; editing needs guardian.edit on the student's branch.
 *  Changing a guardian that is shared by siblings changes it for all of them, so it needs the right on every linked student's branch. */
export type GuardianFail = 'forbidden' | 'not_found' | 'invalid' | 'conflict' | 'already_linked' | 'archived' | 'student_not_found' | 'nothing_to_import' | 'too_many';
export type GuardianResult<T = object> = ({ ok: true } & T) | { ok: false; error: GuardianFail; issues?: GuardianIssue[] };
export interface GuardianRow { linkId: string; guardianId: string; name: string; phone: string; relation: Relation; isPrimary: boolean; whatsapp: boolean; version: number; siblings: number }

const clock = (c: Ctx) => (c.now ?? nowIso)();
const roleOf = (c: Ctx) => c.assignments.map((a) => a.role).join(',') || 'none';
const studentBranch = (c: Ctx, id: string) => (c.db.prepare('SELECT branch_id AS b FROM student WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(id, c.tenantId) as { b: string } | undefined)?.b ?? null;

export function listGuardians(c: Ctx, studentId: string): GuardianRow[] | null {
  const b = studentBranch(c, studentId); if (!b || !authorize(c.assignments, 'student.view', b).allowed) return null; // out of scope looks absent
  return (c.db.prepare(`SELECT l.id AS linkId, g.id AS guardianId, g.full_name AS name, g.phone, l.relation, l.is_primary AS isPrimary, g.whatsapp, g.version,
      (SELECT count(*) FROM student_guardian x WHERE x.guardian_id = g.id AND x.deleted_at IS NULL) - 1 AS siblings
    FROM student_guardian l JOIN guardian g ON g.id = l.guardian_id WHERE l.student_id = ? AND l.deleted_at IS NULL AND g.deleted_at IS NULL ORDER BY l.is_primary DESC, l.created_at`).all(studentId) as (Omit<GuardianRow, 'isPrimary' | 'whatsapp'> & { isPrimary: number; whatsapp: number })[])
    .map((r) => ({ ...r, isPrimary: !!r.isPrimary, whatsapp: !!r.whatsapp }));
}

/** Finds an existing guardian with the same phone AND the same name (siblings, repeated imports) or creates one. */
function findOrCreateGuardian(c: Ctx, name: string, ph: { display: string; e164: string; whatsapp: boolean }, now: string): { id: string; created: boolean } {
  const key = nameWords(name);
  const hit = (c.db.prepare('SELECT id, name_key AS k FROM guardian WHERE tenant_id = ? AND phone = ? AND deleted_at IS NULL').all(c.tenantId, ph.display) as { id: string; k: string }[]).find((g) => g.k === key);
  if (hit) return { id: hit.id, created: false };
  const id = newId();
  c.db.prepare('INSERT INTO guardian(id,tenant_id,created_at,updated_at,created_by,updated_by,full_name,name_key,phone,e164,whatsapp) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, c.tenantId, now, now, c.actorId, c.actorId, name, key, ph.display, ph.e164, ph.whatsapp ? 1 : 0);
  return { id, created: true };
}
function link(c: Ctx, studentId: string, branch: string, guardianId: string, relation: Relation, wantPrimary: boolean, now: string): string | null {
  if (c.db.prepare('SELECT 1 FROM student_guardian WHERE student_id = ? AND guardian_id = ? AND deleted_at IS NULL').get(studentId, guardianId)) return null;
  const hasPrimary = !!c.db.prepare('SELECT 1 FROM student_guardian WHERE student_id = ? AND is_primary = 1 AND deleted_at IS NULL').get(studentId);
  const primary = wantPrimary || !hasPrimary; // the first guardian of a student is the primary contact
  const id = newId();
  if (primary && hasPrimary) c.db.prepare('UPDATE student_guardian SET is_primary = 0, updated_at = ?, updated_by = ?, version = version + 1 WHERE student_id = ? AND is_primary = 1 AND deleted_at IS NULL').run(now, c.actorId, studentId);
  c.db.prepare('INSERT INTO student_guardian(id,tenant_id,created_at,updated_at,created_by,updated_by,student_id,guardian_id,branch_id,relation,is_primary) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, c.tenantId, now, now, c.actorId, c.actorId, studentId, guardianId, branch, relation, primary ? 1 : 0);
  return id;
}

export function addGuardian(c: Ctx, studentId: string, i: GuardianInput): GuardianResult<{ linkId: string; reused: boolean }> {
  const b = studentBranch(c, studentId); if (!b || !authorize(c.assignments, 'student.view', b).allowed) return { ok: false, error: 'student_not_found' };
  if (!authorize(c.assignments, 'guardian.edit', b).allowed) return { ok: false, error: 'forbidden' };
  const issues = validateGuardian(i); if (issues.length) return { ok: false, error: 'invalid', issues };
  const ph = normalizePhone(i.phone); if (!ph.ok) return { ok: false, error: 'invalid' };
  const now = clock(c); let out: { linkId: string; reused: boolean } | null = null;
  c.db.transaction(() => {
    const g = findOrCreateGuardian(c, i.name.trim(), ph, now); const l = link(c, studentId, b, g.id, i.relation, i.isPrimary, now);
    if (l) { out = { linkId: l, reused: !g.created }; appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: b, action: 'guardian.add', entity_type: 'student', entity_id: studentId, before_json: null, after_json: JSON.stringify({ guardianId: g.id, relation: i.relation, primary: i.isPrimary }), reason: null }); }
  })();
  return out ? { ok: true, ...(out as { linkId: string; reused: boolean }) } : { ok: false, error: 'already_linked' };
}

/** Edits the guardian's name/phone (for every linked student) and this link's relation / primary flag. */
export function updateGuardian(c: Ctx, linkId: string, expectedVersion: number, i: GuardianInput): GuardianResult {
  const l = c.db.prepare('SELECT l.id, l.student_id AS studentId, l.branch_id AS branch, l.guardian_id AS gid, g.version AS gv, g.full_name AS name, g.phone FROM student_guardian l JOIN guardian g ON g.id = l.guardian_id WHERE l.id = ? AND l.tenant_id = ? AND l.deleted_at IS NULL AND g.deleted_at IS NULL')
    .get(linkId, c.tenantId) as { id: string; studentId: string; branch: string; gid: string; gv: number; name: string; phone: string } | undefined;
  if (!l || !authorize(c.assignments, 'student.view', l.branch).allowed) return { ok: false, error: 'not_found' };
  const branches = (c.db.prepare('SELECT DISTINCT branch_id AS b FROM student_guardian WHERE guardian_id = ? AND deleted_at IS NULL').all(l.gid) as { b: string }[]).map((r) => r.b);
  if (!branches.every((b) => authorize(c.assignments, 'guardian.edit', b).allowed)) return { ok: false, error: 'forbidden' };
  const issues = validateGuardian(i); if (issues.length) return { ok: false, error: 'invalid', issues }; const ph = normalizePhone(i.phone); if (!ph.ok) return { ok: false, error: 'invalid' };
  if (l.gv !== expectedVersion) return { ok: false, error: 'conflict' };
  const now = clock(c);
  c.db.transaction(() => {
    c.db.prepare('UPDATE guardian SET full_name=?, name_key=?, phone=?, e164=?, whatsapp=?, updated_at=?, updated_by=?, version=version+1 WHERE id=?').run(i.name.trim(), nameWords(i.name), ph.display, ph.e164, ph.whatsapp ? 1 : 0, now, c.actorId, l.gid);
    if (i.isPrimary) c.db.prepare('UPDATE student_guardian SET is_primary = 0, updated_at = ?, updated_by = ?, version = version + 1 WHERE student_id = ? AND is_primary = 1 AND id <> ? AND deleted_at IS NULL').run(now, c.actorId, l.studentId, l.id);
    c.db.prepare('UPDATE student_guardian SET relation=?, is_primary=?, updated_at=?, updated_by=?, version=version+1 WHERE id=?').run(i.relation, i.isPrimary ? 1 : 0, now, c.actorId, l.id);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: l.branch, action: 'guardian.update', entity_type: 'student', entity_id: l.studentId, before_json: JSON.stringify({ name: l.name, phone: l.phone }), after_json: JSON.stringify({ name: i.name.trim(), phone: ph.display, relation: i.relation, primary: i.isPrimary }), reason: null });
  })();
  return { ok: true };
}

/** Removes the guardian from this student (tombstone). The guardian stays for siblings; with no students left they are tombstoned too. */
export function removeGuardian(c: Ctx, linkId: string): GuardianResult {
  const l = c.db.prepare('SELECT id, student_id AS studentId, branch_id AS branch, guardian_id AS gid, is_primary AS pr FROM student_guardian WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(linkId, c.tenantId) as { id: string; studentId: string; branch: string; gid: string; pr: number } | undefined;
  if (!l || !authorize(c.assignments, 'student.view', l.branch).allowed) return { ok: false, error: 'not_found' };
  if (!authorize(c.assignments, 'guardian.edit', l.branch).allowed) return { ok: false, error: 'forbidden' };
  const now = clock(c);
  c.db.transaction(() => {
    c.db.prepare('UPDATE student_guardian SET deleted_at=?, deleted_by=?, is_primary=0, updated_at=?, updated_by=?, version=version+1 WHERE id=?').run(now, c.actorId, now, c.actorId, l.id);
    if (l.pr) { const next = c.db.prepare('SELECT id FROM student_guardian WHERE student_id = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 1').get(l.studentId) as { id: string } | undefined; if (next) c.db.prepare('UPDATE student_guardian SET is_primary=1, updated_at=?, updated_by=?, version=version+1 WHERE id=?').run(now, c.actorId, next.id); }
    if (!c.db.prepare('SELECT 1 FROM student_guardian WHERE guardian_id = ? AND deleted_at IS NULL').get(l.gid)) c.db.prepare('UPDATE guardian SET deleted_at=?, deleted_by=?, updated_at=?, updated_by=?, version=version+1 WHERE id=?').run(now, c.actorId, now, c.actorId, l.gid);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: l.branch, action: 'guardian.remove', entity_type: 'student', entity_id: l.studentId, before_json: JSON.stringify({ guardianId: l.gid }), after_json: null, reason: null });
  })();
  return { ok: true };
}

/** The phone to open a chat with: read from the database by link id, so the page can never ask for an arbitrary number. */
export function whatsappTarget(c: Ctx, linkId: string): { e164: string; name: string; studentId: string; studentName: string; branch: string } | null {
  const r = c.db.prepare(`SELECT g.e164, g.full_name AS name, g.whatsapp AS wa, l.student_id AS studentId, l.branch_id AS branch, p.given_name || ' ' || p.family_name AS studentName
    FROM student_guardian l JOIN guardian g ON g.id = l.guardian_id JOIN student s ON s.id = l.student_id JOIN person p ON p.id = s.person_id WHERE l.id = ? AND l.tenant_id = ? AND l.deleted_at IS NULL AND g.deleted_at IS NULL`).get(linkId, c.tenantId) as { e164: string; name: string; wa: number; studentId: string; branch: string; studentName: string } | undefined;
  if (!r || !r.wa || !authorize(c.assignments, 'student.view', r.branch).allowed) return null;
  return { e164: r.e164, name: r.name, studentId: r.studentId, studentName: r.studentName, branch: r.branch };
}
export function logMessage(c: Ctx, t: { studentId: string; branch: string }, kind: string) {
  appendAudit(c.db, { tenant_id: c.tenantId, at: clock(c), actor_id: c.actorId, actor_role: roleOf(c), branch_id: t.branch, action: 'message.whatsapp_opened', entity_type: 'student', entity_id: t.studentId, before_json: null, after_json: JSON.stringify({ kind }), reason: null });
}

// ---------------- import ----------------
export function guardianIndex(c: Ctx): StudentIndexEntry[] {
  const f = (c.db.prepare('SELECT s.id, s.student_no AS no, s.branch_id AS b, p.given_name || \' \' || p.family_name AS name, p.birth_date AS bd FROM student s JOIN person p ON p.id = s.person_id WHERE s.tenant_id = ? AND s.deleted_at IS NULL AND s.archived_at IS NULL').all(c.tenantId) as { id: string; no: string; b: string; name: string; bd: string | null }[])
    .filter((s) => authorize(c.assignments, 'guardian.edit', s.b).allowed);
  return f.map((s) => ({ id: s.id, studentNo: s.no, words: nameWords(s.name), birthDate: s.bd, name: s.name }));
}
export function previewGuardianImport(c: Ctx, rows: RawCell[][], firstRow: number, mapping: GuardianMapping): GImportReport { return analyzeGuardianImport(rows, firstRow, mapping, guardianIndex(c)); }

export const MAX_GUARDIAN_ROWS = 20_000;
/** All-or-nothing: rows with problems are skipped only when the caller says so; otherwise any problem refuses the whole file. Existing links are left alone (re-importing the same file adds nothing). */
export function commitGuardianImport(c: Ctx, rows: RawCell[][], firstRow: number, mapping: GuardianMapping, skipInvalid: boolean): GuardianResult<{ linked: number; created: number; alreadyThere: number; skipped: number }> {
  if (rows.length > MAX_GUARDIAN_ROWS) return { ok: false, error: 'too_many' };
  const rep = previewGuardianImport(c, rows, firstRow, mapping); if (rep.total === 0) return { ok: false, error: 'nothing_to_import' };
  if (rep.withIssues > 0 && !skipInvalid) return { ok: false, error: 'invalid' };
  const good = rep.rows.filter((r) => !r.issues.length && r.student); if (good.length === 0) return { ok: false, error: 'nothing_to_import' };
  const now = clock(c); let linked = 0, created = 0, there = 0;
  c.db.transaction(() => {
    for (const r of good) {
      const ph = normalizePhone(r.phone); if (!ph.ok) continue; const b = studentBranch(c, r.student!.id)!;
      const name = r.guardianName || 'ولي أمر ' + r.student!.name; const g = findOrCreateGuardian(c, name, ph, now); if (g.created) created++;
      if (link(c, r.student!.id, b, g.id, r.relation, false, now)) linked++; else there++;
    }
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: null, action: 'guardian.import', entity_type: 'guardian', entity_id: c.actorId, before_json: null, after_json: JSON.stringify({ rows: rep.total, linked, created, alreadyThere: there, skipped: rep.withIssues }), reason: null });
  })();
  return { ok: true, linked, created, alreadyThere: there, skipped: rep.withIssues };
}
export { parseRelation, fullNameKey };
