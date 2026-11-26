import { normalizeName } from './student';
import { normalizePhone } from './phone';
import { parseDate, westernDigits, type RawCell } from './importer';

/** Guardians of students (OD-037). Pure. A guardian is a person with a phone; one guardian may be linked to several students (siblings). */
export const RELATIONS = ['father', 'mother', 'brother', 'sister', 'uncle', 'aunt', 'grandfather', 'grandmother', 'other'] as const;
export type Relation = (typeof RELATIONS)[number];
export const RELATION_AR: Record<Relation, string> = { father: 'الأب', mother: 'الأم', brother: 'الأخ', sister: 'الأخت', uncle: 'العم / الخال', aunt: 'العمة / الخالة', grandfather: 'الجد', grandmother: 'الجدة', other: 'آخر' };
const REL_SYN: Record<string, Relation> = { اب: 'father', أب: 'father', الاب: 'father', والد: 'father', الوالد: 'father', ام: 'mother', أم: 'mother', الام: 'mother', والدة: 'mother', الوالدة: 'mother',
  اخ: 'brother', أخ: 'brother', الاخ: 'brother', اخت: 'sister', أخت: 'sister', الاخت: 'sister', عم: 'uncle', خال: 'uncle', العم: 'uncle', الخال: 'uncle', عمة: 'aunt', خالة: 'aunt', العمة: 'aunt', الخالة: 'aunt', جد: 'grandfather', الجد: 'grandfather', جدة: 'grandmother', الجدة: 'grandmother',
  father: 'father', mother: 'mother', pere: 'father', père: 'father', mere: 'mother', mère: 'mother' };
export function parseRelation(s: string | null | undefined): Relation | null { const k = (s ?? '').trim().toLowerCase(); if (!k) return null; return REL_SYN[k] ?? REL_SYN[normalizeName(k)] ?? 'other'; }

export interface GuardianInput { name: string; phone: string; relation: Relation; isPrimary: boolean }
export type GuardianIssueCode = 'required' | 'too_long' | 'bad_phone' | 'bad_relation';
export interface GuardianIssue { field: keyof GuardianInput; code: GuardianIssueCode }
export function validateGuardian(i: GuardianInput): GuardianIssue[] {
  const out: GuardianIssue[] = []; const n = i.name.trim();
  if (!n) out.push({ field: 'name', code: 'required' }); else if ([...n].length > 200) out.push({ field: 'name', code: 'too_long' });
  if (!i.phone.trim()) out.push({ field: 'phone', code: 'required' }); else if (!normalizePhone(i.phone).ok) out.push({ field: 'phone', code: 'bad_phone' });
  if (!(RELATIONS as readonly string[]).includes(i.relation)) out.push({ field: 'relation', code: 'bad_relation' });
  return out;
}
export const GUARDIAN_ISSUE_AR: Record<GuardianIssueCode, string> = { required: 'مطلوب', too_long: 'أطول من المسموح', bad_phone: 'رقم هاتف غير صحيح', bad_relation: 'صلة القرابة غير معروفة' };

// ---------------- Excel import (matched to students, never guessed) ----------------
export type GuardianField = 'studentNo' | 'studentName' | 'birthDate' | 'guardianName' | 'phone' | 'relation';
export const GUARDIAN_FIELDS: readonly GuardianField[] = ['studentNo', 'studentName', 'birthDate', 'guardianName', 'phone', 'relation'];
export type GuardianMapping = Partial<Record<GuardianField, number>>;
export const GUARDIAN_FIELD_AR: Record<GuardianField, string> = { studentNo: 'رقم الطالب', studentName: 'اسم الطالب', birthDate: 'تاريخ ميلاد الطالب', guardianName: 'اسم الولي', phone: 'هاتف الولي', relation: 'صلة القرابة' };
const SYN: Record<GuardianField, string[]> = {
  studentNo: ['رقم الطالب', 'رقم التسجيل', 'الرقم', 'رقم', 'student no', 'matricule', 'n°', 'id'],
  studentName: ['اسم الطالب', 'الطالب', 'الاسم الكامل للطالب', 'الاسم واللقب', 'الاسم', 'nom eleve', 'student name', 'élève', 'eleve'],
  birthDate: ['تاريخ الميلاد', 'تاريخ ميلاد الطالب', 'تاريخ الازدياد', 'الازدياد', 'الميلاد', 'date naissance', 'birth date', 'dob'],
  guardianName: ['اسم الولي', 'ولي الامر', 'ولي الأمر', 'اسم ولي الامر', 'اسم ولي الأمر', 'الولي', 'اسم الاب', 'اسم الأب', 'nom parent', 'tuteur', 'guardian'],
  phone: ['هاتف الولي', 'رقم هاتف الولي', 'رقم الهاتف', 'الهاتف', 'هاتف', 'نقال', 'رقم الولي', 'mobile', 'telephone', 'téléphone', 'tel', 'phone'],
  relation: ['صلة القرابة', 'القرابة', 'الصلة', 'علاقة', 'lien', 'relation'],
};
const hk = (h: string) => normalizeName(h).replace(/[.:_\-/()]/g, ' ').replace(/\s+/g, ' ').trim();
export function suggestGuardianMapping(headers: string[]): GuardianMapping {
  const m: GuardianMapping = {}; const keys = headers.map(hk);
  for (const f of ['guardianName', 'phone', 'relation', 'birthDate', 'studentNo', 'studentName'] as GuardianField[]) { // specific fields first, so "اسم الولي" is not taken as the student's name
    const syn = SYN[f].map(hk); const i = keys.findIndex((k, idx) => syn.includes(k) && !Object.values(m).includes(idx)); if (i >= 0) m[f] = i;
  }
  return m;
}
export function guardianMappingProblems(m: GuardianMapping): string[] {
  const p: string[] = [];
  if (m.phone === undefined) p.push('حدّدوا عمود هاتف الولي.');
  if (m.studentNo === undefined && m.studentName === undefined) p.push('حدّدوا عمود رقم الطالب أو اسم الطالب لربط الأولياء بالطلاب.');
  return p;
}

export interface StudentIndexEntry { id: string; studentNo: string; /** normalized words, sorted */ words: string; birthDate: string | null; name: string }
export const nameWords = (s: string): string => normalizeName(s).split(/\s+/).filter(Boolean).sort().join(' ');
export type GImportIssue = 'no_student_column_value' | 'student_not_found' | 'student_ambiguous' | 'bad_phone' | 'phone_required' | 'bad_date';
export type GImportWarning = 'matched_by_name_only' | 'duplicate_in_file';
export interface GImportRow { row: number; cells: string[]; student: { id: string; name: string; studentNo: string } | null; guardianName: string; phone: string | null; relation: Relation; issues: GImportIssue[]; warnings: GImportWarning[] }
export interface GImportReport { rows: GImportRow[]; total: number; ok: number; withIssues: number }
export const GIMPORT_ISSUE_AR: Record<GImportIssue, string> = { no_student_column_value: 'لا رقم ولا اسم للطالب في الصف', student_not_found: 'لا يوجد طالب مطابق', student_ambiguous: 'أكثر من طالب مطابق: أضيفوا رقم الطالب أو تاريخ الميلاد', bad_phone: 'رقم هاتف غير صحيح', phone_required: 'لا رقم هاتف', bad_date: 'تاريخ ميلاد غير مفهوم' };
export const GIMPORT_WARNING_AR: Record<GImportWarning, string> = { matched_by_name_only: 'رُبط بالاسم فقط (لا رقم ولا تاريخ ميلاد)', duplicate_in_file: 'مكرر في الملف (الولي نفسه للطالب نفسه)' };

const cell = (r: RawCell[], i: number | undefined): string => { if (i === undefined) return ''; const v = r[i]; if (v === null || v === undefined) return ''; return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim(); };

/** Matches each row to ONE student: by student number; else by name words + birth date; else by name words alone only when exactly one student has them (shown as a warning).
 *  Anything unmatched or ambiguous is reported and never guessed. */
export function analyzeGuardianImport(rows: RawCell[][], firstRow: number, mapping: GuardianMapping, students: readonly StudentIndexEntry[]): GImportReport {
  const byNo = new Map(students.map((s) => [s.studentNo, s])); const byWords = new Map<string, StudentIndexEntry[]>();
  for (const s of students) { const a = byWords.get(s.words) ?? []; a.push(s); byWords.set(s.words, a); }
  const seen = new Set<string>(); const out: GImportRow[] = [];
  rows.forEach((r, idx) => {
    const issues: GImportIssue[] = []; const warnings: GImportWarning[] = [];
    const no = westernDigits(cell(r, mapping.studentNo)).replace(/\s+/g, ''); const nm = cell(r, mapping.studentName); const bdRaw = mapping.birthDate !== undefined ? r[mapping.birthDate] : null;
    const bd = parseDate(bdRaw ?? null); if (bd.bad) issues.push('bad_date');
    let st: StudentIndexEntry | null = null;
    if (!no && !nm) issues.push('no_student_column_value');
    else if (no && byNo.has(no)) st = byNo.get(no)!;
    else if (nm) {
      const cands = byWords.get(nameWords(nm)) ?? [];
      if (bd.value) { const m = cands.filter((c) => c.birthDate === bd.value); if (m.length === 1) st = m[0]!; else if (m.length > 1) issues.push('student_ambiguous'); else issues.push('student_not_found'); }
      else if (cands.length === 1) { st = cands[0]!; warnings.push('matched_by_name_only'); }
      else if (cands.length > 1) issues.push('student_ambiguous'); else issues.push('student_not_found');
    } else issues.push('student_not_found');
    const rawPhone = cell(r, mapping.phone); const ph = rawPhone ? normalizePhone(rawPhone) : null;
    if (!rawPhone) issues.push('phone_required'); else if (!ph || !ph.ok) issues.push('bad_phone');
    const gname = cell(r, mapping.guardianName); const relation = parseRelation(cell(r, mapping.relation)) ?? 'other';
    const display = ph && ph.ok ? ph.display : null;
    if (st && display) { const k = st.id + '|' + display; if (seen.has(k)) warnings.push('duplicate_in_file'); seen.add(k); }
    out.push({ row: firstRow + idx + 1, cells: r.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : c === null ? '' : String(c))), student: st ? { id: st.id, name: st.name, studentNo: st.studentNo } : null, guardianName: gname, phone: display, relation, issues, warnings });
  });
  const withIssues = out.filter((x) => x.issues.length).length;
  return { rows: out, total: out.length, ok: out.length - withIssues, withIssues };
}
