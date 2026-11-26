import { describe, it, expect } from 'vitest';
import { suggestMapping, parseDate, parseStatus, matchBranch, splitFullName, westernDigits, mappingProblems, analyzeImport, fullNameKey, type ImportOptions, type Existing, type RawCell } from '../src';

const BR = [{ id: 'men', name: 'فرع الرجال' }, { id: 'women', name: 'فرع النساء' }];
const opts = (over: Partial<ImportOptions> = {}): ImportOptions => ({ mapping: { fullName: 0 }, nameOrder: 'given-first', defaultBranchId: 'men', branches: BR, defaultStatus: 'active', today: '2026-11-20', ...over });
const none = (): Existing => ({ numbers: new Set(), people: [], nextNo: 1 });

describe('header recognition (suggestMapping)', () => {
  it('maps common Arabic headers, with hamza and tashkeel differences', () => {
    expect(suggestMapping(['الرقم', 'الاسم', 'اللقب', 'تاريخ الازدياد', 'الهاتف', 'الفرع', 'الحالة'])).toEqual({ studentNo: 0, givenName: 1, familyName: 2, birthDate: 3, phone: 4, branch: 5, status: 6 });
    expect(suggestMapping(['إسم الطالب', 'تاريخ الميلاد'])).toEqual({ fullName: 0, birthDate: 1 });
  });
  it('treats a lone "الاسم" as the full name', () => { expect(suggestMapping(['الاسم', 'الهاتف'])).toEqual({ fullName: 0, phone: 1 }); });
  it('maps French and English headers', () => {
    expect(suggestMapping(['Matricule', 'Nom', 'Prénom', 'Date de naissance', 'Téléphone'])).toEqual({ studentNo: 0, familyName: 1, givenName: 2, birthDate: 3, phone: 4 });
    expect(suggestMapping(['First name', 'Last name', 'Mobile'])).toEqual({ givenName: 0, familyName: 1, phone: 2 });
  });
  it('leaves unknown columns unmapped and never uses a column twice', () => {
    const m = suggestMapping(['ملاحظات', 'الاسم الكامل', 'شيء آخر']); expect(m).toEqual({ fullName: 1 });
  });
  it('reports mapping problems', () => {
    expect(mappingProblems({ phone: 1 })).toEqual(['name_columns_missing']);
    expect(mappingProblems({ givenName: 0 })).toEqual(['name_columns_missing']);
    expect(mappingProblems({ givenName: 0, familyName: 0 })).toEqual(['column_used_twice']);
    expect(mappingProblems({ fullName: 0, givenName: 1 })).toContain('full_name_and_parts');
    expect(mappingProblems({ fullName: 0 })).toEqual([]); expect(mappingProblems({ givenName: 0, familyName: 1 })).toEqual([]);
  });
});

describe('cell parsing', () => {
  it('converts Arabic-Indic and Persian digits', () => { expect(westernDigits('٠٥٥٠ ١٢٣۴۵۶')).toBe('0550 123456'); });
  it('parses dates: Excel dates, serial numbers, day-first text, Arabic digits, separators', () => {
    expect(parseDate(new Date(Date.UTC(2015, 2, 10)))).toEqual({ value: '2015-03-10', bad: false });
    expect(parseDate(42073)).toEqual({ value: '2015-03-10', bad: false }); // Excel serial
    expect(parseDate('10/03/2015')).toEqual({ value: '2015-03-10', bad: false }); expect(parseDate('5-6-2015')).toEqual({ value: '2015-06-05', bad: false });
    expect(parseDate('2015.03.10')).toEqual({ value: '2015-03-10', bad: false }); expect(parseDate('١٠/٠٣/٢٠١٥')).toEqual({ value: '2015-03-10', bad: false });
    expect(parseDate(' 2015-3-9 ')).toEqual({ value: '2015-03-09', bad: false });
  });
  it('flags impossible, ambiguous or unreadable dates, and accepts blanks', () => {
    for (const bad of ['31/02/2015', '10/03/15', 'مارس 2015', '13/13/2015', 5, true as unknown as string]) expect(parseDate(bad as RawCell).bad, String(bad)).toBe(true);
    expect(parseDate(null)).toEqual({ value: null, bad: false }); expect(parseDate('  ')).toEqual({ value: null, bad: false });
  });
  it('maps status words, defaults blanks and flags unknown words', () => {
    expect(parseStatus('نشط', 'applicant')).toBe('active'); expect(parseStatus('موقوف', 'active')).toBe('suspended'); expect(parseStatus('أتمّ الدراسة', 'active')).toBe('completed');
    expect(parseStatus('منسحب', 'active')).toBe('withdrawn'); expect(parseStatus('', 'suspended')).toBe('suspended'); expect(parseStatus('غريب', 'active')).toBeNull();
  });
  it('matches branches by short or long name, with or without "فرع" and "ال"', () => {
    for (const s of ['فرع الرجال', 'الرجال', 'رجال', ' فرع  رجال ']) expect(matchBranch(s, BR), s).toBe('men');
    expect(matchBranch('نساء', BR)).toBe('women'); expect(matchBranch('الأطفال', BR)).toBeNull(); expect(matchBranch('', BR)).toBeNull();
  });
  it('splits full names by the chosen order', () => {
    expect(splitFullName('أحمد بن عمر', 'given-first')).toEqual({ given: 'أحمد', family: 'بن عمر' });
    expect(splitFullName('بن عمر أحمد', 'family-first')).toEqual({ given: 'أحمد', family: 'بن عمر' });
    expect(splitFullName('  فاطمة  ', 'given-first')).toEqual({ given: 'فاطمة', family: '' }); expect(splitFullName('', 'given-first')).toEqual({ given: '', family: '' });
  });
});

describe('analyzeImport', () => {
  it('imports clean rows, assigns numbers to blanks and uses the default branch', () => {
    const r = analyzeImport([['أحمد بن عمر'], ['فاطمة بلقاسم']], 2, opts(), none());
    expect(r).toMatchObject({ total: 2, ok: 2, withIssues: 0 });
    expect(r.rows.map((x) => [x.row, x.input!.studentNo, x.input!.branchId, x.input!.status])).toEqual([[2, '0001', 'men', 'active'], [3, '0002', 'men', 'active']]);
  });
  it('auto-numbers around explicit and existing numbers, never reusing one', () => {
    const e: Existing = { numbers: new Set(['0001']), people: [], nextNo: 2 };
    const r = analyzeImport([['أ ب', 5], ['ج د', null], ['هـ و', null]], 2, opts({ mapping: { fullName: 0, studentNo: 1 } }), { ...e, nextNo: 2 });
    expect(r.rows.map((x) => x.input!.studentNo)).toEqual(['5', '0002', '0003']);
    const clash = analyzeImport([['أ ب', '0001']], 2, opts({ mapping: { fullName: 0, studentNo: 1 } }), e);
    expect(clash.rows[0]!.issues).toEqual([{ field: 'studentNo', code: 'duplicate_number' }]);
  });
  it('flags a student number repeated inside the file on the second occurrence only', () => {
    const r = analyzeImport([['أ ب', 'M1'], ['ج د', 'M1']], 2, opts({ mapping: { fullName: 0, studentNo: 1 } }), none());
    expect(r.rows[0]!.issues).toEqual([]); expect(r.rows[1]!.issues).toEqual([{ field: 'studentNo', code: 'duplicate_in_file' }]);
  });
  it('reports row-level problems with the field and a code, and keeps going', () => {
    const rows: RawCell[][] = [['أحمد بوعلام', '10/03/2015', 'رجال', 'نشط'], ['يوسف', '2015-02-30', 'الأطفال', 'غريب'], ['فاطمة بلقاسم', '', 'نساء', '']];
    const r = analyzeImport(rows, 2, opts({ mapping: { fullName: 0, birthDate: 1, branch: 2, status: 3 }, defaultBranchId: null }), none());
    expect(r).toMatchObject({ total: 3, ok: 2, withIssues: 1 });
    expect(r.rows[1]!.issues.map((i) => `${i.field}:${i.code}`).sort()).toEqual(['birthDate:bad_date', 'branch:unknown_branch', 'familyName:required', 'status:bad_status']);
    expect(r.rows[2]!.input).toMatchObject({ branchId: 'women', status: 'active', birthDate: null });
  });
  it('requires a branch when there is neither a column value nor a default', () => {
    const r = analyzeImport([['أ ب']], 2, opts({ defaultBranchId: null }), none());
    expect(r.rows[0]!.issues).toContainEqual({ field: 'branch', code: 'required' });
  });
  it('warns, without blocking, about the same person twice in the file or already in the database (BR-023)', () => {
    const e: Existing = { numbers: new Set(), people: [{ key: fullNameKey('محمد', 'الجزائري'), birthDate: '2014-01-01' }], nextNo: 1 };
    const r = analyzeImport([['أحمد بن عمر', '2015-03-10'], ['احمد بن عُمَر', '10/03/2015'], ['مُحَمَّد الجزائري', '2014-01-01']], 2, opts({ mapping: { fullName: 0, birthDate: 1 } }), e);
    expect(r.rows[1]!.warnings).toEqual([{ code: 'possible_duplicate_in_file', withRow: 2 }]);
    expect(r.rows[2]!.warnings).toEqual([{ code: 'possible_duplicate_existing' }]); expect(r.ok).toBe(3); expect(r.withWarnings).toBe(2);
  });
  it('handles given/family columns, Arabic digits in phone and numeric cells', () => {
    const r = analyzeImport([['أحمد', 'بن عمر', '٠٥٥٠ ١٢ ٣٤ ٥٦', 77]], 2, opts({ mapping: { givenName: 0, familyName: 1, phone: 2, studentNo: 3 } }), none());
    expect(r.rows[0]!.input).toMatchObject({ givenName: 'أحمد', familyName: 'بن عمر', phone: '0550 12 34 56', studentNo: '77' });
    expect(r.rows[0]!.issues).toEqual([]);
  });
  it('rejects future birth dates and bad phones through the shared student rules', () => {
    const r = analyzeImport([['أ ب', '2030-01-01', 'abc']], 2, opts({ mapping: { fullName: 0, birthDate: 1, phone: 2 } }), none());
    expect(r.rows[0]!.issues.map((i) => i.code).sort()).toEqual(['bad_phone', 'future_date']);
  });
  it('returns mapping problems instead of rows when no name column is chosen', () => {
    const r = analyzeImport([['x']], 2, opts({ mapping: { phone: 0 } }), none());
    expect(r.mappingProblems).toEqual(['name_columns_missing']); expect(r.rows).toEqual([]);
  });
  it('a realistic messy sheet: mixed formats, blanks and one broken row', () => {
    const rows: RawCell[][] = [
      [1, 'محمد أمين بلعيد', new Date(Date.UTC(2014, 4, 2)), 'رجال', '0550123456', 'نشط'],
      [2, 'عائشة مسعودي', '١٥/٠٩/٢٠١٣', 'فرع النساء', 661000000, ''],
      [null, 'يوسف حمداني', '', 'الرجال', '', 'موقوف'],
      [4, '', '', 'الرجال', '', ''],
    ];
    const r = analyzeImport(rows, 2, opts({ mapping: { studentNo: 0, fullName: 1, birthDate: 2, branch: 3, phone: 4, status: 5 }, defaultBranchId: null }), none());
    expect(r).toMatchObject({ total: 4, ok: 3, withIssues: 1 });
    expect(r.rows[1]!.input).toMatchObject({ birthDate: '2013-09-15', branchId: 'women', phone: '661000000' });
    expect(r.rows[2]!.input).toMatchObject({ studentNo: '0003', status: 'suspended' });
    expect(r.rows[3]!.issues.map((i) => i.field)).toContain('givenName');
  });
});
