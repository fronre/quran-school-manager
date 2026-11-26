import { randomInt } from 'node:crypto';
import { authorize, normalizePhone } from '@mishkat/domain';
import { appendAudit, newId, nowIso, sha256, type Db } from './index';
import { studentProgress } from './memorization';
import type { Ctx } from './students';

/** Guardian app (prototype, OD-015/OD-016). A guardian signs in with the phone number on file + a code handed over in person; sees ONLY their own linked, active children;
 *  read-only. The code is shown once and only its hash is stored. Five wrong codes lock that guardian for 15 minutes. Nothing here can write student data. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alikes (0/O, 1/I)
const MAX_FAILS = 5; const LOCK_MS = 15 * 60_000;
export const newGuardianCode = (): string => { let s = ''; for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(ALPHABET.length)]; return `${s.slice(0, 4)}-${s.slice(4)}`; };
const normCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashCode = (guardianId: string, code: string) => sha256(`${guardianId}:${normCode(code)}`);
const clock = (c: { now?: () => string }) => (c.now ?? nowIso)();
const roleOf = (c: Ctx) => c.assignments.map((a) => a.role).join(',') || 'none';
const branchesOfGuardian = (db: Db, guardianId: string) => (db.prepare('SELECT DISTINCT branch_id AS b FROM student_guardian WHERE guardian_id = ? AND deleted_at IS NULL').all(guardianId) as { b: string }[]).map((r) => r.b);

/** Staff side: makes (or replaces) the guardian's code. Needs guardian.edit on every branch the guardian's children belong to. Returns the code once. */
export function issueGuardianCode(c: Ctx, guardianId: string): { ok: true; code: string } | { ok: false; error: 'forbidden' | 'not_found' } {
  const g = c.db.prepare('SELECT id FROM guardian WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(guardianId, c.tenantId);
  const branches = branchesOfGuardian(c.db, guardianId);
  if (!g || branches.length === 0 || !branches.some((b) => authorize(c.assignments, 'student.view', b).allowed)) return { ok: false, error: 'not_found' };
  if (!branches.every((b) => authorize(c.assignments, 'guardian.edit', b).allowed)) return { ok: false, error: 'forbidden' };
  const code = newGuardianCode(); const now = clock(c);
  c.db.transaction(() => {
    c.db.prepare('UPDATE guardian_access SET revoked_at = ?, revoked_by = ? WHERE guardian_id = ? AND revoked_at IS NULL').run(now, c.actorId, guardianId);
    c.db.prepare('INSERT INTO guardian_access(id,tenant_id,guardian_id,code_hash,created_at,created_by) VALUES (?,?,?,?,?,?)').run(newId(), c.tenantId, guardianId, hashCode(guardianId, code), now, c.actorId);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: null, action: 'guardian.code_issue', entity_type: 'guardian', entity_id: guardianId, before_json: null, after_json: null, reason: null });
  })();
  return { ok: true, code };
}
export function revokeGuardianCode(c: Ctx, guardianId: string): { ok: boolean } {
  const branches = branchesOfGuardian(c.db, guardianId);
  if (branches.length === 0 || !branches.every((b) => authorize(c.assignments, 'guardian.edit', b).allowed)) return { ok: false };
  const now = clock(c); const n = c.db.prepare('UPDATE guardian_access SET revoked_at = ?, revoked_by = ? WHERE guardian_id = ? AND tenant_id = ? AND revoked_at IS NULL').run(now, c.actorId, guardianId, c.tenantId).changes;
  if (n) appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: null, action: 'guardian.code_revoke', entity_type: 'guardian', entity_id: guardianId, before_json: null, after_json: null, reason: null });
  return { ok: true };
}
/** Whether this guardian has a live code (never the code itself). */
export function guardianHasCode(db: Db, guardianId: string): boolean { return !!db.prepare('SELECT 1 FROM guardian_access WHERE guardian_id = ? AND revoked_at IS NULL').get(guardianId); }

/** Guardian side. Answers 'invalid' for any wrong phone/code (never says which), 'locked' after too many wrong codes for a known guardian. */
export function guardianSignIn(db: Db, tenantId: string, phone: string, code: string, now: () => string = nowIso): { ok: true; guardianId: string; name: string } | { ok: false; error: 'invalid' | 'locked' } {
  const ph = normalizePhone(phone); if (!ph.ok || normCode(code).length !== 8) return { ok: false, error: 'invalid' };
  const gs = db.prepare(`SELECT g.id, g.full_name AS name, a.id AS aid, a.code_hash AS h, a.failed_count AS f, a.locked_until AS lu FROM guardian g JOIN guardian_access a ON a.guardian_id = g.id AND a.revoked_at IS NULL
    WHERE g.tenant_id = ? AND g.phone = ? AND g.deleted_at IS NULL`).all(tenantId, ph.display) as { id: string; name: string; aid: string; h: string; f: number; lu: string | null }[];
  const t = now();
  for (const g of gs) if (g.lu && g.lu > t) return { ok: false, error: 'locked' };
  const hit = gs.find((g) => g.h === hashCode(g.id, code));
  if (!hit) {
    for (const g of gs) { const f = g.f + 1; db.prepare('UPDATE guardian_access SET failed_count = ?, locked_until = ? WHERE id = ?').run(f >= MAX_FAILS ? 0 : f, f >= MAX_FAILS ? new Date(Date.parse(t) + LOCK_MS).toISOString() : null, g.aid); }
    return { ok: false, error: 'invalid' };
  }
  db.prepare('UPDATE guardian_access SET failed_count = 0, locked_until = NULL, last_login_at = ? WHERE id = ?').run(t, hit.aid);
  return { ok: true, guardianId: hit.id, name: hit.name };
}

export interface ChildView {
  name: string; studentNo: string; groupName: string | null; branchName: string; memorizedAyat: number; totalAyat: number; wholeSurahs: number; lastDate: string | null;
  attendance: { present: number; late: number; absent: number; excused: number };
  recent: { date: string; type: 'new' | 'revision' | 'consolidation'; rangeText: string; evalLabel: string | null }[];
}
/** What a signed-in guardian sees: their own active children only. */
export function guardianChildren(db: Db, tenantId: string, guardianId: string, now: () => string = nowIso): { association: string; guardianName: string; children: ChildView[] } | null {
  const g = db.prepare('SELECT full_name AS n FROM guardian WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(guardianId, tenantId) as { n: string } | undefined; if (!g) return null;
  const read: Ctx = { db, tenantId, actorId: 'guardian:' + guardianId, assignments: [{ role: 'director', branchId: null }], now }; // internal read-only access; the query below limits it to this guardian's own links
  const kids = db.prepare(`SELECT s.id, s.student_no AS no, p.given_name || ' ' || p.family_name AS name, b.name AS branch FROM student_guardian l JOIN student s ON s.id = l.student_id JOIN person p ON p.id = s.person_id JOIN branch b ON b.id = s.branch_id
    WHERE l.guardian_id = ? AND l.tenant_id = ? AND l.deleted_at IS NULL AND s.deleted_at IS NULL AND s.status = 'active' ORDER BY p.search_key`).all(guardianId, tenantId) as { id: string; no: string; name: string; branch: string }[];
  const children = kids.map((k): ChildView => {
    const pr = studentProgress(read, k.id, 8)!;
    const grp = db.prepare('SELECT sg.name FROM enrollment e JOIN study_group sg ON sg.id = e.group_id WHERE e.student_id = ? AND e.end_date IS NULL AND e.deleted_at IS NULL LIMIT 1').get(k.id) as { name: string } | undefined;
    const att = db.prepare('SELECT status, count(*) n FROM attendance_record WHERE student_id = ? AND deleted_at IS NULL GROUP BY status').all(k.id) as { status: string; n: number }[];
    const cnt = (s: string) => att.find((a) => a.status === s)?.n ?? 0;
    return { name: k.name, studentNo: k.no, groupName: grp?.name ?? null, branchName: k.branch, memorizedAyat: pr.summary.memorizedAyat, totalAyat: pr.summary.totalAyat, wholeSurahs: pr.summary.wholeSurahs, lastDate: pr.summary.lastDate,
      attendance: { present: cnt('present'), late: cnt('late'), absent: cnt('absent'), excused: cnt('excused') },
      recent: pr.records.filter((r) => !r.voided).map((r) => ({ date: r.date, type: r.type, rangeText: r.rangeText, evalLabel: r.evalLabel })) };
  });
  const assoc = (db.prepare('SELECT name FROM association WHERE id = ?').get(tenantId) as { name: string } | undefined)?.name ?? '';
  return { association: assoc, guardianName: g.n, children };
}
