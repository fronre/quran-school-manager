import { validateSetup, type SetupInput, type SetupIssue } from '@mishkat/domain';
import { appendAudit, newId, nowIso, type Db } from './index';
import { createUser, assignRole, seedRoles, hashPassword } from './auth';
import { randomBytes } from 'node:crypto';
import { storeRecoveryVerifier, acknowledgeRecoveryKey } from './recovery';

export class SetupError extends Error {
  constructor(public code: 'already_set_up' | 'invalid' | 'username_taken', public issues: SetupIssue[] = []) { super(code); }
}
export const isSetUp = (db: Db): boolean => !!db.prepare('SELECT 1 FROM association LIMIT 1').get();

/** WF-01 commit: everything is written in ONE transaction, so an interrupted setup leaves no half-configured association.
 *  The recovery key was generated and confirmed by the user before this is called (SEC-043). */
export function runSetup(db: Db, input: SetupInput, recoveryKey: Buffer, o: { now?: string; blocked?: ReadonlySet<string>; argon2?: { memoryKiB: number; passes: number; parallelism: number }; defaultAccount?: boolean } = {}): { tenantId: string; userId: string } {
  if (isSetUp(db)) throw new SetupError('already_set_up');
  // Standard account (OD-050): username admin, password admin, changed at the first sign-in. The policy is NOT relaxed for anyone else: the account is created with a random strong password and then set to the standard one here, and only here.
  if (o.defaultAccount) input = { ...input, admin: { ...input.admin, username: 'admin', password: randomBytes(24).toString('base64url') } };
  const issues = validateSetup(input, { blocked: o.blocked });
  if (issues.length) throw new SetupError('invalid', issues);
  const now = o.now ?? nowIso(); const tenantId = newId(); const actor = { id: 'system:setup', role: 'system' };
  let userId = '';
  db.transaction(() => {
    const ins = (sql: string, ...a: unknown[]) => db.prepare(sql).run(...a);
    const env = [now, now, actor.id, actor.id] as const;
    ins('INSERT INTO association(id,tenant_id,created_at,updated_at,created_by,updated_by,name,address,contact) VALUES (?,?,?,?,?,?,?,?,?)',
      tenantId, tenantId, ...env, input.association.name.trim(), input.association.address?.trim() || null, input.association.contact?.trim() || null);
    input.branches.forEach((b, n) =>
      ins('INSERT INTO branch(id,tenant_id,created_at,updated_at,created_by,updated_by,name,label,position) VALUES (?,?,?,?,?,?,?,?,?)', newId(), tenantId, ...env, b.name.trim(), b.label?.trim() || null, n + 1));
    ins("INSERT INTO academic_year(id,tenant_id,created_at,updated_at,created_by,updated_by,name,start_date,end_date,status) VALUES (?,?,?,?,?,?,?,?,?,'active')",
      newId(), tenantId, ...env, input.year.name.trim(), input.year.startDate, input.year.endDate);

    const personId = newId(), staffId = newId();
    ins('INSERT INTO person(id,tenant_id,created_at,updated_at,created_by,updated_by,given_name,family_name) VALUES (?,?,?,?,?,?,?,?)', personId, tenantId, ...env, input.admin.givenName.trim(), input.admin.familyName.trim());
    ins("INSERT INTO staff_member(id,tenant_id,created_at,updated_at,created_by,updated_by,person_id,kind,position) VALUES (?,?,?,?,?,?,?,'employee','administrator')", staffId, tenantId, ...env, personId);
    seedRoles(db, tenantId, actor.id, now);
    const u = createUser(db, { tenantId, staffMemberId: staffId, username: input.admin.username.trim(), password: input.admin.password, actor }, { now: () => now, blocked: o.blocked, argon2: o.argon2 });
    if (!u.ok) throw new SetupError(u.error === 'username_taken' ? 'username_taken' : 'invalid');
    userId = u.userId;
    if (o.defaultAccount) db.prepare('UPDATE user_account SET password_hash=?, must_change_password=1, updated_at=?, updated_by=?, version=version+1 WHERE id=?').run(hashPassword('admin', o.argon2), now, actor.id, userId);
    assignRole(db, { tenantId, userId, role: 'director', branchId: null, actor }, now);
    storeRecoveryVerifier(db, tenantId, recoveryKey, now);
    acknowledgeRecoveryKey(db, tenantId, userId, now);
    appendAudit(db, { tenant_id: tenantId, at: now, actor_id: userId, actor_role: 'director', branch_id: null, action: 'setup.complete', entity_type: 'association', entity_id: tenantId, before_json: null, after_json: JSON.stringify({ branches: input.branches.length, year: input.year.name }), reason: null });
  })();
  return { tenantId, userId };
}
