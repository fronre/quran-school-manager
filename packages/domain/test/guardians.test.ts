import { describe, it, expect } from 'vitest';
import { normalizePhone, prettyPhone, whatsappUrl, parseRelation, validateGuardian, suggestGuardianMapping, guardianMappingProblems, analyzeGuardianImport, nameWords, type StudentIndexEntry } from '../src';

describe('phone numbers', () => {
  it('accepts national mobile numbers in many written forms', () => {
    for (const raw of ['0550123456', '0550 12 34 56', '05.50.12.34.56', '+213550123456', '00213550123456', '213550123456', '٠٥٥٠١٢٣٤٥٦', 550123456, '(0550) 12-34-56']) expect(normalizePhone(raw), String(raw)).toMatchObject({ ok: true, display: '0550123456', e164: '213550123456', kind: 'mobile', whatsapp: true });
  });
  it('restores the zero that Excel removes from numeric cells', () => { expect(normalizePhone(661234567)).toMatchObject({ ok: true, display: '0661234567' }); expect(normalizePhone('771234567')).toMatchObject({ ok: true, display: '0771234567' }); });
  it('treats other national numbers as landlines (no WhatsApp) and keeps foreign numbers', () => {
    expect(normalizePhone('029123456')).toMatchObject({ ok: true, kind: 'landline', whatsapp: false }); expect(normalizePhone('+33 6 12 34 56 78')).toMatchObject({ ok: true, display: '+33612345678', kind: 'international', whatsapp: true });
  });
  it('rejects things that are not phone numbers', () => { for (const bad of ['', '  ', 'abc', '05501234', '0550123456789', '12', null, undefined, '0550-12-ab', '+1', '99999999999999999']) expect(normalizePhone(bad as never), String(bad)).toEqual({ ok: false }); });
  it('formats for reading and builds a wa.me link with encoded text', () => {
    expect(prettyPhone('0550123456')).toBe('0550 12 34 56'); expect(prettyPhone('+33612345678')).toBe('+33612345678');
    expect(whatsappUrl('213550123456', 'مرحبا؟ & x')).toBe('https://wa.me/213550123456?text=' + encodeURIComponent('مرحبا؟ & x')); expect(() => whatsappUrl('abc', 'x')).toThrow(); expect(() => whatsappUrl('0550123456', 'x')).not.toThrow();
  });
});

describe('guardian rules', () => {
  it('reads relations in Arabic, French and English; unknown text becomes "other"', () => { expect(parseRelation('الأب')).toBe('father'); expect(parseRelation('أم')).toBe('mother'); expect(parseRelation('Père')).toBe('father'); expect(parseRelation('عمّ')).toBe('uncle'); expect(parseRelation('جار')).toBe('other'); expect(parseRelation('')).toBeNull(); });
  it('validates name, phone and relation', () => {
    expect(validateGuardian({ name: 'محمد', phone: '0550123456', relation: 'father', isPrimary: true })).toEqual([]);
    expect(validateGuardian({ name: ' ', phone: 'x', relation: 'zzz' as never, isPrimary: false }).map((i) => i.field)).toEqual(['name', 'phone', 'relation']);
    expect(validateGuardian({ name: 'ا'.repeat(201), phone: '', relation: 'father', isPrimary: false }).map((i) => i.code)).toEqual(['too_long', 'required']);
  });
});

describe('guardian import matching (never guessed)', () => {
  const S = (id: string, no: string, name: string, bd: string | null): StudentIndexEntry => ({ id, studentNo: no, words: nameWords(name), birthDate: bd, name });
  const students = [S('a', '1', 'أحمد بن علي', '2015-03-04'), S('b', '2', 'يوسف بن علي', '2014-01-01'), S('c', '3', 'محمد كريم', '2013-05-05'), S('d', '4', 'محمد كريم', '2012-02-02')];
  const map = { studentNo: 0, studentName: 1, birthDate: 2, guardianName: 3, phone: 4, relation: 5 };
  const run = (rows: (string | number | null)[][], m = map) => analyzeGuardianImport(rows, 1, m, students);
  it('matches by student number first', () => { const r = run([['1', '', null, 'علي', '0550123456', 'الأب']]); expect(r.rows[0]).toMatchObject({ student: { id: 'a' }, phone: '0550123456', relation: 'father', issues: [], warnings: [] }); });
  it('matches by name words in any order, plus birth date; reordered names still match', () => { expect(run([[null, 'علي أحمد بن', '2015-03-04', 'x', '0661234567', null]]).rows[0]!.student?.id).toBe('a'); });
  it('uses a unique name alone only with a warning, and reports ambiguity instead of guessing', () => {
    expect(run([[null, 'يوسف بن علي', null, 'x', '0550123456', null]]).rows[0]).toMatchObject({ student: { id: 'b' }, warnings: ['matched_by_name_only'] });
    expect(run([[null, 'محمد كريم', null, 'x', '0550123456', null]]).rows[0]).toMatchObject({ student: null, issues: ['student_ambiguous'] });
    expect(run([[null, 'محمد كريم', '2012-02-02', 'x', '0550123456', null]]).rows[0]).toMatchObject({ student: { id: 'd' }, issues: [] });
    expect(run([[null, 'محمد كريم', '2000-01-01', 'x', '0550123456', null]]).rows[0]!.issues).toEqual(['student_not_found']);
  });
  it('reports unknown students, missing/bad phones, empty rows and bad dates', () => {
    const r = run([['99', 'مجهول', null, 'x', '0550123456', null], ['2', '', null, 'x', '', null], ['2', '', null, 'x', '12ab', null], [null, '', null, 'x', '0550123456', null], ['1', '', 'not a date', 'x', '0550123456', null]]);
    expect(r.rows.map((x) => x.issues)).toEqual([['student_not_found'], ['phone_required'], ['bad_phone'], ['no_student_column_value'], ['bad_date']]); expect(r.ok).toBe(0); expect(r.withIssues).toBe(5);
  });
  it('flags the same guardian listed twice for the same student', () => { const r = run([['1', '', null, 'a', '0550123456', null], ['1', '', null, 'a', '0550 12 34 56', null]]); expect(r.rows[1]!.warnings).toEqual(['duplicate_in_file']); });
  it('guesses the columns of a typical file and flags missing ones', () => {
    const m = suggestGuardianMapping(['رقم الطالب', 'اسم الطالب', 'تاريخ الميلاد', 'اسم الولي', 'رقم الهاتف', 'صلة القرابة']); expect(m).toEqual({ studentNo: 0, studentName: 1, birthDate: 2, guardianName: 3, phone: 4, relation: 5 });
    expect(guardianMappingProblems({})).toHaveLength(2); expect(guardianMappingProblems({ phone: 1, studentNo: 0 })).toEqual([]); expect(suggestGuardianMapping(['الاسم', 'هاتف'])).toEqual({ studentName: 0, phone: 1 });
    expect(suggestGuardianMapping(['الرقم', 'الاسم واللقب', 'تاريخ الازدياد', 'الفرع', 'هاتف الطالب', 'اسم الولي', 'هاتف الولي', 'صلة القرابة'])).toMatchObject({ studentNo: 0, birthDate: 2, guardianName: 5, relation: 7 }); // the association sample file
  });
});
