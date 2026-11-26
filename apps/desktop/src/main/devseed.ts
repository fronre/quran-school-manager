import { createUser, assignRole, seedRoles, newId, nowIso, type Db } from '@mishkat/db';

/** DEVELOPMENT ONLY (never runs in a packaged app): creates a throwaway association so the shell can be viewed
 *  before the setup wizard (WF-01) exists. The password is a test value and is not for real use. */
export const DEV_USERNAME = 'dev.director';
export const DEV_PASSWORD = 'dev-only-password-123';

export function devSeed(db: Db): void {
  if (db.prepare('SELECT 1 FROM association LIMIT 1').get()) return;
  const t = newId(), now = nowIso();
  const ins = (sql: string, ...a: unknown[]) => db.prepare(sql).run(...a);
  ins('INSERT INTO association(id,tenant_id,created_at,updated_at,created_by,updated_by,name) VALUES (?,?,?,?,?,?,?)', t, t, now, now, 'dev', 'dev', 'جمعية تجريبية');
  const branch = (name: string, pos: number) => { const id = newId(); ins('INSERT INTO branch(id,tenant_id,created_at,updated_at,created_by,updated_by,name,position) VALUES (?,?,?,?,?,?,?,?)', id, t, now, now, 'dev', 'dev', name, pos); return id; };
  branch('فرع الرجال', 1); branch('فرع النساء', 2);
  const person = newId(), staff = newId();
  ins('INSERT INTO person(id,tenant_id,created_at,updated_at,created_by,updated_by,given_name,family_name) VALUES (?,?,?,?,?,?,?,?)', person, t, now, now, 'dev', 'dev', 'مدير', 'تجريبي');
  ins("INSERT INTO staff_member(id,tenant_id,created_at,updated_at,created_by,updated_by,person_id,kind) VALUES (?,?,?,?,?,?,?,'employee')", staff, t, now, now, 'dev', 'dev', person);
  seedRoles(db, t, 'dev', now);
  const u = createUser(db, { tenantId: t, staffMemberId: staff, username: DEV_USERNAME, password: DEV_PASSWORD, actor: { id: 'dev', role: 'system' } });
  if (!u.ok) throw new Error('dev seed failed');
  assignRole(db, { tenantId: t, userId: u.userId, role: 'director', branchId: null, actor: { id: 'dev', role: 'system' } }, now);
}
