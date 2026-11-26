import { describe, it, expect } from 'vitest';
import { PERMISSIONS, ROLE_MATRIX, authorize, branchFilter, validateAssignment, checkPassword, backoffSeconds, isLocked, type Assignment, type RoleName } from '../src';

const M = 'branch-men', W = 'branch-women';
const as = (role: RoleName, branchId: string | null): Assignment[] => [{ role, branchId }];

describe('permission matrix: positive and negative for every role and permission (SEC-021)', () => {
  for (const role of Object.keys(ROLE_MATRIX) as RoleName[]) {
    for (const perm of PERMISSIONS) {
      const scope = ROLE_MATRIX[role][perm];
      const home = role === 'director' ? null : M;
      it(`${role} / ${perm}: ${scope ?? 'denied'}`, () => {
        const own = authorize(as(role, home), perm, M);
        const other = authorize(as(role, home), perm, W);
        const assoc = authorize(as(role, home), perm, null);
        if (!scope) { expect(own.allowed).toBe(false); expect(other.allowed).toBe(false); expect(assoc.allowed).toBe(false); return; }
        expect(own.allowed).toBe(true);
        if (role === 'director') { expect(other.allowed).toBe(true); expect(assoc.allowed).toBe(true); }
        else { expect(other).toEqual({ allowed: false, reason: 'out_of_scope' }); expect(assoc.allowed).toBe(false); }
      });
    }
  }
});

describe('authorization edge cases', () => {
  it('denies with no assignments and for unknown roles', () => {
    expect(authorize([], 'student.view', M)).toEqual({ allowed: false, reason: 'no_permission' });
    expect(authorize([{ role: 'hacker' as RoleName, branchId: null }], 'student.view', M).allowed).toBe(false);
  });
  it('a non-director cannot hold an all-branches assignment (OD-003)', () => {
    expect(validateAssignment({ role: 'branch_supervisor', branchId: null })).toMatch(/only the director/);
    expect(authorize(as('branch_supervisor', null), 'student.view', W).allowed).toBe(false);
  });
  it('cross-branch transfer is director only', () => {
    expect(authorize(as('branch_supervisor', M), 'enrollment.transfer_cross_branch', M).allowed).toBe(false);
    expect(authorize(as('director', null), 'enrollment.transfer_cross_branch', M).allowed).toBe(true);
  });
  it('multiple assignments combine per branch, never across branches', () => {
    const a: Assignment[] = [{ role: 'branch_supervisor', branchId: M }, { role: 'academic_supervisor', branchId: W }];
    expect(authorize(a, 'attendance.record', M).allowed).toBe(true);
    expect(authorize(a, 'attendance.record', W).allowed).toBe(false);
    expect(authorize(a, 'memorization.record', W).allowed).toBe(true);
  });
  it('only the director can manage backup, audit view, license, portal publish, staff, settings', () => {
    for (const p of ['backup.manage', 'audit.view', 'license.manage', 'portal.publish', 'staff.manage', 'settings.manage'] as const)
      for (const r of ['branch_supervisor', 'registrar', 'academic_supervisor'] as RoleName[]) expect(authorize(as(r, M), p, null).allowed).toBe(false);
  });
  it('branchFilter returns exactly the permitted branches', () => {
    expect(branchFilter(as('director', null), 'student.view')).toEqual({ kind: 'all' });
    expect(branchFilter(as('registrar', M), 'student.view')).toEqual({ kind: 'branches', ids: [M] });
    expect(branchFilter(as('registrar', M), 'attendance.correct')).toEqual({ kind: 'none' });
    expect(branchFilter([], 'student.view')).toEqual({ kind: 'none' });
  });
});

describe('password policy (SEC-011) and backoff (SEC-012)', () => {
  it('requires length 10 in code points, with no composition rules', () => {
    expect(checkPassword('short')).toContain('too_short');
    expect(checkPassword('كلمة سر طويلة جدا')).toEqual([]);
    expect(checkPassword('aaaaaaaaaa')).toEqual([]);
    expect(checkPassword('          ')).toEqual(['blank']);
  });
  it('blocks listed and username-containing passwords', () => {
    expect(checkPassword('Password123', { blocked: new Set(['password123']) })).toContain('common');
    expect(checkPassword('myadmin-secret-1', { username: 'Admin' })).toContain('contains_username');
  });
  it('backoff: 4 free failures, then 30s, 1m, 5m, 15m cap', () => {
    expect([0, 4, 5, 6, 7, 8, 9, 50].map(backoffSeconds)).toEqual([0, 0, 30, 60, 300, 900, 900, 900]);
  });
  it('isLocked compares ISO timestamps', () => {
    expect(isLocked(null, '2026-01-01T00:00:00.000Z')).toBe(false);
    expect(isLocked('2026-01-01T00:01:00.000Z', '2026-01-01T00:00:00.000Z')).toBe(true);
    expect(isLocked('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')).toBe(false);
  });
});
