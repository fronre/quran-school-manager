import { createHash } from 'node:crypto';
import { authorize, branchFilter, fullNameKey, isJpeg, validateStaff, PHOTO, STAFF_POSITIONS, type StaffInput, type StaffIssue, type StaffPosition, type StaffKind } from '@mishkat/domain';
import { appendAudit, newId, nowIso } from './index';
import type { Ctx } from './students';

/** Teachers/staff profiles, photos with consent, and the activity log of a profile.
 *  Same conventions as students: every call re-checks the caller's assignments; records outside the caller's branches look absent. */
export interface StaffRow {
  id: string; personId: string; givenName: string; familyName: string; birthDate: string | null; phone: string | null;
  branchId: string | null; branchName: string | null; position: StaffPosition; kind: StaffKind; archivedAt: string | null; archiveReason: string | null; version: number; hasPhoto: boolean;
}
export type StaffFail = 'forbidden' | 'not_found' | 'invalid' | 'branch_not_found' | 'conflict' | 'archived' | 'already_archived' | 'not_archived' | 'reason_required';
export type StaffResult<T = object> = ({ ok: true } & T) | { ok: false; error: StaffFail; issues?: StaffIssue[] };

const clock = (c: Ctx) => (c.now ?? nowIso)();
const roleOf = (c: Ctx) => c.assignments.map((a) => a.role).join(',') || 'none';
const SELECT = `SELECT m.id, m.person_id AS personId, p.given_name AS givenName, p.family_name AS familyName, p.birth_date AS birthDate, p.phone AS phone, m.branch_id AS branchId, b.name AS branchName,
  m.position AS position, m.kind AS kind, m.archived_at AS archivedAt, m.archive_reason AS archiveReason, m.version AS version,
  EXISTS(SELECT 1 FROM person_photo ph WHERE ph.person_id = m.person_id) AS hasPhoto
  FROM staff_member m JOIN person p ON p.id = m.person_id LEFT JOIN branch b ON b.id = m.branch_id`;
type Raw = Omit<StaffRow, 'hasPhoto'> & { hasPhoto: number };
const shape = (r: Raw): StaffRow => ({ ...r, hasPhoto: !!r.hasPhoto });
const clean = (i: StaffInput): StaffInput => ({ ...i, givenName: i.givenName.trim(), familyName: i.familyName.trim(), birthDate: i.birthDate || null, phone: i.phone?.trim() || null });

/** Staff rows visible to the caller: a staff member is in scope when his branch is. The person who signs in (administrator, no branch) is visible to nobody but is never listed by default. */
export function listStaff(c: Ctx, q: { search?: string; branchId?: string; position?: StaffPosition | 'all'; archived?: 'active' | 'archived' | 'all'; limit?: number; offset?: number } = {}): { rows: StaffRow[]; total: number } {
  const f = branchFilter(c.assignments, 'staff.view'); if (f.kind === 'none') return { rows: [], total: 0 };
  const where = ['m.deleted_at IS NULL', 'm.tenant_id = ?']; const p: unknown[] = [c.tenantId];
  if (f.kind === 'branches') { where.push(`m.branch_id IN (${f.ids.map(() => '?').join(',')})`); p.push(...f.ids); }
  if (q.branchId) { if (f.kind === 'branches' && !f.ids.includes(q.branchId)) return { rows: [], total: 0 }; where.push('m.branch_id = ?'); p.push(q.branchId); }
  if (q.position && q.position !== 'all') { if ((STAFF_POSITIONS as readonly string[]).includes(q.position)) { where.push('m.position = ?'); p.push(q.position); } }
  else if (!q.position) where.push("m.position <> 'administrator'");
  const arch = q.archived ?? 'active'; if (arch === 'active') where.push('m.archived_at IS NULL'); else if (arch === 'archived') where.push('m.archived_at IS NOT NULL');
  const term = q.search?.trim();
  if (term) {
    const words = fullNameKey(term, '').split(' ').filter(Boolean); const like = (t: string) => '%' + t.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
    where.push(`(${words.map(() => "p.search_key LIKE ? ESCAPE '\\'").join(' AND ') || '1=1'})`); p.push(...words.map(like));
  }
  const w = where.join(' AND ');
  const total = (c.db.prepare(`SELECT count(*) n FROM staff_member m JOIN person p ON p.id = m.person_id WHERE ${w}`).get(...p) as { n: number }).n;
  const rows = (c.db.prepare(`${SELECT} WHERE ${w} ORDER BY p.search_key LIMIT ? OFFSET ?`).all(...p, Math.min(Math.max(q.limit ?? 100, 1), 500), Math.max(q.offset ?? 0, 0)) as Raw[]).map(shape);
  return { rows, total };
}

export function getStaff(c: Ctx, id: string): StaffRow | null {
  const r = c.db.prepare(`${SELECT} WHERE m.id = ? AND m.tenant_id = ? AND m.deleted_at IS NULL`).get(id, c.tenantId) as Raw | undefined;
  if (!r || !r.branchId || !authorize(c.assignments, 'staff.view', r.branchId).allowed) return null; // out of scope = not found
  return shape(r);
}

const branchOk = (c: Ctx, id: string) => !!c.db.prepare('SELECT 1 FROM branch WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL AND active = 1').get(id, c.tenantId);

export function createStaff(c: Ctx, raw: StaffInput): StaffResult<{ id: string }> {
  const i = clean(raw); const now = clock(c);
  if (!authorize(c.assignments, 'staff.edit', i.branchId).allowed) return { ok: false, error: 'forbidden' };
  const issues = validateStaff(i, now.slice(0, 10)); if (issues.length) return { ok: false, error: 'invalid', issues };
  if (!branchOk(c, i.branchId)) return { ok: false, error: 'branch_not_found' };
  const pid = newId(), id = newId();
  c.db.transaction(() => {
    const env = [now, now, c.actorId, c.actorId] as const;
    c.db.prepare('INSERT INTO person(id,tenant_id,created_at,updated_at,created_by,updated_by,given_name,family_name,birth_date,phone,search_key) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(pid, c.tenantId, ...env, i.givenName, i.familyName, i.birthDate, i.phone, fullNameKey(i.givenName, i.familyName));
    c.db.prepare('INSERT INTO staff_member(id,tenant_id,created_at,updated_at,created_by,updated_by,person_id,kind,branch_id,position) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, c.tenantId, ...env, pid, i.kind, i.branchId, i.position);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: i.branchId, action: 'staff.create', entity_type: 'staff_member', entity_id: id, before_json: null, after_json: JSON.stringify(i), reason: null });
  })();
  return { ok: true, id };
}

export function updateStaff(c: Ctx, id: string, expectedVersion: number, raw: StaffInput): StaffResult {
  const cur = getStaff(c, id); if (!cur) return { ok: false, error: 'not_found' };
  if (!authorize(c.assignments, 'staff.edit', cur.branchId).allowed) return { ok: false, error: 'forbidden' };
  if (cur.archivedAt) return { ok: false, error: 'archived' };
  const i = clean(raw); const now = clock(c);
  const issues = validateStaff(i, now.slice(0, 10)); if (issues.length) return { ok: false, error: 'invalid', issues };
  if (cur.version !== expectedVersion) return { ok: false, error: 'conflict' };
  if (i.branchId !== cur.branchId) { // moving a teacher to the other branch is a Director-level action
    if (!authorize(c.assignments, 'staff.edit', i.branchId).allowed || !authorize(c.assignments, 'enrollment.transfer_cross_branch', null).allowed) return { ok: false, error: 'forbidden' };
    if (!branchOk(c, i.branchId)) return { ok: false, error: 'branch_not_found' };
  }
  const before = { givenName: cur.givenName, familyName: cur.familyName, birthDate: cur.birthDate, phone: cur.phone, branchId: cur.branchId, position: cur.position, kind: cur.kind };
  c.db.transaction(() => {
    c.db.prepare('UPDATE person SET given_name=?, family_name=?, birth_date=?, phone=?, search_key=?, updated_at=?, updated_by=?, version=version+1 WHERE id=?').run(i.givenName, i.familyName, i.birthDate, i.phone, fullNameKey(i.givenName, i.familyName), now, c.actorId, cur.personId);
    c.db.prepare('UPDATE staff_member SET kind=?, branch_id=?, position=?, updated_at=?, updated_by=?, version=version+1 WHERE id=?').run(i.kind, i.branchId, i.position, now, c.actorId, id);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: i.branchId, action: 'staff.update', entity_type: 'staff_member', entity_id: id, before_json: JSON.stringify(before), after_json: JSON.stringify(i), reason: null });
  })();
  return { ok: true };
}

export function archiveStaff(c: Ctx, id: string, reason: string): StaffResult {
  const cur = getStaff(c, id); if (!cur) return { ok: false, error: 'not_found' };
  if (!authorize(c.assignments, 'staff.edit', cur.branchId).allowed) return { ok: false, error: 'forbidden' };
  const why = reason.trim(); if (!why || [...why].length > 300) return { ok: false, error: 'reason_required' };
  if (cur.archivedAt) return { ok: false, error: 'already_archived' };
  const now = clock(c);
  c.db.transaction(() => {
    c.db.prepare('UPDATE staff_member SET archived_at=?, archive_reason=?, updated_at=?, updated_by=?, version=version+1 WHERE id=?').run(now, why, now, c.actorId, id);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: cur.branchId, action: 'staff.archive', entity_type: 'staff_member', entity_id: id, before_json: null, after_json: null, reason: why });
  })();
  return { ok: true };
}
export function unarchiveStaff(c: Ctx, id: string): StaffResult {
  const cur = getStaff(c, id); if (!cur) return { ok: false, error: 'not_found' };
  if (!authorize(c.assignments, 'staff.edit', cur.branchId).allowed) return { ok: false, error: 'forbidden' };
  if (!cur.archivedAt) return { ok: false, error: 'not_archived' };
  const now = clock(c);
  c.db.transaction(() => {
    c.db.prepare('UPDATE staff_member SET archived_at=NULL, archive_reason=NULL, updated_at=?, updated_by=?, version=version+1 WHERE id=?').run(now, c.actorId, id);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: cur.branchId, action: 'staff.unarchive', entity_type: 'staff_member', entity_id: id, before_json: JSON.stringify({ archiveReason: cur.archiveReason }), after_json: null, reason: null });
  })();
  return { ok: true };
}

// ---------------- photos (BR-022: only with a recorded consent) ----------------
export type PhotoKind = 'student' | 'staff';
export type PhotoFail = 'forbidden' | 'not_found' | 'consent_required' | 'invalid_image';
export type PhotoResult<T = object> = ({ ok: true } & T) | { ok: false; error: PhotoFail };

/** Resolves who the photo belongs to and whether the caller may see/change it. */
function target(c: Ctx, kind: PhotoKind, id: string, edit: boolean): { personId: string; branchId: string | null } | null {
  if (kind === 'student') {
    const r = c.db.prepare('SELECT s.person_id AS personId, s.branch_id AS branchId FROM student s WHERE s.id = ? AND s.tenant_id = ? AND s.deleted_at IS NULL').get(id, c.tenantId) as { personId: string; branchId: string } | undefined;
    return r && authorize(c.assignments, 'student.view', r.branchId).allowed && (!edit || authorize(c.assignments, 'student.edit', r.branchId).allowed) ? r : null;
  }
  const r = c.db.prepare('SELECT m.person_id AS personId, m.branch_id AS branchId FROM staff_member m WHERE m.id = ? AND m.tenant_id = ? AND m.deleted_at IS NULL').get(id, c.tenantId) as { personId: string; branchId: string | null } | undefined;
  return r && r.branchId && authorize(c.assignments, 'staff.view', r.branchId).allowed && (!edit || authorize(c.assignments, 'staff.edit', r.branchId).allowed) ? r : null;
}

/** `jpeg` must already be a processed thumbnail (the desktop shell decodes, crops and re-encodes it; nothing the user supplied is stored as is). */
export function setPhoto(c: Ctx, a: { kind: PhotoKind; id: string; jpeg: Uint8Array; width: number; height: number; consentGivenBy: string | null }): PhotoResult {
  const t = target(c, a.kind, a.id, true);
  if (!t) return { ok: false, error: target(c, a.kind, a.id, false) ? 'forbidden' : 'not_found' }; // visible but not editable = forbidden; invisible = does not exist
  const by = a.consentGivenBy?.trim(); if (!by) return { ok: false, error: 'consent_required' };
  if (!isJpeg(a.jpeg) || a.jpeg.length > PHOTO.maxStoredBytes || a.width < 16 || a.height < 16 || a.width > 2048 || a.height > 2048) return { ok: false, error: 'invalid_image' };
  const now = clock(c); const bytes = Buffer.from(a.jpeg); const hash = createHash('sha256').update(bytes).digest('hex'); const consentId = newId();
  c.db.transaction(() => {
    c.db.prepare('UPDATE consent_record SET withdrawn_at=?, withdrawn_by=? WHERE person_id=? AND purpose=? AND withdrawn_at IS NULL').run(now, c.actorId, t.personId, 'photo'); // replacing a photo ends the previous consent record
    c.db.prepare('INSERT INTO consent_record(id,tenant_id,person_id,purpose,given_by,granted_at,recorded_by) VALUES (?,?,?,?,?,?,?)').run(consentId, c.tenantId, t.personId, 'photo', by, now, c.actorId);
    c.db.prepare(`INSERT INTO person_photo(person_id,tenant_id,mime,width,height,bytes,sha256,consent_id,updated_at,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(person_id) DO UPDATE SET mime=excluded.mime, width=excluded.width, height=excluded.height, bytes=excluded.bytes, sha256=excluded.sha256, consent_id=excluded.consent_id, updated_at=excluded.updated_at, updated_by=excluded.updated_by`)
      .run(t.personId, c.tenantId, 'image/jpeg', a.width, a.height, bytes, hash, consentId, now, c.actorId);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: t.branchId, action: 'photo.set', entity_type: a.kind === 'student' ? 'student' : 'staff_member', entity_id: a.id, before_json: null, after_json: JSON.stringify({ sha256: hash, bytes: bytes.length, consentGivenBy: by }), reason: null });
  })();
  return { ok: true };
}

export function getPhoto(c: Ctx, kind: PhotoKind, id: string): { mime: string; base64: string; width: number; height: number } | null {
  const t = target(c, kind, id, false); if (!t) return null;
  const r = c.db.prepare('SELECT mime, bytes, width, height FROM person_photo WHERE person_id = ?').get(t.personId) as { mime: string; bytes: Buffer; width: number; height: number } | undefined;
  return r ? { mime: r.mime, base64: Buffer.from(r.bytes).toString('base64'), width: r.width, height: r.height } : null;
}

/** Removing a photo really deletes the image and withdraws the consent record (the record of having consented stays). */
export function removePhoto(c: Ctx, kind: PhotoKind, id: string): PhotoResult {
  const t = target(c, kind, id, true); if (!t) return { ok: false, error: 'not_found' };
  const now = clock(c);
  const had = c.db.transaction(() => {
    const n = c.db.prepare('DELETE FROM person_photo WHERE person_id = ?').run(t.personId).changes;
    c.db.prepare('UPDATE consent_record SET withdrawn_at=?, withdrawn_by=? WHERE person_id=? AND purpose=? AND withdrawn_at IS NULL').run(now, c.actorId, t.personId, 'photo');
    if (n) appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: t.branchId, action: 'photo.remove', entity_type: kind === 'student' ? 'student' : 'staff_member', entity_id: id, before_json: null, after_json: null, reason: null });
    return n;
  })();
  return had ? { ok: true } : { ok: false, error: 'not_found' };
}

// ---------------- activity of a profile ----------------
export interface ActivityRow { seq: number; at: string; action: string; reason: string | null; changes: string[] }
/** What happened to this record, newest first. Only people who may see the record may see its history. */
export function profileActivity(c: Ctx, kind: PhotoKind, id: string, limit = 100): ActivityRow[] | null {
  if (!target(c, kind, id, false)) return null;
  const rows = c.db.prepare('SELECT seq, at, action, reason, before_json AS b, after_json AS a FROM audit_log WHERE tenant_id = ? AND entity_type = ? AND entity_id = ? ORDER BY seq DESC LIMIT ?')
    .all(c.tenantId, kind === 'student' ? 'student' : 'staff_member', id, Math.min(Math.max(limit, 1), 500)) as { seq: number; at: string; action: string; reason: string | null; b: string | null; a: string | null }[];
  return rows.map((r) => {
    const changes: string[] = [];
    if (r.action.endsWith('.update') && r.b && r.a) { try { const b = JSON.parse(r.b) as Record<string, unknown>, a = JSON.parse(r.a) as Record<string, unknown>; for (const k of Object.keys(a)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) changes.push(k); } catch { /* unreadable history entry: show the action only */ } }
    return { seq: r.seq, at: r.at, action: r.action, reason: r.reason, changes };
  });
}
