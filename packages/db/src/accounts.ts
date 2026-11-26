import { randomInt } from 'node:crypto';
import { authorize, checkPassword, ROLE_MATRIX, validateAssignment, type RoleName } from '@mishkat/domain';
import { appendAudit, newId, nowIso } from './index';
import { assignRole, createUser, hashPassword, type Argon2Params } from './auth';
import type { Ctx } from './students';

/** Named accounts (OD-051): the Director creates one account per person, so the activity log says who did what.
 *  The first account (the one made at setup) is the MAIN administrator: it can never be disabled or demoted, so the association is never locked out. */
export type AccountFail = 'forbidden' | 'invalid' | 'not_found' | 'username_taken' | 'branch_not_found' | 'self' | 'main_account' | 'weak';
export type AccountResult<T = object> = ({ ok: true } & T) | { ok: false; error: AccountFail };
export interface AccountRow {
  id: string; username: string; givenName: string; familyName: string; name: string; role: RoleName | null; branchId: string | null; branchName: string | null;
  status: 'active' | 'disabled'; lastLoginAt: string | null; mustChange: boolean; isMain: boolean; version: number;
}
export interface AccountOpts { argon2?: Argon2Params; blocked?: ReadonlySet<string> }

const clock = (c: Ctx) => (c.now ?? nowIso)();
const roleOf = (c: Ctx) => c.assignments.map((a) => a.role).join(',') || 'none';
const allowed = (c: Ctx) => authorize(c.assignments, 'settings.manage', null).allowed;
const NAME_MAX = 60;
const cleanName = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();
const nameOk = (s: string) => s.length > 0 && [...s].length <= NAME_MAX && !/[\u0000-\u001f<>]/.test(s);
const USERNAME_RE = /^[A-Za-z0-9._-]{3,30}$/;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; // no look-alike characters (0/O, 1/l/I)
/** Temporary password shown once to the Director; the person must replace it at the first sign-in. */
export function temporaryPassword(): string {
  const g = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `${g()}-${g()}-${g()}`;
}

function mainAccountId(c: Ctx): string | null {
  return (c.db.prepare('SELECT id FROM user_account WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY created_at, id LIMIT 1').get(c.tenantId) as { id: string } | undefined)?.id ?? null;
}

export function listAccounts(c: Ctx): { accounts: AccountRow[]; branches: { id: string; name: string }[] } | null {
  if (!allowed(c)) return null;
  const main = mainAccountId(c);
  const rows = c.db.prepare(`SELECT u.id, u.username, u.status, u.last_login_at AS lastLoginAt, u.must_change_password AS must, u.version, p.given_name AS g, p.family_name AS f,
      (SELECT r.name FROM user_role_assignment a JOIN role r ON r.id = a.role_id WHERE a.user_id = u.id AND a.deleted_at IS NULL AND r.deleted_at IS NULL ORDER BY r.name LIMIT 1) AS role,
      (SELECT a.branch_id FROM user_role_assignment a JOIN role r ON r.id = a.role_id WHERE a.user_id = u.id AND a.deleted_at IS NULL AND r.deleted_at IS NULL ORDER BY r.name LIMIT 1) AS branchId
    FROM user_account u JOIN staff_member s ON s.id = u.staff_member_id JOIN person p ON p.id = s.person_id
    WHERE u.tenant_id = ? AND u.deleted_at IS NULL ORDER BY u.created_at, u.id`).all(c.tenantId) as { id: string; username: string; status: 'active' | 'disabled'; lastLoginAt: string | null; must: number; version: number; g: string; f: string; role: RoleName | null; branchId: string | null }[];
  const branches = c.db.prepare('SELECT id, name FROM branch WHERE tenant_id = ? AND deleted_at IS NULL AND active = 1 ORDER BY position, name').all(c.tenantId) as { id: string; name: string }[];
  const bn = new Map(branches.map((b) => [b.id, b.name]));
  return {
    branches,
    accounts: rows.map((r) => ({ id: r.id, username: r.username, givenName: r.g, familyName: r.f, name: `${r.g} ${r.f}`.trim(), role: r.role, branchId: r.branchId, branchName: r.branchId ? bn.get(r.branchId) ?? null : null,
      status: r.status, lastLoginAt: r.lastLoginAt, mustChange: r.must === 1, isMain: r.id === main, version: r.version })),
  };
}

/** A role is valid with a branch (every role except the Director) or without one (the Director sees both branches). */
function checkRole(c: Ctx, role: string, branchId: string | null): AccountFail | null {
  if (!(role in ROLE_MATRIX)) return 'invalid';
  const r = role as RoleName; const b = r === 'director' ? null : branchId;
  if (r !== 'director' && !b) return 'invalid';
  if (validateAssignment({ role: r, branchId: b })) return 'invalid';
  if (b && !c.db.prepare('SELECT 1 FROM branch WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL AND active = 1').get(b, c.tenantId)) return 'branch_not_found';
  return null;
}

export function createAccount(c: Ctx, input: { givenName: string; familyName: string; username: string; role: string; branchId: string | null }, o: AccountOpts = {}): AccountResult<{ id: string; username: string; temporaryPassword: string }> {
  if (!allowed(c)) return { ok: false, error: 'forbidden' };
  const givenName = cleanName(input.givenName), familyName = cleanName(input.familyName), username = input.username.trim();
  if (!nameOk(givenName) || !nameOk(familyName) || !USERNAME_RE.test(username)) return { ok: false, error: 'invalid' };
  const bad = checkRole(c, input.role, input.branchId); if (bad) return { ok: false, error: bad };
  const role = input.role as RoleName; const branchId = role === 'director' ? null : input.branchId;
  if (c.db.prepare('SELECT 1 FROM user_account WHERE tenant_id = ? AND lower(username) = lower(?) AND deleted_at IS NULL').get(c.tenantId, username)) return { ok: false, error: 'username_taken' };
  const temp = temporaryPassword(); if (checkPassword(temp, { username, blocked: o.blocked }).length) return createAccount(c, input, o); // practically never; draws a new one
  const now = clock(c); const personId = newId(), staffId = newId(); let userId = '';
  const actor = { id: c.actorId, role: roleOf(c) };
  c.db.transaction(() => {
    const env = [now, now, c.actorId, c.actorId] as const;
    c.db.prepare('INSERT INTO person(id,tenant_id,created_at,updated_at,created_by,updated_by,given_name,family_name) VALUES (?,?,?,?,?,?,?,?)').run(personId, c.tenantId, ...env, givenName, familyName);
    // position is never 'teacher': account holders do not appear in the teachers list.
    c.db.prepare("INSERT INTO staff_member(id,tenant_id,created_at,updated_at,created_by,updated_by,person_id,kind,position,branch_id) VALUES (?,?,?,?,?,?,?,'employee',?,?)")
      .run(staffId, c.tenantId, ...env, personId, role === 'director' ? 'administrator' : 'supervisor', branchId);
    const u = createUser(c.db, { tenantId: c.tenantId, staffMemberId: staffId, username, password: temp, actor }, { now: () => now, blocked: o.blocked, argon2: o.argon2 });
    if (!u.ok) throw new Error(u.error);
    userId = u.userId;
    c.db.prepare('UPDATE user_account SET must_change_password = 1, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?').run(now, c.actorId, userId);
    assignRole(c.db, { tenantId: c.tenantId, userId, role, branchId, actor }, now);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: branchId, action: 'account.create', entity_type: 'user_account', entity_id: userId, before_json: null, after_json: JSON.stringify({ username, name: `${givenName} ${familyName}`, role, branchId }), reason: null });
  })();
  return { ok: true, id: userId, username, temporaryPassword: temp };
}

interface Target { id: string; status: string; version: number; username: string }
function target(c: Ctx, id: string): Target | null {
  return (c.db.prepare('SELECT id, status, version, username FROM user_account WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(id, c.tenantId) as Target | undefined) ?? null;
}

/** Disabled accounts cannot sign in; their old activity stays in the log. Never the signed-in person, never the main administrator. */
export function setAccountStatus(c: Ctx, id: string, status: 'active' | 'disabled'): AccountResult {
  if (!allowed(c)) return { ok: false, error: 'forbidden' };
  const t = target(c, id); if (!t) return { ok: false, error: 'not_found' };
  if (status === 'disabled') { if (id === c.actorId) return { ok: false, error: 'self' }; if (id === mainAccountId(c)) return { ok: false, error: 'main_account' }; }
  if (t.status === status) return { ok: true };
  const now = clock(c);
  c.db.transaction(() => {
    c.db.prepare('UPDATE user_account SET status = ?, failed_attempts = 0, locked_until = NULL, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?').run(status, now, c.actorId, id);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: null, action: status === 'disabled' ? 'account.disable' : 'account.enable', entity_type: 'user_account', entity_id: id, before_json: JSON.stringify({ status: t.status }), after_json: JSON.stringify({ status }), reason: null });
  })();
  return { ok: true };
}

export function setAccountRole(c: Ctx, id: string, role: string, branchId: string | null): AccountResult {
  if (!allowed(c)) return { ok: false, error: 'forbidden' };
  const t = target(c, id); if (!t) return { ok: false, error: 'not_found' };
  if (id === mainAccountId(c)) return { ok: false, error: 'main_account' };
  if (id === c.actorId) return { ok: false, error: 'self' };
  const bad = checkRole(c, role, branchId); if (bad) return { ok: false, error: bad };
  const r = role as RoleName; const b = r === 'director' ? null : branchId; const now = clock(c);
  const before = c.db.prepare(`SELECT r.name AS role, a.branch_id AS branchId FROM user_role_assignment a JOIN role r ON r.id = a.role_id WHERE a.user_id = ? AND a.deleted_at IS NULL AND r.deleted_at IS NULL`).all(id);
  c.db.transaction(() => {
    c.db.prepare('UPDATE user_role_assignment SET deleted_at = ?, deleted_by = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE user_id = ? AND deleted_at IS NULL').run(now, c.actorId, now, c.actorId, id);
    assignRole(c.db, { tenantId: c.tenantId, userId: id, role: r, branchId: b, actor: { id: c.actorId, role: roleOf(c) } }, now);
    c.db.prepare('UPDATE staff_member SET branch_id = ?, position = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = (SELECT staff_member_id FROM user_account WHERE id = ?)').run(b, r === 'director' ? 'administrator' : 'supervisor', now, c.actorId, id);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: b, action: 'account.role_change', entity_type: 'user_account', entity_id: id, before_json: JSON.stringify(before), after_json: JSON.stringify({ role: r, branchId: b }), reason: null });
  })();
  return { ok: true };
}

/** The Director sets a new temporary password for someone who forgot theirs; that person must replace it at the next sign-in. Own password: use the change-password form. */
export function resetAccountPassword(c: Ctx, id: string, o: AccountOpts = {}): AccountResult<{ temporaryPassword: string }> {
  if (!allowed(c)) return { ok: false, error: 'forbidden' };
  const t = target(c, id); if (!t) return { ok: false, error: 'not_found' };
  if (id === c.actorId) return { ok: false, error: 'self' };
  const temp = temporaryPassword(); const now = clock(c);
  c.db.transaction(() => {
    c.db.prepare('UPDATE user_account SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?').run(hashPassword(temp, o.argon2), now, c.actorId, id);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: null, action: 'account.password_reset', entity_type: 'user_account', entity_id: id, before_json: null, after_json: '{}', reason: null });
  })();
  return { ok: true, temporaryPassword: temp };
}

export function renameAccount(c: Ctx, id: string, givenNameRaw: string, familyNameRaw: string): AccountResult {
  if (!allowed(c)) return { ok: false, error: 'forbidden' };
  const t = target(c, id); if (!t) return { ok: false, error: 'not_found' };
  const g = cleanName(givenNameRaw), f = cleanName(familyNameRaw); if (!nameOk(g) || !nameOk(f)) return { ok: false, error: 'invalid' };
  const cur = c.db.prepare('SELECT p.id AS pid, p.given_name AS g, p.family_name AS f FROM user_account u JOIN staff_member s ON s.id = u.staff_member_id JOIN person p ON p.id = s.person_id WHERE u.id = ?').get(id) as { pid: string; g: string; f: string };
  if (cur.g === g && cur.f === f) return { ok: true };
  const now = clock(c);
  c.db.transaction(() => {
    c.db.prepare('UPDATE person SET given_name = ?, family_name = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?').run(g, f, now, c.actorId, cur.pid);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: roleOf(c), branch_id: null, action: 'account.rename', entity_type: 'user_account', entity_id: id, before_json: JSON.stringify({ name: `${cur.g} ${cur.f}` }), after_json: JSON.stringify({ name: `${g} ${f}` }), reason: null });
  })();
  return { ok: true };
}

/** First sign-in with a temporary or standard password: the signed-in person chooses their own. No old password is asked, because they have just proven it by signing in;
 *  it works only while the account is flagged "must change". */
export function setFirstPassword(c: { db: Ctx['db']; tenantId: string; userId: string; now?: () => string } & AccountOpts, newPassword: string): { ok: true } | { ok: false; error: 'not_required' | 'weak'; problems?: string[] } {
  const u = c.db.prepare('SELECT id, username, must_change_password AS m FROM user_account WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(c.userId, c.tenantId) as { id: string; username: string; m: number } | undefined;
  if (!u || u.m !== 1) return { ok: false, error: 'not_required' };
  const problems = checkPassword(newPassword, { username: u.username, blocked: c.blocked }); if (problems.length) return { ok: false, error: 'weak', problems: problems.map(String) };
  const now = (c.now ?? nowIso)();
  c.db.transaction(() => {
    c.db.prepare('UPDATE user_account SET password_hash = ?, must_change_password = 0, failed_attempts = 0, locked_until = NULL, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?').run(hashPassword(newPassword, c.argon2), now, u.id, u.id);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: u.id, actor_role: 'user', branch_id: null, action: 'user.password.changed', entity_type: 'user_account', entity_id: u.id, before_json: null, after_json: JSON.stringify({ first: true }), reason: null });
  })();
  return { ok: true };
}

/** True while the account exists and is active: used on every call so that a disabled person is signed out at once. */
export function accountIsActive(db: Ctx['db'], userId: string): boolean {
  return !!db.prepare("SELECT 1 FROM user_account WHERE id = ? AND status = 'active' AND deleted_at IS NULL").get(userId);
}

export interface ActivityEntry { seq: number; at: string; actorId: string; actorName: string; actorRole: string; action: string; entityType: string; entityId: string; branchName: string | null; reason: string | null }
/** The audit log read as "who did what, when" (needs audit.view: the Director). Newest first. */
export function activityLog(c: Ctx, q: { userId?: string; limit?: number; beforeSeq?: number } = {}): { entries: ActivityEntry[]; people: { id: string; name: string }[] } | null {
  if (!authorize(c.assignments, 'audit.view', null).allowed) return null;
  const limit = Math.min(Math.max(Math.trunc(q.limit ?? 200), 1), 500);
  const rows = c.db.prepare(`SELECT a.seq, a.at, a.actor_id AS actorId, a.actor_role AS actorRole, a.action, a.entity_type AS entityType, a.entity_id AS entityId, a.reason, b.name AS branchName,
      CASE WHEN p.id IS NOT NULL THEN p.given_name || ' ' || p.family_name END AS pname
    FROM audit_log a LEFT JOIN user_account u ON u.id = a.actor_id LEFT JOIN staff_member s ON s.id = u.staff_member_id LEFT JOIN person p ON p.id = s.person_id LEFT JOIN branch b ON b.id = a.branch_id
    WHERE a.tenant_id = @t AND a.action NOT IN ('user.create', 'role.assign') AND (@u IS NULL OR a.actor_id = @u) AND (@b IS NULL OR a.seq < @b) ORDER BY a.seq DESC LIMIT @l`)
    .all({ t: c.tenantId, u: q.userId ?? null, b: q.beforeSeq ?? null, l: limit }) as (Omit<ActivityEntry, 'actorName' | 'branchName'> & { pname: string | null; branchName: string | null })[];
  const system: Record<string, string> = { 'recovery-key': 'مفتاح الاسترداد', anonymous: 'قبل الدخول', 'system:setup': 'إعداد البرنامج' };
  const people = (c.db.prepare(`SELECT u.id, p.given_name || ' ' || p.family_name AS name FROM user_account u JOIN staff_member s ON s.id = u.staff_member_id JOIN person p ON p.id = s.person_id WHERE u.tenant_id = ? AND u.deleted_at IS NULL ORDER BY u.created_at, u.id`).all(c.tenantId)) as { id: string; name: string }[];
  return { people, entries: rows.map(({ pname, ...r }) => ({ ...r, actorName: pname ?? system[r.actorId] ?? 'غير معروف' })) };
}
