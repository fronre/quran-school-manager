import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { SetupInput } from '@mishkat/domain';
import { openDb, migrate, verifyAuditLog, loadAssignments, login, isSetUp, runSetup, SetupError, generateRecoveryKey, checkRecoveryKey, isSetupKeyComplete, saveRecoveryKey, loadRecoveryKey, type Protector } from '../src';

const FAST = { memoryKiB: 8, passes: 1, parallelism: 1 };
const NOW = '2026-09-01T08:00:00.000Z';
const input = (): SetupInput => ({
  admin: { givenName: 'علي', familyName: 'الجزائري', username: 'ali.director', password: 'عبارة سر طويلة 2026' },
  association: { name: 'جمعية النور', address: 'الجزائر', contact: '' },
  branches: [{ name: 'فرع الرجال' }, { name: 'فرع النساء', label: 'نساء' }],
  year: { name: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30' },
});
const fresh = () => { const db = openDb(':memory:'); migrate(db); return db; };

describe('runSetup (WF-01)', () => {
  it('creates association, branches, active year, director, roles, key verifier and audit in one go', () => {
    const db = fresh(); const { key } = generateRecoveryKey();
    const { tenantId, userId } = runSetup(db, input(), key, { now: NOW, argon2: FAST });
    expect(isSetUp(db)).toBe(true);
    expect(db.prepare('SELECT name, address, contact FROM association').get()).toEqual({ name: 'جمعية النور', address: 'الجزائر', contact: null });
    expect(db.prepare('SELECT name, position FROM branch ORDER BY position').all()).toEqual([{ name: 'فرع الرجال', position: 1 }, { name: 'فرع النساء', position: 2 }]);
    expect(db.prepare("SELECT name, status FROM academic_year").all()).toEqual([{ name: '2026-2027', status: 'active' }]);
    expect(db.prepare('SELECT count(*) c FROM role').get()).toEqual({ c: 4 });
    expect(loadAssignments(db, userId)).toEqual([{ role: 'director', branchId: null }]);
    expect(checkRecoveryKey(db, tenantId, key)).toBe(true); expect(isSetupKeyComplete(db, tenantId)).toBe(true);
    expect(verifyAuditLog(db)).toEqual({ ok: true });
    const actions = (db.prepare('SELECT action FROM audit_log ORDER BY seq').all() as { action: string }[]).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['user.create', 'role.assign', 'recovery_key.acknowledged', 'setup.complete']));
  });
  it('lets the new director log in with the chosen credentials', () => {
    const db = fresh(); const { tenantId } = runSetup(db, input(), generateRecoveryKey().key, { now: NOW, argon2: FAST });
    expect(login(db, { tenantId, username: 'ali.director', password: 'عبارة سر طويلة 2026' })).toMatchObject({ ok: true });
  });
  it('refuses to run twice', () => {
    const db = fresh(); runSetup(db, input(), generateRecoveryKey().key, { now: NOW, argon2: FAST });
    expect(() => runSetup(db, input(), generateRecoveryKey().key, { now: NOW, argon2: FAST })).toThrow(SetupError);
    expect(db.prepare('SELECT count(*) c FROM association').get()).toEqual({ c: 1 });
  });
  it('rejects invalid input with issue codes and writes nothing', () => {
    const db = fresh(); const bad = input(); bad.year.endDate = '2026-01-01'; bad.admin.password = 'short';
    try { runSetup(db, bad, generateRecoveryKey().key, { now: NOW, argon2: FAST }); throw new Error('should fail'); }
    catch (e) { expect(e).toBeInstanceOf(SetupError); expect((e as SetupError).issues.map((i) => i.field)).toEqual(expect.arrayContaining(['admin.password', 'year.endDate'])); }
    expect(isSetUp(db)).toBe(false);
  });
  it('is atomic: a failure midway (duplicate branch names reaching the DB) leaves nothing behind', () => {
    const i = input(); const key = generateRecoveryKey().key;
    const db2 = fresh();
    // Force the very last write (the setup audit entry) to fail, after everything else was inserted.
    db2.exec("CREATE TRIGGER boom BEFORE INSERT ON audit_log WHEN NEW.action = 'setup.complete' BEGIN SELECT RAISE(ABORT, 'boom'); END;");
    expect(() => runSetup(db2, i, key, { now: NOW, argon2: FAST })).toThrow(/boom/);
    for (const t of ['association', 'branch', 'academic_year', 'person', 'staff_member', 'user_account', 'role', 'key_material', 'audit_log'])
      expect(db2.prepare(`SELECT count(*) c FROM ${t}`).get(), t).toEqual({ c: 0 });
    expect(isSetUp(db2)).toBe(false);
  });
  it('trims names and stores empty optional fields as NULL', () => {
    const db = fresh(); const i = input(); i.association.name = '  جمعية  '; i.association.address = '   ';
    runSetup(db, i, generateRecoveryKey().key, { now: NOW, argon2: FAST });
    expect(db.prepare('SELECT name, address FROM association').get()).toEqual({ name: 'جمعية', address: null });
  });
});

describe('recovery key keystore (SEC-041)', () => {
  const xor = (b: Buffer) => Buffer.from(b.map((x) => x ^ 0x5a));
  const fake = (ok = true): Protector => ({ available: () => ok, encrypt: xor, decrypt: xor });
  it('round-trips through the protector and never writes the key in clear', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ks-')); const key = randomBytes(32);
    saveRecoveryKey(dir, fake(), key);
    expect(loadRecoveryKey(dir, fake())!.equals(key)).toBe(true);
    const raw = readFileSync(join(dir, readdirSync(dir).find((f) => f.endsWith('.bin'))!));
    expect(raw.includes(key)).toBe(false);
  });
  it('refuses to save without OS protection and returns null when it cannot load', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ks-'));
    expect(() => saveRecoveryKey(dir, fake(false), randomBytes(32))).toThrow(/os_protection_unavailable/);
    expect(loadRecoveryKey(dir, fake())).toBeNull();
    saveRecoveryKey(dir, fake(), randomBytes(32));
    expect(loadRecoveryKey(dir, fake(false))).toBeNull();
    expect(loadRecoveryKey(dir, { available: () => true, encrypt: xor, decrypt: () => { throw new Error('dpapi'); } })).toBeNull();
  });
});
