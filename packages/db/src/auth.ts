import { randomBytes, timingSafeEqual } from 'node:crypto';
import { argon2idRaw } from './kdf';
import { ROLE_MATRIX, PERMISSIONS, backoffSeconds, checkPassword, isLocked, validateAssignment, type Assignment, type RoleName, type PasswordProblem } from '@mishkat/domain';
import { appendAudit, newId, nowIso, type Db } from './index';

/** Argon2id parameters are stored inside each hash so they can be raised later (SEC-010).
 *  Defaults must be tuned to ~250-500 ms on the pilot PC (not yet measured there). */
export interface Argon2Params { memoryKiB: number; passes: number; parallelism: number }
export const DEFAULT_ARGON2: Argon2Params = { memoryKiB: 65536, passes: 6, parallelism: 1 };
const TAG = 32;

const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');
export function hashPassword(password: string, p: Argon2Params = DEFAULT_ARGON2, salt: Buffer = randomBytes(16)): string {
  const tag = argon2idRaw({ password: Buffer.from(password.normalize('NFKC'), 'utf8'), salt, memoryKiB: p.memoryKiB, passes: p.passes, parallelism: p.parallelism, tagLength: TAG });
  return `$argon2id$v=19$m=${p.memoryKiB},t=${p.passes},p=${p.parallelism}$${b64(salt)}$${b64(tag)}`;
}

interface Parsed { params: Argon2Params; salt: Buffer; tag: Buffer }
function parse(encoded: string): Parsed | null {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(encoded);
  if (!m) return null;
  return { params: { memoryKiB: +m[1]!, passes: +m[2]!, parallelism: +m[3]! }, salt: Buffer.from(m[4]!, 'base64'), tag: Buffer.from(m[5]!, 'base64') };
}
export function verifyPassword(password: string, encoded: string): boolean {
  const p = parse(encoded); if (!p) return false;
  const tag = argon2idRaw({ password: Buffer.from(password.normalize('NFKC'), 'utf8'), salt: p.salt, memoryKiB: p.params.memoryKiB, passes: p.params.passes, parallelism: p.params.parallelism, tagLength: p.tag.length });
  return tag.length === p.tag.length && timingSafeEqual(tag, p.tag);
}
export function needsRehash(encoded: string, target: Argon2Params = DEFAULT_ARGON2): boolean {
  const p = parse(encoded); if (!p) return true;
  return p.params.memoryKiB < target.memoryKiB || p.params.passes < target.passes || p.params.parallelism !== target.parallelism;
}

export interface Actor { id: string; role: string }
export interface AuthOptions { argon2?: Argon2Params; blocked?: ReadonlySet<string>; now?: () => string }

/** Creates the four system roles and their permissions from the domain matrix (idempotent per tenant). */
export function seedRoles(db: Db, tenantId: string, actorId: string, now = nowIso()): void {
  db.transaction(() => {
    for (const role of Object.keys(ROLE_MATRIX) as RoleName[]) {
      if (db.prepare('SELECT 1 FROM role WHERE tenant_id=? AND name=? AND deleted_at IS NULL').get(tenantId, role)) continue;
      const roleId = newId();
      db.prepare('INSERT INTO role(id,tenant_id,created_at,updated_at,created_by,updated_by,name,is_system) VALUES (?,?,?,?,?,?,?,1)').run(roleId, tenantId, now, now, actorId, actorId, role);
      for (const perm of PERMISSIONS) if (ROLE_MATRIX[role][perm])
        db.prepare('INSERT INTO role_permission(id,tenant_id,created_at,updated_at,created_by,updated_by,role_id,permission_code) VALUES (?,?,?,?,?,?,?,?)').run(newId(), tenantId, now, now, actorId, actorId, roleId, perm);
    }
  })();
}

export type CreateUserResult = { ok: true; userId: string } | { ok: false; error: 'weak_password'; problems: PasswordProblem[] } | { ok: false; error: 'username_taken' };
export function createUser(db: Db, a: { tenantId: string; staffMemberId: string; username: string; password: string; actor: Actor }, o: AuthOptions = {}): CreateUserResult {
  const problems = checkPassword(a.password, { username: a.username, blocked: o.blocked });
  if (problems.length) return { ok: false, error: 'weak_password', problems };
  if (db.prepare('SELECT 1 FROM user_account WHERE tenant_id=? AND lower(username)=lower(?) AND deleted_at IS NULL').get(a.tenantId, a.username)) return { ok: false, error: 'username_taken' };
  const id = newId(); const now = (o.now ?? nowIso)(); const hash = hashPassword(a.password, o.argon2);
  db.transaction(() => {
    db.prepare('INSERT INTO user_account(id,tenant_id,created_at,updated_at,created_by,updated_by,staff_member_id,username,password_hash) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, a.tenantId, now, now, a.actor.id, a.actor.id, a.staffMemberId, a.username, hash);
    appendAudit(db, { tenant_id: a.tenantId, at: now, actor_id: a.actor.id, actor_role: a.actor.role, branch_id: null, action: 'user.create', entity_type: 'user_account', entity_id: id, before_json: null, after_json: JSON.stringify({ username: a.username }), reason: null });
  })();
  return { ok: true, userId: id };
}

export function assignRole(db: Db, a: { tenantId: string; userId: string; role: RoleName; branchId: string | null; actor: Actor }, now = nowIso()): void {
  const problem = validateAssignment({ role: a.role, branchId: a.branchId });
  if (problem) throw new Error(`invalid assignment: ${problem}`);
  const roleRow = db.prepare('SELECT id FROM role WHERE tenant_id=? AND name=? AND deleted_at IS NULL').get(a.tenantId, a.role) as { id: string } | undefined;
  if (!roleRow) throw new Error('role not seeded');
  const id = newId();
  db.transaction(() => {
    db.prepare('INSERT INTO user_role_assignment(id,tenant_id,created_at,updated_at,created_by,updated_by,user_id,role_id,branch_id) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, a.tenantId, now, now, a.actor.id, a.actor.id, a.userId, roleRow.id, a.branchId);
    appendAudit(db, { tenant_id: a.tenantId, at: now, actor_id: a.actor.id, actor_role: a.actor.role, branch_id: a.branchId, action: 'role.assign', entity_type: 'user_role_assignment', entity_id: id, before_json: null, after_json: JSON.stringify({ user: a.userId, role: a.role, branch: a.branchId }), reason: null });
  })();
}

/** Read fresh on every call: permission changes apply on the next action (SEC-022). */
export function loadAssignments(db: Db, userId: string): Assignment[] {
  const rows = db.prepare(`SELECT r.name AS role, a.branch_id AS branchId FROM user_role_assignment a JOIN role r ON r.id = a.role_id
    WHERE a.user_id=? AND a.deleted_at IS NULL AND r.deleted_at IS NULL ORDER BY r.name, a.branch_id`).all(userId) as { role: RoleName; branchId: string | null }[];
  return rows;
}

export type LoginResult = { ok: true; userId: string; assignments: Assignment[]; mustChangePassword: boolean } | { ok: false; error: 'invalid_credentials' };
// One generic failure for unknown user, wrong password, disabled and locked accounts: no account enumeration (SEC-012).
const DUMMY = hashPassword('dummy-password-for-timing', { memoryKiB: 8, passes: 1, parallelism: 1 });

export function login(db: Db, a: { tenantId: string; username: string; password: string }, o: AuthOptions = {}): LoginResult {
  const now = (o.now ?? nowIso)();
  const u = db.prepare('SELECT id, password_hash, status, failed_attempts, locked_until, version FROM user_account WHERE tenant_id=? AND lower(username)=lower(?) AND deleted_at IS NULL')
    .get(a.tenantId, a.username) as { id: string; password_hash: string; status: string; failed_attempts: number; locked_until: string | null; version: number } | undefined;
  const audit = (action: string, entityId: string, extra: Record<string, unknown>) => appendAudit(db, { tenant_id: a.tenantId, at: now, actor_id: u?.id ?? 'anonymous', actor_role: 'anonymous', branch_id: null, action, entity_type: 'user_account', entity_id: entityId, before_json: null, after_json: JSON.stringify(extra), reason: null });
  if (!u) { verifyPassword(a.password, DUMMY); audit('login.failed', 'unknown', { reason: 'unknown_user' }); return { ok: false, error: 'invalid_credentials' }; }
  if (u.status !== 'active') { verifyPassword(a.password, DUMMY); audit('login.failed', u.id, { reason: 'disabled' }); return { ok: false, error: 'invalid_credentials' }; }
  if (isLocked(u.locked_until, now)) { verifyPassword(a.password, DUMMY); audit('login.blocked', u.id, { until: u.locked_until }); return { ok: false, error: 'invalid_credentials' }; }
  if (verifyPassword(a.password, u.password_hash)) {
    db.prepare('UPDATE user_account SET failed_attempts=0, locked_until=NULL, last_login_at=?, updated_at=?, updated_by=?, version=version+1 WHERE id=?').run(now, now, u.id, u.id);
    audit('login.success', u.id, {});
    const must = (db.prepare('SELECT must_change_password m FROM user_account WHERE id=?').get(u.id) as { m: number }).m === 1;
    return { ok: true, userId: u.id, assignments: loadAssignments(db, u.id), mustChangePassword: must };
  }
  const failed = u.failed_attempts + 1; const delay = backoffSeconds(failed);
  const until = delay ? new Date(Date.parse(now) + delay * 1000).toISOString() : null;
  db.prepare('UPDATE user_account SET failed_attempts=?, locked_until=?, updated_at=?, updated_by=?, version=version+1 WHERE id=?').run(failed, until, now, u.id, u.id);
  audit('login.failed', u.id, { reason: 'bad_password', failed_attempts: failed, locked_until: until });
  return { ok: false, error: 'invalid_credentials' };
}
