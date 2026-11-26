import { authorize, backoffSeconds, checkPassword, isLocked, MAX_BRANCHES } from '@mishkat/domain';
import { appendAudit, newId, nowIso, type Db } from './index';
import { hashPassword, verifyPassword, type Argon2Params } from './auth';
import { checkRecoveryKey, parseRecoveryKey } from './recovery';
import type { Ctx } from './students';

/** Association settings, branches and the shared login password (Settings screen). Settings use the `settings.manage` permission. */
const clock = (c: Ctx) => (c.now ?? nowIso)();
const roleOf = (c: Ctx) => c.assignments.map((a) => a.role).join(',') || 'none';
const allowed = (c: Ctx) => authorize(c.assignments, 'settings.manage', null).allowed;

export interface AssociationInfo { id: string; name: string; address: string | null; contact: string | null; version: number }
export interface BranchInfo { id: string; name: string; active: boolean; students: number; teachers: number; version: number }
export type SettingsFail = 'forbidden' | 'invalid' | 'conflict' | 'not_found' | 'duplicate_name' | 'too_many' | 'wrong' | 'locked' | 'weak';
export type SettingsResult<T = object> = ({ ok: true } & T) | { ok: false; error: SettingsFail; retryAfterSeconds?: number };

export function getSettings(c: Ctx): { association: AssociationInfo; branches: BranchInfo[]; username: string } | null {
  if (!allowed(c)) return null;
  const association = c.db.prepare('SELECT id, name, address, contact, version FROM association WHERE tenant_id = ?').get(c.tenantId) as AssociationInfo | undefined; if (!association) return null;
  const rows = c.db.prepare(`SELECT b.id, b.name, b.active, b.version,
    (SELECT count(*) FROM student s WHERE s.branch_id = b.id AND s.deleted_at IS NULL AND s.archived_at IS NULL) AS students,
    (SELECT count(*) FROM staff_member m WHERE m.branch_id = b.id AND m.deleted_at IS NULL AND m.archived_at IS NULL AND m.position <> 'administrator') AS teachers
    FROM branch b WHERE b.tenant_id = ? AND b.deleted_at IS NULL ORDER BY b.position, b.name`).all(c.tenantId) as (Omit<BranchInfo, 'active'> & { active: number })[];
  const u = c.db.prepare('SELECT username FROM user_account WHERE id = ?').get(c.actorId) as { username: string } | undefined;
  return { association, branches: rows.map((r) => ({ ...r, active: !!r.active })), username: u?.username ?? '' };
}

const clean = (s: string | undefined | null, max: number): string | null => { const t = (s ?? '').trim(); return t && [...t].length <= max ? t : t ? '\u0000' : null; };

export function updateAssociation(c: Ctx, expectedVersion: number, i: { name: string; address: string; contact: string }): SettingsResult {
  if (!allowed(c)) return { ok: false, error: 'forbidden' };
  const name = clean(i.name, 100), address = clean(i.address, 300), contact = clean(i.contact, 300);
  if (!name || name === '\u0000' || address === '\u0000' || contact === '\u0000') return { ok: false, error: 'invalid' };
  const cur = c.db.prepare('SELECT id, name, address, contact, version FROM association WHERE tenant_id = ?').get(c.tenantId) as AssociationInfo | undefined; if (!cur) return { ok: false, error: 'not_found' };
  if (cur.version !== expectedVersion) return { ok: false, error: 'conflict' };
  const now = clock(c);
  c.db.transaction(() => {
    c.db.prepare('UPDATE association SET name=?, address=?, contact=?, updated_at=?, updated_by=?, version=version+1 WHERE id=?').run(name, address, contact, now, c.actorId, cur.id);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: null, action: 'association.update', entity_type: 'association', entity_id: cur.id, before_json: JSON.stringify({ name: cur.name, address: cur.address, contact: cur.contact }), after_json: JSON.stringify({ name, address, contact }), reason: null });
  })();
  return { ok: true };
}

const nameTaken = (c: Ctx, name: string, exceptId?: string) => !!c.db.prepare('SELECT 1 FROM branch WHERE tenant_id = ? AND lower(name) = lower(?) AND deleted_at IS NULL AND id <> ?').get(c.tenantId, name, exceptId ?? '');

export function renameBranch(c: Ctx, id: string, expectedVersion: number, rawName: string): SettingsResult {
  if (!allowed(c)) return { ok: false, error: 'forbidden' };
  const name = clean(rawName, 100); if (!name || name === '\u0000') return { ok: false, error: 'invalid' };
  const cur = c.db.prepare('SELECT id, name, version FROM branch WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(id, c.tenantId) as { id: string; name: string; version: number } | undefined; if (!cur) return { ok: false, error: 'not_found' };
  if (cur.version !== expectedVersion) return { ok: false, error: 'conflict' };
  if (nameTaken(c, name, id)) return { ok: false, error: 'duplicate_name' };
  if (name === cur.name) return { ok: true };
  const now = clock(c);
  c.db.transaction(() => {
    c.db.prepare('UPDATE branch SET name=?, updated_at=?, updated_by=?, version=version+1 WHERE id=?').run(name, now, c.actorId, id);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: id, action: 'branch.rename', entity_type: 'branch', entity_id: id, before_json: JSON.stringify({ name: cur.name }), after_json: JSON.stringify({ name }), reason: null });
  })();
  return { ok: true };
}

export function addBranch(c: Ctx, rawName: string): SettingsResult<{ id: string }> {
  if (!allowed(c)) return { ok: false, error: 'forbidden' };
  const name = clean(rawName, 100); if (!name || name === '\u0000') return { ok: false, error: 'invalid' };
  const n = (c.db.prepare('SELECT count(*) n, coalesce(max(position), 0) p FROM branch WHERE tenant_id = ? AND deleted_at IS NULL').get(c.tenantId) as { n: number; p: number });
  if (n.n >= MAX_BRANCHES) return { ok: false, error: 'too_many' };
  if (nameTaken(c, name)) return { ok: false, error: 'duplicate_name' };
  const id = newId(), now = clock(c);
  c.db.transaction(() => {
    c.db.prepare('INSERT INTO branch(id,tenant_id,created_at,updated_at,created_by,updated_by,name,position) VALUES (?,?,?,?,?,?,?,?)').run(id, c.tenantId, now, now, c.actorId, c.actorId, name, n.p + 1);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: id, action: 'branch.create', entity_type: 'branch', entity_id: id, before_json: null, after_json: JSON.stringify({ name }), reason: null });
  })();
  return { ok: true, id };
}

export interface PwCtx { db: Db; tenantId: string; userId: string; now?: () => string; argon2?: Argon2Params; blocked?: ReadonlySet<string> }

/** Re-authentication (SEC-015): checks the signed-in user's password with the same slow-down as the sign-in. Used before risky actions. */
export function checkUserPassword(c: PwCtx, password: string): { ok: true; username: string; auditId: string } | { ok: false; error: 'wrong' | 'locked' | 'not_found'; retryAfterSeconds?: number } {
  const now = (c.now ?? nowIso)();
  const u = c.db.prepare('SELECT id, username, password_hash AS h, failed_attempts AS f, locked_until AS l FROM user_account WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(c.userId, c.tenantId) as { id: string; username: string; h: string; f: number; l: string | null } | undefined;
  if (!u) return { ok: false, error: 'not_found' };
  if (isLocked(u.l, now)) return { ok: false, error: 'locked', retryAfterSeconds: Math.ceil((Date.parse(u.l!) - Date.parse(now)) / 1000) };
  if (verifyPassword(password, u.h)) return { ok: true, username: u.username, auditId: u.id };
  const failed = u.f + 1, delay = backoffSeconds(failed);
  c.db.prepare('UPDATE user_account SET failed_attempts=?, locked_until=?, updated_at=?, updated_by=?, version=version+1 WHERE id=?').run(failed, delay ? new Date(Date.parse(now) + delay * 1000).toISOString() : null, now, u.id, u.id);
  appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: u.id, actor_role: 'user', branch_id: null, action: 'user.reauth.failed', entity_type: 'user_account', entity_id: u.id, before_json: null, after_json: JSON.stringify({ failed_attempts: failed }), reason: null });
  return { ok: false, error: 'wrong', retryAfterSeconds: delay || undefined };
}

/** Changing the shared login password: needs the current one, follows the password policy, and slows guessing like the sign-in does. */
export function changeLoginPassword(c: PwCtx, oldPassword: string, newPassword: string): SettingsResult {
  const now = (c.now ?? nowIso)();
  const v = checkUserPassword(c, oldPassword); if (!v.ok) return v;
  if (checkPassword(newPassword, { username: v.username, blocked: c.blocked }).length) return { ok: false, error: 'weak' };
  c.db.transaction(() => {
    c.db.prepare('UPDATE user_account SET password_hash=?, failed_attempts=0, locked_until=NULL, must_change_password=0, updated_at=?, updated_by=?, version=version+1 WHERE id=?').run(hashPassword(newPassword, c.argon2), now, v.auditId, v.auditId);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: v.auditId, actor_role: 'user', branch_id: null, action: 'user.password.changed', entity_type: 'user_account', entity_id: v.auditId, before_json: null, after_json: '{}', reason: null });
  })();
  return { ok: true };
}

// ---------------- forgotten login password: reset with the recovery key ----------------
export type ResetFail = 'bad_key' | 'weak' | 'no_account';
export type ResetResult = { ok: true; username: string } | { ok: false; error: ResetFail; problems?: string[] };
/** Proof of ownership is the recovery key written on the paper kept at setup (SEC-043). Nothing else is needed: no e-mail, no internet.
 *  Sets a new password for the shared login account, clears any lock, and records the event in the audit log. */
export function resetLoginPassword(c: { db: Db; tenantId: string; now?: () => string; argon2?: Argon2Params; blocked?: ReadonlySet<string> }, recoveryKeyText: string, newPassword: string): ResetResult {
  const k = parseRecoveryKey(recoveryKeyText); if (!k.ok || !checkRecoveryKey(c.db, c.tenantId, k.key)) return { ok: false, error: 'bad_key' };
  const u = c.db.prepare("SELECT id, username FROM user_account WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 1").get(c.tenantId) as { id: string; username: string } | undefined; if (!u) return { ok: false, error: 'no_account' };
  const problems = checkPassword(newPassword, { username: u.username, blocked: c.blocked }); if (problems.length) return { ok: false, error: 'weak', problems: problems.map(String) };
  const now = (c.now ?? nowIso)();
  c.db.transaction(() => {
    c.db.prepare("UPDATE user_account SET password_hash=?, failed_attempts=0, locked_until=NULL, must_change_password=0, status='active', updated_at=?, updated_by=?, version=version+1 WHERE id=?").run(hashPassword(newPassword, c.argon2), now, 'recovery-key', u.id);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: 'recovery-key', actor_role: 'anonymous', branch_id: null, action: 'user.password.reset_by_recovery_key', entity_type: 'user_account', entity_id: u.id, before_json: null, after_json: null, reason: null });
  })();
  return { ok: true, username: u.username };
}
