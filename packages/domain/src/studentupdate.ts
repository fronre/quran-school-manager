import { validateStudent, type StudentInput } from './student';
import { parseDate, westernDigits, type RawCell } from './importer';

/** "Update existing students" import: fills in details (birth date, phone, joining date) of students who are ALREADY registered, matched by student number only.
 *  Nothing is created. A cell left empty in the file never erases a value; only differences are applied. Pure. */
export type UpdateField = 'studentNo' | 'birthDate' | 'phone' | 'joinedOn';
export const UPDATE_FIELDS: readonly UpdateField[] = ['studentNo', 'birthDate', 'phone', 'joinedOn'];
export type UpdateMapping = Partial<Record<UpdateField, number>>;
export const UPDATE_FIELD_AR: Record<UpdateField, string> = { studentNo: 'رقم الطالب', birthDate: 'تاريخ الميلاد', phone: 'هاتف الطالب', joinedOn: 'تاريخ الانضمام' };
export function updateMappingProblems(m: UpdateMapping): string[] {
  const p: string[] = []; if (m.studentNo === undefined) p.push('حدّدوا عمود رقم الطالب: به يُعرف الطالب المراد تحديثه.');
  if (m.birthDate === undefined && m.phone === undefined && m.joinedOn === undefined) p.push('حدّدوا عموداً واحداً على الأقل للتحديث: تاريخ الميلاد أو الهاتف أو تاريخ الانضمام.');
  return p;
}
export interface UpdateTarget { id: string; version: number; studentNo: string; input: StudentInput }
export type UpdateIssue = 'no_number' | 'student_not_found' | 'bad_date' | 'future_date' | 'too_old' | 'bad_phone' | 'duplicate_in_file';
export interface UpdateRow { row: number; studentNo: string; student: { id: string; name: string } | null; changes: Partial<Pick<StudentInput, 'birthDate' | 'phone' | 'joinedOn'>>; issues: UpdateIssue[]; unchanged: boolean }
export interface UpdateReport { rows: UpdateRow[]; total: number; toUpdate: number; unchanged: number; withIssues: number }
export const UPDATE_ISSUE_AR: Record<UpdateIssue, string> = { no_number: 'لا رقم طالب في الصف', student_not_found: 'لا يوجد طالب بهذا الرقم', bad_date: 'تاريخ غير مفهوم', future_date: 'تاريخ في المستقبل', too_old: 'تاريخ قديم جداً', bad_phone: 'رقم هاتف غير صحيح', duplicate_in_file: 'الطالب مذكور أكثر من مرة في الملف' };

const text = (c: RawCell | undefined): string => (c === null || c === undefined ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c).trim());

export function analyzeStudentUpdate(rows: RawCell[][], firstRow: number, m: UpdateMapping, byNo: ReadonlyMap<string, UpdateTarget>, today: string): UpdateReport {
  const seen = new Set<string>();
  const out: UpdateRow[] = rows.map((r, i) => {
    const issues: UpdateIssue[] = []; const changes: UpdateRow['changes'] = {};
    const raw = m.studentNo !== undefined ? r[m.studentNo] : null; const no = westernDigits(typeof raw === 'number' ? String(raw) : text(raw)).replace(/\s+/g, '');
    const row = firstRow + i;
    if (!no) return { row, studentNo: '', student: null, changes, issues: ['no_number'], unchanged: false };
    const t = byNo.get(no);
    if (!t) return { row, studentNo: no, student: null, changes, issues: ['student_not_found'], unchanged: false };
    if (seen.has(no)) issues.push('duplicate_in_file'); seen.add(no);
    if (m.birthDate !== undefined && text(r[m.birthDate])) { const d = parseDate(r[m.birthDate]!); if (d.bad || !d.value) issues.push('bad_date'); else if (d.value !== t.input.birthDate) changes.birthDate = d.value; }
    if (m.joinedOn !== undefined && text(r[m.joinedOn])) { const d = parseDate(r[m.joinedOn]!); if (d.bad || !d.value) { if (!issues.includes('bad_date')) issues.push('bad_date'); } else if (d.value !== t.input.joinedOn) changes.joinedOn = d.value; }
    if (m.phone !== undefined && text(r[m.phone])) { const p = westernDigits(typeof r[m.phone] === 'number' ? String(r[m.phone]) : text(r[m.phone])).trim(); if (p !== (t.input.phone ?? '')) changes.phone = p; }
    // validate the merged result with the same rules as a manual edit, and report only what the file changed
    if (Object.keys(changes).length) for (const v of validateStudent({ ...t.input, ...changes }, today)) { if (v.field === 'birthDate' && changes.birthDate !== undefined) issues.push(v.code === 'future_date' ? 'future_date' : v.code === 'too_old' ? 'too_old' : 'bad_date'); else if (v.field === 'phone' && changes.phone !== undefined) issues.push('bad_phone'); else if (v.field === 'joinedOn' && changes.joinedOn !== undefined) issues.push(v.code === 'future_date' ? 'future_date' : 'bad_date'); }
    return { row, studentNo: no, student: { id: t.id, name: `${t.input.givenName} ${t.input.familyName}` }, changes, issues: [...new Set(issues)], unchanged: Object.keys(changes).length === 0 && issues.length === 0 };
  });
  const withIssues = out.filter((r) => r.issues.length).length; const unchanged = out.filter((r) => r.unchanged).length;
  return { rows: out, total: out.length, toUpdate: out.length - withIssues - unchanged, withIssues, unchanged };
}
