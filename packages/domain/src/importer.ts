/** Student import from a spreadsheet (REQ-016, BR-045). Pure: it turns table rows into validated student inputs and a report.
 *  Nothing here reads files or touches the database; the caller supplies the rows and what already exists. */
import { isValidIsoDate } from './setup';
import { fullNameKey, normalizeName, validateStudent, type StudentInput, type StudentStatus } from './student';

export type StudentField = 'fullName' | 'givenName' | 'familyName' | 'studentNo' | 'birthDate' | 'phone' | 'branch' | 'status' | 'joinedOn';
export const STUDENT_FIELDS: readonly StudentField[] = ['fullName', 'givenName', 'familyName', 'studentNo', 'birthDate', 'phone', 'branch', 'status', 'joinedOn'];
export type Mapping = Partial<Record<StudentField, number>>; // field -> column index (0-based)
export type RawCell = string | number | boolean | Date | null;

const SYNONYMS: Record<StudentField, string[]> = {
  fullName: ['الاسم الكامل', 'الاسم واللقب', 'اللقب والاسم', 'اسم ولقب', 'اسم الطالب', 'الطالب', 'nom complet', 'nom et prenom', 'full name', 'student name'],
  givenName: ['الاسم', 'اسم', 'الاسم الاول', 'prenom', 'first name', 'given name'],
  familyName: ['اللقب', 'لقب', 'النسب', 'nom', 'family name', 'last name', 'surname'],
  studentNo: ['رقم الطالب', 'رقم التسجيل', 'رقم الملف', 'رقم', 'الرقم', 'matricule', 'student no', 'id', 'n'],
  birthDate: ['تاريخ الميلاد', 'تاريخ الازدياد', 'الميلاد', 'الازدياد', 'date de naissance', 'birth date', 'dob'],
  phone: ['الهاتف', 'هاتف الطالب', 'رقم هاتف الطالب', 'رقم الهاتف', 'هاتف', 'الجوال', 'رقم الجوال', 'النقال', 'رقم النقال', 'tel', 'telephone', 'phone', 'mobile'],
  branch: ['الفرع', 'فرع', 'branch'],
  status: ['الحالة', 'حالة', 'status'],
  joinedOn: ['تاريخ الانضمام', 'تاريخ التسجيل', 'تاريخ الالتحاق', 'تاريخ الدخول', 'date inscription', 'joined'],
};
const headerKey = (h: string) => normalizeName(h).replace(/[.:_\-/()]/g, ' ').replace(/\s+/g, ' ').trim();

/** Guesses which column holds what. Only exact header matches (after normalization) are used; the user confirms or fixes it. */
export function suggestMapping(headers: string[]): Mapping {
  const m: Mapping = {};
  const keys = headers.map(headerKey);
  for (const f of STUDENT_FIELDS) {
    const syn = SYNONYMS[f].map(headerKey);
    const i = keys.findIndex((k, idx) => syn.includes(k) && !Object.values(m).includes(idx));
    if (i >= 0) m[f] = i;
  }
  // a lone "الاسم" column almost always holds the full name
  if (m.givenName !== undefined && m.familyName === undefined && m.fullName === undefined) { m.fullName = m.givenName; delete m.givenName; }
  return m;
}

/** Arabic-Indic and Persian digits to Western digits. */
export const westernDigits = (s: string): string => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));

const text = (c: RawCell | undefined): string => (c === null || c === undefined || c instanceof Date ? '' : westernDigits(String(c)).trim());
const rawText = (c: RawCell | undefined): string => (c === null || c === undefined || c instanceof Date ? '' : String(c).trim());

/** Dates: real Excel dates, Excel serial numbers, and text as yyyy-mm-dd, yyyy/mm/dd or day-first dd/mm/yyyy (also - and .). */
export function parseDate(c: RawCell | undefined): { value: string | null; bad: boolean } {
  if (c === null || c === undefined || (typeof c === 'string' && c.trim() === '')) return { value: null, bad: false };
  let iso: string | null = null;
  if (c instanceof Date) { if (!Number.isNaN(c.getTime())) iso = `${String(c.getUTCFullYear()).padStart(4, '0')}-${String(c.getUTCMonth() + 1).padStart(2, '0')}-${String(c.getUTCDate()).padStart(2, '0')}`; }
  else if (typeof c === 'number') { if (c >= 10000 && c <= 80000 && Number.isInteger(Math.floor(c))) iso = new Date(Date.UTC(1899, 11, 30) + Math.floor(c) * 86400000).toISOString().slice(0, 10); }
  else if (typeof c === 'string') {
    const s = westernDigits(c).trim();
    let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
    if (m) iso = `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
    else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) iso = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  }
  return iso && isValidIsoDate(iso) ? { value: iso, bad: false } : { value: null, bad: true };
}

const STATUS_WORDS: [StudentStatus, string[]][] = [
  ['active', ['نشط', 'فعال', 'مسجل', 'مستمر', 'active']], ['suspended', ['موقوف', 'متوقف', 'معلق', 'suspended']],
  ['withdrawn', ['منسحب', 'انسحب', 'مفصول', 'withdrawn']], ['completed', ['اتم', 'اتم الدراسه', 'متخرج', 'خريج', 'ختم', 'completed']],
  ['applicant', ['قيد القبول', 'مقدم', 'طلب', 'انتظار', 'applicant']],
];
export function parseStatus(s: string, fallback: StudentStatus): StudentStatus | null {
  const k = normalizeName(s); if (!k) return fallback;
  for (const [st, words] of STATUS_WORDS) if (words.map(normalizeName).includes(k)) return st;
  return null;
}

const branchKey = (s: string) => normalizeName(s).replace(/^فرع\s+/, '').replace(/^ال/, '').replace(/\s+/g, ' ').trim();
export function matchBranch(s: string, branches: { id: string; name: string }[]): string | null {
  const k = branchKey(s); if (!k) return null;
  const hit = branches.filter((b) => branchKey(b.name) === k);
  return hit.length === 1 ? hit[0]!.id : null;
}

/** "given-first": the first word is the given name. "family-first": the last word is the given name. One word cannot be split. */
export function splitFullName(full: string, order: 'given-first' | 'family-first'): { given: string; family: string } {
  const t = full.trim().split(/\s+/).filter(Boolean);
  if (t.length < 2) return { given: t[0] ?? '', family: '' };
  return order === 'given-first' ? { given: t[0]!, family: t.slice(1).join(' ') } : { given: t[t.length - 1]!, family: t.slice(0, -1).join(' ') };
}

export type ImportIssueCode = 'required' | 'too_long' | 'bad_date' | 'future_date' | 'too_old' | 'bad_phone' | 'bad_status' | 'bad_student_no' | 'unknown_branch' | 'duplicate_in_file' | 'duplicate_number';
export interface ImportIssue { field: string; code: ImportIssueCode }
export interface ImportWarning { code: 'possible_duplicate_in_file' | 'possible_duplicate_existing'; withRow?: number }
export interface ImportRow { row: number; cells: string[]; input: StudentInput | null; issues: ImportIssue[]; warnings: ImportWarning[] }
export interface ImportOptions {
  mapping: Mapping; nameOrder: 'given-first' | 'family-first'; defaultBranchId: string | null; branches: { id: string; name: string }[];
  defaultStatus: StudentStatus; today: string;
}
export interface Existing { numbers: ReadonlySet<string>; people: { key: string; birthDate: string }[]; nextNo: number }
export interface ImportReport { rows: ImportRow[]; total: number; ok: number; withIssues: number; withWarnings: number; mappingProblems: string[] }

/** The mapping must identify a name (full, or given + family). Everything else is optional. */
export function mappingProblems(m: Mapping): string[] {
  const p: string[] = [];
  if (m.fullName === undefined && (m.givenName === undefined || m.familyName === undefined)) p.push('name_columns_missing');
  const used = Object.values(m).filter((v): v is number => v !== undefined);
  if (new Set(used).size !== used.length) p.push('column_used_twice');
  if (m.fullName !== undefined && (m.givenName !== undefined || m.familyName !== undefined)) p.push('full_name_and_parts');
  return p;
}

const pad = (n: number) => String(n).padStart(4, '0');

/** `firstRow` is the sheet row number of rows[0], used only to show users where a problem is. */
export function analyzeImport(rows: RawCell[][], firstRow: number, o: ImportOptions, existing: Existing): ImportReport {
  const mp = mappingProblems(o.mapping);
  if (mp.length) return { rows: [], total: rows.length, ok: 0, withIssues: 0, withWarnings: 0, mappingProblems: mp };
  const cell = (r: RawCell[], f: StudentField) => (o.mapping[f] === undefined ? undefined : r[o.mapping[f]!]);
  const seenNo = new Map<string, number>(); const seenPerson = new Map<string, number>();
  let counter = existing.nextNo;
  // numeric view of used numbers, so "1", "01" and "0001" all count as taken when picking the next free number
  const usedNumeric = new Set<number>();
  const note = (n: string) => { if (/^\d+$/.test(n)) usedNumeric.add(Number(n)); };
  existing.numbers.forEach(note);
  const nextFreeNo = () => { while (usedNumeric.has(counter) || existing.numbers.has(pad(counter)) || seenNo.has(pad(counter))) counter++; const v = pad(counter); usedNumeric.add(counter); counter++; return v; };

  const out: ImportRow[] = rows.map((r, i) => {
    const rowNo = firstRow + i; const issues: ImportIssue[] = []; const warnings: ImportWarning[] = [];
    const cells = r.map((c) => (c instanceof Date ? parseDate(c).value ?? '' : rawText(c)));
    let given = '', family = '';
    if (o.mapping.fullName !== undefined) ({ given, family } = splitFullName(rawText(cell(r, 'fullName')), o.nameOrder));
    else { given = rawText(cell(r, 'givenName')); family = rawText(cell(r, 'familyName')); }

    const branchRaw = rawText(cell(r, 'branch')); let branchId = '';
    if (o.mapping.branch !== undefined && branchRaw) { const b = matchBranch(branchRaw, o.branches); if (b) branchId = b; else issues.push({ field: 'branch', code: 'unknown_branch' }); }
    else if (o.defaultBranchId) branchId = o.defaultBranchId;
    else issues.push({ field: 'branch', code: 'required' });

    const status = parseStatus(rawText(cell(r, 'status')), o.defaultStatus);
    if (status === null) issues.push({ field: 'status', code: 'bad_status' });
    const bd = parseDate(cell(r, 'birthDate')); if (bd.bad) issues.push({ field: 'birthDate', code: 'bad_date' });
    const jd = parseDate(cell(r, 'joinedOn')); if (jd.bad) issues.push({ field: 'joinedOn', code: 'bad_date' });
    const phone = text(cell(r, 'phone')) || null;
    let no = text(cell(r, 'studentNo'));
    if (no && typeof cell(r, 'studentNo') === 'number') no = String(cell(r, 'studentNo'));

    const input: StudentInput = { givenName: given, familyName: family, birthDate: bd.value, phone, branchId, status: status ?? o.defaultStatus, joinedOn: jd.value, studentNo: no };
    return { row: rowNo, cells, input, issues, warnings };
  });

  // numbers: explicit ones first (so auto-numbers never take them), then fill blanks
  for (const r of out) if (r.input!.studentNo) {
    const n = r.input!.studentNo;
    if (seenNo.has(n)) r.issues.push({ field: 'studentNo', code: 'duplicate_in_file' });
    else if (existing.numbers.has(n)) r.issues.push({ field: 'studentNo', code: 'duplicate_number' });
    if (!seenNo.has(n)) seenNo.set(n, r.row);
    note(n);
  }
  for (const r of out) if (!r.input!.studentNo) { r.input!.studentNo = nextFreeNo(); seenNo.set(r.input!.studentNo, r.row); }

  for (const r of out) {
    const inp = r.input!;
    for (const i of validateStudent(inp, o.today)) {
      const field = i.field === 'branchId' ? 'branch' : i.field;
      if (r.issues.some((x) => x.field === field)) continue; // keep the more specific issue found while converting
      r.issues.push({ field, code: i.code as ImportIssueCode });
    }
    if (inp.birthDate && inp.givenName && inp.familyName) {
      const key = `${fullNameKey(inp.givenName, inp.familyName)}|${inp.birthDate}`;
      const prev = seenPerson.get(key);
      if (prev !== undefined) r.warnings.push({ code: 'possible_duplicate_in_file', withRow: prev }); else seenPerson.set(key, r.row);
      if (existing.people.some((p) => p.key === fullNameKey(inp.givenName, inp.familyName) && p.birthDate === inp.birthDate)) r.warnings.push({ code: 'possible_duplicate_existing' });
    }
  }
  const withIssues = out.filter((r) => r.issues.length).length;
  return { rows: out, total: out.length, ok: out.length - withIssues, withIssues, withWarnings: out.filter((r) => r.warnings.length).length, mappingProblems: [] };
}

/** Arabic names of the target fields (mapping screen, reports and the error file). */
export const IMPORT_FIELD_AR: Record<StudentField, string> = {
  fullName: 'الاسم الكامل', givenName: 'الاسم', familyName: 'اللقب', studentNo: 'رقم الطالب', birthDate: 'تاريخ الميلاد',
  phone: 'الهاتف', branch: 'الفرع', status: 'الحالة', joinedOn: 'تاريخ الانضمام',
};
export const IMPORT_ISSUE_AR: Record<ImportIssueCode, string> = {
  required: 'حقل مطلوب فارغ', too_long: 'نص أطول من المسموح', bad_date: 'تاريخ غير صحيح', future_date: 'تاريخ في المستقبل', too_old: 'تاريخ قديم جداً',
  bad_phone: 'رقم هاتف غير صحيح', bad_status: 'حالة غير معروفة', bad_student_no: 'رقم طالب غير صالح', unknown_branch: 'فرع غير معروف',
  duplicate_in_file: 'رقم الطالب مكرر داخل الملف', duplicate_number: 'رقم الطالب مستخدم لطالب موجود',
};
export const IMPORT_WARNING_AR: Record<ImportWarning['code'], string> = {
  possible_duplicate_in_file: 'قد يكون مكرراً لطالب آخر في الملف نفسه (الاسم وتاريخ الميلاد)', possible_duplicate_existing: 'قد يكون مسجّلاً من قبل في البرنامج (الاسم وتاريخ الميلاد)',
};
