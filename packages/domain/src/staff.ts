/** Teachers and staff profiles (REQ-020). Pure. Field set is provisional (like OD-013 for students): names, optional birth date and phone,
 *  branch, position and kind. A teacher may later have several groups (BR-003); groups are not built yet. */
import { isValidIsoDate } from './setup';

export const STAFF_POSITIONS = ['teacher', 'supervisor', 'administrator', 'other'] as const;
export type StaffPosition = (typeof STAFF_POSITIONS)[number];
export const STAFF_KINDS = ['employee', 'volunteer'] as const;
export type StaffKind = (typeof STAFF_KINDS)[number];
export const STAFF_POSITION_AR: Record<StaffPosition, string> = { teacher: 'معلم', supervisor: 'مشرف', administrator: 'إداري', other: 'آخر' };
export const STAFF_KIND_AR: Record<StaffKind, string> = { employee: 'موظف', volunteer: 'متطوع' };

export interface StaffInput { givenName: string; familyName: string; birthDate: string | null; phone: string | null; branchId: string; position: StaffPosition; kind: StaffKind }
export type StaffIssueCode = 'required' | 'too_long' | 'bad_date' | 'future_date' | 'too_old' | 'bad_phone' | 'bad_position' | 'bad_kind';
export interface StaffIssue { field: string; code: StaffIssueCode }

const NAME_MAX = 100; const PHONE_RE = /^[0-9+\-() .]{5,30}$/;
export function validateStaff(i: StaffInput, todayIso: string): StaffIssue[] {
  const out: StaffIssue[] = [];
  for (const [field, v] of [['givenName', i.givenName], ['familyName', i.familyName]] as const) {
    if (!v.trim()) out.push({ field, code: 'required' }); else if ([...v].length > NAME_MAX) out.push({ field, code: 'too_long' });
  }
  if (!i.branchId) out.push({ field: 'branchId', code: 'required' });
  if (!(STAFF_POSITIONS as readonly string[]).includes(i.position)) out.push({ field: 'position', code: 'bad_position' });
  if (!(STAFF_KINDS as readonly string[]).includes(i.kind)) out.push({ field: 'kind', code: 'bad_kind' });
  if (i.birthDate) {
    if (!isValidIsoDate(i.birthDate)) out.push({ field: 'birthDate', code: 'bad_date' });
    else if (i.birthDate > todayIso) out.push({ field: 'birthDate', code: 'future_date' });
    else if (i.birthDate < '1900-01-01') out.push({ field: 'birthDate', code: 'too_old' });
  }
  if (i.phone && !PHONE_RE.test(i.phone.trim())) out.push({ field: 'phone', code: 'bad_phone' });
  return out;
}

/** Photos are small JPEG thumbnails stored in the database. These limits are enforced again in the database (CHECK constraints). */
export const PHOTO = { maxInputBytes: 15 * 1024 * 1024, maxStoredBytes: 1024 * 1024, side: 320, quality: 82 } as const;
export const isJpeg = (b: Uint8Array): boolean => b.length > 100 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
