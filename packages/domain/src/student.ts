/** Student rules (REQ-010, REQ-013, REQ-014; BR-019, BR-021, BR-022, BR-023). Pure.
 *  Field set = the minimal default of OD-013 (still open): names, optional birth date and phone, branch, status, join date, number. */
import { isValidIsoDate } from './setup';

export const STUDENT_STATUSES = ['applicant', 'active', 'suspended', 'completed', 'withdrawn'] as const; // OD-023 default
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

/** Arabic labels shared by the screens, exports and prints. */
export const STUDENT_STATUS_AR: Record<StudentStatus, string> = { applicant: 'قيد القبول', active: 'نشط', suspended: 'موقوف', completed: 'أتمّ الدراسة', withdrawn: 'منسحب' };

export interface StudentInput {
  givenName: string; familyName: string; birthDate: string | null; phone: string | null;
  branchId: string; status: StudentStatus; joinedOn: string | null; studentNo: string;
}
export type StudentIssueCode = 'required' | 'too_long' | 'bad_date' | 'future_date' | 'too_old' | 'bad_phone' | 'bad_status' | 'bad_student_no';
export interface StudentIssue { field: string; code: StudentIssueCode }

const NAME_MAX = 100;
const PHONE_RE = /^[0-9+\-() .]{5,30}$/;
const STUDENT_NO_RE = /^[\p{L}\p{N}._/-]{1,30}$/u;

export function validateStudent(i: StudentInput, todayIso: string): StudentIssue[] {
  const out: StudentIssue[] = [];
  const name = (field: string, v: string) => {
    if (!v.trim()) out.push({ field, code: 'required' });
    else if ([...v].length > NAME_MAX) out.push({ field, code: 'too_long' });
  };
  name('givenName', i.givenName); name('familyName', i.familyName);
  if (!i.branchId) out.push({ field: 'branchId', code: 'required' });
  if (!(STUDENT_STATUSES as readonly string[]).includes(i.status)) out.push({ field: 'status', code: 'bad_status' });
  if (!i.studentNo.trim()) out.push({ field: 'studentNo', code: 'required' });
  else if (!STUDENT_NO_RE.test(i.studentNo.trim())) out.push({ field: 'studentNo', code: 'bad_student_no' });
  if (i.birthDate) {
    if (!isValidIsoDate(i.birthDate)) out.push({ field: 'birthDate', code: 'bad_date' });
    else if (i.birthDate > todayIso) out.push({ field: 'birthDate', code: 'future_date' });
    else if (i.birthDate < '1900-01-01') out.push({ field: 'birthDate', code: 'too_old' });
  }
  if (i.joinedOn) {
    if (!isValidIsoDate(i.joinedOn)) out.push({ field: 'joinedOn', code: 'bad_date' });
    else if (i.joinedOn > todayIso) out.push({ field: 'joinedOn', code: 'future_date' });
  }
  if (i.phone && !PHONE_RE.test(i.phone.trim())) out.push({ field: 'phone', code: 'bad_phone' });
  return out;
}

/** Search/duplicate key: removes diacritics, tatweel and Quranic marks; unifies alef/hamza forms, ya/alef maqsura and ta marbuta;
 *  strips Latin accents; lower-cases; collapses spaces. Deliberately lossy: it is for matching, never for display. */
export function normalizeName(s: string): string {
  return s.normalize('NFD')
    .replace(/[̀-ًͯ-ٰٟۖ-ۭـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ة/g, 'ه')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}
export const fullNameKey = (given: string, family: string): string => normalizeName(`${given} ${family}`);

/** BR-023: same normalized full name AND same birth date (both present). A warning, never a block. */
export function isLikelyDuplicate(a: { given: string; family: string; birthDate: string | null }, b: { given: string; family: string; birthDate: string | null }): boolean {
  return !!a.birthDate && a.birthDate === b.birthDate && fullNameKey(a.given, a.family) === fullNameKey(b.given, b.family);
}

/** Active students only appear in new attendance lists (BR-021); archived students are hidden from active lists (BR-019). */
export const appearsInNewAttendance = (s: { status: StudentStatus; archivedAt: string | null }): boolean => s.status === 'active' && s.archivedAt === null;
