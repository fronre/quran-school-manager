import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrate, newId, verifyAuditLog, type Db } from '../src';
import { hashPassword, verifyPassword, needsRehash, seedRoles, createUser, assignRole, loadAssignments, login, DEFAULT_ARGON2 } from '../src/auth';

const FAST = { memoryKiB: 8, passes: 1, parallelism: 1 }; // tests only; production uses DEFAULT_ARGON2
const T = newId(); const NOW = '2026-09-01T08:00:00.000Z';
const ACTOR = { id: 'system:setup', role: 'system' };

function setup() {
  const db = openDb(':memory:'); migrate(db);
  const r = { id: T, tenant_id: T, created_at: NOW, updated_at: NOW, created_by: 's', updated_by: 's' };
  db.prepare('INSERT INTO association(id,tenant_id,created_at,updated_at,created_by,updated_by,name) VALUES (?,?,?,?,?,?,?)').run(r.id, r.tenant_id, NOW, NOW, 's', 's', 'جمعية');
  const branch = (name: string) => { const id = newId(); db.prepare('INSERT INTO branch(id,tenant_id,created_at,updated_at,created_by,updated_by,name) VALUES (?,?,?,?,?,?,?)').run(id, T, NOW, NOW, 's', 's', name); return id; };
  const staff = () => {
    const p = newId(), s = newId();
    db.prepare('INSERT INTO person(id,tenant_id,created_at,updated_at,created_by,updated_by,given_name,family_name) VALUES (?,?,?,?,?,?,?,?)').run(p, T, NOW, NOW, 's', 's', 'علي', 'الجزائري');
    db.prepare("INSERT INTO staff_member(id,tenant_id,created_at,updated_at,created_by,updated_by,person_id,kind) VALUES (?,?,?,?,?,?,?, 'employee')").run(s, T, NOW, NOW, 's', 's', p);
    return s;
  };
  seedRoles(db, T, 's', NOW);
  return { db, men: branch('فرع الرجال'), women: branch('فرع النساء'), staff };
}

describe('Argon2id hashing (SEC-010)', () => {
  it('round-trips, uses a fresh salt, embeds its parameters', () => {
    const a = hashPassword('كلمة سر طويلة جدا', FAST), b = hashPassword('كلمة سر طويلة جدا', FAST);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^\$argon2id\$v=19\$m=8,t=1,p=1\$/);
    expect(verifyPassword('كلمة سر طويلة جدا', a)).toBe(true);
    expect(verifyPassword('كلمة سر طويلة جدً', a)).toBe(false);
  });
  it('rejects malformed stored hashes instead of throwing', () => {
    expect(verifyPassword('x', 'garbage')).toBe(false);
    expect(verifyPassword('x', '')).toBe(false);
  });
  it('flags old parameters for rehash', () => {
    expect(needsRehash(hashPassword('some-long-password', FAST))).toBe(true);
    expect(needsRehash(hashPassword('some-long-password', DEFAULT_ARGON2))).toBe(false);
  });
  it('normalizes Unicode so the same Arabic/Latin text typed differently still verifies', () => {
    const h = hashPassword('ｐａｓｓｗｏｒｄ-long-1', FAST); // full-width letters
    expect(verifyPassword('password-long-1', h)).toBe(true);
  });
});

describe('seeded roles', () => {
  it('creates the four system roles once (idempotent) with matrix permissions', () => {
    const { db } = setup(); seedRoles(db, T, 's', NOW);
    expect((db.prepare('SELECT count(*) c FROM role').get() as { c: number }).c).toBe(4);
    const n = (r: string) => (db.prepare('SELECT count(*) c FROM role_permission rp JOIN role ON role.id=rp.role_id WHERE role.name=?').get(r) as { c: number }).c;
    expect(n('director')).toBe(26); expect(n('registrar')).toBe(8);
  });
});

describe('users and role assignment', () => {
  let s: ReturnType<typeof setup>; beforeEach(() => { s = setup(); });
  it('rejects weak passwords and duplicate usernames (case-insensitive)', () => {
    const base = { tenantId: T, staffMemberId: s.staff(), actor: ACTOR };
    expect(createUser(s.db, { ...base, username: 'ali', password: 'short' }, { argon2: FAST })).toMatchObject({ ok: false, error: 'weak_password' });
    expect(createUser(s.db, { ...base, username: 'ali', password: 'a-long-password-1' }, { argon2: FAST })).toMatchObject({ ok: true });
    expect(createUser(s.db, { ...base, staffMemberId: s.staff(), username: 'ALI', password: 'a-long-password-2' }, { argon2: FAST })).toEqual({ ok: false, error: 'username_taken' });
  });
  it('never stores the plain password', () => {
    createUser(s.db, { tenantId: T, staffMemberId: s.staff(), username: 'ali', password: 'a-long-password-1', actor: ACTOR }, { argon2: FAST });
    const row = s.db.prepare('SELECT password_hash FROM user_account').get() as { password_hash: string };
    expect(row.password_hash).not.toContain('a-long-password-1');
    expect(JSON.stringify(s.db.prepare('SELECT * FROM audit_log').all())).not.toContain('a-long-password-1');
  });
  it('enforces the assignment invariant in the application layer', () => {
    const r = createUser(s.db, { tenantId: T, staffMemberId: s.staff(), username: 'sup', password: 'a-long-password-1', actor: ACTOR }, { argon2: FAST });
    if (!r.ok) throw new Error('setup');
    expect(() => assignRole(s.db, { tenantId: T, userId: r.userId, role: 'branch_supervisor', branchId: null, actor: ACTOR })).toThrow(/only the director/);
    assignRole(s.db, { tenantId: T, userId: r.userId, role: 'branch_supervisor', branchId: s.men, actor: ACTOR });
    expect(loadAssignments(s.db, r.userId)).toEqual([{ role: 'branch_supervisor', branchId: s.men }]);
  });
  it('assignment changes apply on the next read (SEC-022) and are audited', () => {
    const r = createUser(s.db, { tenantId: T, staffMemberId: s.staff(), username: 'reg', password: 'a-long-password-1', actor: ACTOR }, { argon2: FAST });
    if (!r.ok) throw new Error('setup');
    expect(loadAssignments(s.db, r.userId)).toEqual([]);
    assignRole(s.db, { tenantId: T, userId: r.userId, role: 'registrar', branchId: s.women, actor: ACTOR });
    expect(loadAssignments(s.db, r.userId)).toHaveLength(1);
    expect(s.db.prepare("SELECT count(*) c FROM audit_log WHERE action='role.assign'").get()).toEqual({ c: 1 });
    expect(verifyAuditLog(s.db)).toEqual({ ok: true });
  });
});

describe('login with backoff (SEC-012)', () => {
  let s: ReturnType<typeof setup>; let clock: number; const iso = () => new Date(clock).toISOString();
  const opts = () => ({ argon2: FAST, now: iso });
  const attempt = (pw: string, user = 'ali') => login(s.db, { tenantId: T, username: user, password: pw }, opts());
  beforeEach(() => {
    s = setup(); clock = Date.parse('2026-09-02T09:00:00.000Z');
    const r = createUser(s.db, { tenantId: T, staffMemberId: s.staff(), username: 'ali', password: 'correct-horse-battery', actor: ACTOR }, opts());
    if (!r.ok) throw new Error('setup');
    assignRole(s.db, { tenantId: T, userId: r.userId, role: 'branch_supervisor', branchId: s.men, actor: ACTOR });
  });
  it('succeeds with the right password and returns fresh assignments', () => {
    expect(attempt('correct-horse-battery')).toMatchObject({ ok: true, assignments: [{ role: 'branch_supervisor', branchId: s.men }] });
  });
  it('returns the same generic error for unknown user and wrong password', () => {
    expect(attempt('wrong-password-xx', 'nobody')).toEqual({ ok: false, error: 'invalid_credentials' });
    expect(attempt('wrong-password-xx')).toEqual({ ok: false, error: 'invalid_credentials' });
  });
  it('locks after 5 failures with 30 s delay, even the right password is refused during the lock', () => {
    for (let i = 0; i < 5; i++) attempt('bad-password-xx');
    expect(attempt('correct-horse-battery')).toEqual({ ok: false, error: 'invalid_credentials' });
    clock += 31_000;
    expect(attempt('correct-horse-battery')).toMatchObject({ ok: true });
  });
  it('escalates the delay and resets after a success', () => {
    for (let i = 0; i < 5; i++) attempt('bad-password-xx');
    clock += 31_000; attempt('bad-password-xx'); // 6th failure -> 60 s
    clock += 31_000; expect(attempt('correct-horse-battery').ok).toBe(false); // still locked
    clock += 31_000; expect(attempt('correct-horse-battery').ok).toBe(true);
    const u = s.db.prepare('SELECT failed_attempts, locked_until FROM user_account').get();
    expect(u).toEqual({ failed_attempts: 0, locked_until: null });
  });
  it('audits failures and successes as security events, chain stays valid', () => {
    attempt('bad-password-xx'); attempt('correct-horse-battery'); attempt('x', 'nobody');
    const actions = (s.db.prepare("SELECT action FROM audit_log WHERE action LIKE 'login.%' ORDER BY seq").all() as { action: string }[]).map((r) => r.action);
    expect(actions).toEqual(['login.failed', 'login.success', 'login.failed']);
    expect(verifyAuditLog(s.db)).toEqual({ ok: true });
    expect(JSON.stringify(s.db.prepare('SELECT * FROM audit_log').all())).not.toContain('bad-password-xx');
  });
  it('refuses disabled accounts', () => {
    s.db.prepare("UPDATE user_account SET status='disabled', version=version+1").run();
    expect(attempt('correct-horse-battery').ok).toBe(false);
  });
});
