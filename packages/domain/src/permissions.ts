/** Release 1 desktop permission matrix (USER_ROLES_AND_PERMISSIONS section 4). Deny by default (SEC-020).
 *  Cells marked "?" in that document (open decisions) are NOT granted here until the decision is made. */
export type RoleName = 'director' | 'branch_supervisor' | 'registrar' | 'academic_supervisor';
export type Scope = 'all' | 'branch';

export const PERMISSIONS = [
  'settings.manage', 'staff.manage', 'staff.view', 'staff.edit',
  'student.view', 'student.edit', 'document.manage', 'guardian.edit',
  'group.view', 'group.edit', 'enrollment.manage', 'enrollment.transfer_cross_branch',
  'attendance.view', 'attendance.record', 'attendance.correct',
  'memorization.view', 'memorization.record',
  'announcement.publish', 'report.view', 'report.view_limited',
  'import.run', 'backup.manage', 'audit.view', 'license.manage', 'portal.publish', 'finance.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL_PERMS = Object.fromEntries(PERMISSIONS.map((p) => [p, 'all'])) as Record<Permission, Scope>;

export const ROLE_MATRIX: Record<RoleName, Partial<Record<Permission, Scope>>> = {
  director: ALL_PERMS,
  branch_supervisor: {
    'staff.view': 'branch', 'staff.edit': 'branch',
    'student.view': 'branch', 'student.edit': 'branch', 'document.manage': 'branch', 'guardian.edit': 'branch',
    'group.view': 'branch', 'group.edit': 'branch', 'enrollment.manage': 'branch',
    'attendance.view': 'branch', 'attendance.record': 'branch', 'attendance.correct': 'branch',
    'memorization.view': 'branch', 'memorization.record': 'branch',
    'announcement.publish': 'branch', 'report.view': 'branch',
  },
  registrar: {
    'student.view': 'branch', 'student.edit': 'branch', 'document.manage': 'branch', 'guardian.edit': 'branch',
    'enrollment.manage': 'branch', 'attendance.view': 'branch', 'attendance.record': 'branch', // on behalf of teachers
    'report.view_limited': 'branch',
    // Not granted (open decision): import.run.
  },
  academic_supervisor: {
    'staff.view': 'branch',
    'student.view': 'branch', 'group.view': 'branch', 'attendance.view': 'branch',
    'memorization.view': 'branch', 'memorization.record': 'branch', 'report.view': 'branch',
    // Not granted (open decision): announcement.publish.
  },
};

export interface Assignment { role: RoleName; branchId: string | null } // null = all branches (director only)

/** Domain invariant: only the Director may hold an all-branches assignment (OD-003). */
export function validateAssignment(a: Assignment): string | null {
  if (!(a.role in ROLE_MATRIX)) return 'unknown role';
  if (a.branchId === null && a.role !== 'director') return 'only the director may be assigned to all branches';
  if (a.branchId === '') return 'empty branch id';
  return null;
}

export type Decision = { allowed: true } | { allowed: false; reason: 'no_permission' | 'out_of_scope' };

/** targetBranchId = branch of the record being touched (null for association-wide actions). */
export function authorize(assignments: Assignment[], permission: Permission, targetBranchId: string | null): Decision {
  let sawPermission = false;
  for (const a of assignments) {
    if (validateAssignment(a)) continue;
    const scope = ROLE_MATRIX[a.role][permission];
    if (!scope) continue;
    sawPermission = true;
    if (scope === 'all' && a.branchId === null) return { allowed: true };
    if (a.branchId !== null && targetBranchId !== null && a.branchId === targetBranchId) return { allowed: true };
  }
  return { allowed: false, reason: sawPermission ? 'out_of_scope' : 'no_permission' };
}

/** Which branches may be read or written for a permission; used to build scoped queries. */
export type BranchFilter = { kind: 'all' } | { kind: 'branches'; ids: string[] } | { kind: 'none' };
export function branchFilter(assignments: Assignment[], permission: Permission): BranchFilter {
  const ids = new Set<string>();
  for (const a of assignments) {
    if (validateAssignment(a)) continue;
    const scope = ROLE_MATRIX[a.role][permission];
    if (!scope) continue;
    if (a.branchId === null) { if (scope === 'all') return { kind: 'all' }; continue; }
    ids.add(a.branchId);
  }
  return ids.size ? { kind: 'branches', ids: [...ids].sort() } : { kind: 'none' };
}
