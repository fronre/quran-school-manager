import { describe, it, expect } from 'vitest';
import { validateStudent, normalizeName, fullNameKey, isLikelyDuplicate, appearsInNewAttendance, STUDENT_STATUSES, type StudentInput } from '../src';

const TODAY = '2026-11-20';
const good = (): StudentInput => ({ givenName: 'مُحَمَّد', familyName: 'بن عمر', birthDate: '2015-03-10', phone: '0550 12 34 56', branchId: 'b1', status: 'active', joinedOn: '2026-09-01', studentNo: '0001' });
const codes = (i: StudentInput) => validateStudent(i, TODAY).map((x) => `${x.field}:${x.code}`);

describe('student validation (REQ-010, BR-022)', () => {
  it('accepts a valid student and a minimal one (optional fields empty)', () => {
    expect(codes(good())).toEqual([]);
    expect(codes({ ...good(), birthDate: null, phone: null, joinedOn: null })).toEqual([]);
  });
  it('requires names, branch and number', () => {
    expect(codes({ ...good(), givenName: ' ', familyName: '', branchId: '', studentNo: '' })).toEqual(['givenName:required', 'familyName:required', 'branchId:required', 'studentNo:required']);
  });
  it('limits lengths in code points and rejects unusual student numbers', () => {
    expect(codes({ ...good(), givenName: 'ا'.repeat(101) })).toContain('givenName:too_long');
    for (const n of ['has space', 'x'.repeat(31), 'a;b', '<b>']) expect(codes({ ...good(), studentNo: n }), n).toContain('studentNo:bad_student_no');
    for (const n of ['0001', 'M-017', 'ط.12', '2026/45']) expect(codes({ ...good(), studentNo: n }), n).toEqual([]);
  });
  it('validates dates: real, not future, not absurdly old', () => {
    expect(codes({ ...good(), birthDate: '2015-02-30' })).toContain('birthDate:bad_date');
    expect(codes({ ...good(), birthDate: '2027-01-01' })).toContain('birthDate:future_date');
    expect(codes({ ...good(), birthDate: '1850-01-01' })).toContain('birthDate:too_old');
    expect(codes({ ...good(), joinedOn: '2030-01-01' })).toContain('joinedOn:future_date');
    expect(codes({ ...good(), birthDate: TODAY })).toEqual([]);
  });
  it('validates phone format and status', () => {
    expect(codes({ ...good(), phone: 'abc' })).toContain('phone:bad_phone');
    expect(codes({ ...good(), phone: '+213 550 12 34 56' })).toEqual([]);
    expect(codes({ ...good(), status: 'deleted' as never })).toContain('status:bad_status');
    expect([...STUDENT_STATUSES]).toEqual(['applicant', 'active', 'suspended', 'completed', 'withdrawn']);
  });
});

describe('Arabic name normalization (search and BR-023)', () => {
  it('ignores tashkeel, tatweel and Quranic marks', () => {
    expect(normalizeName('مُحَمَّدٌ')).toBe(normalizeName('محمد'));
    expect(normalizeName('مـــحمد')).toBe('محمد');
  });
  it('unifies alef/hamza, ya/alef maqsura and ta marbuta forms', () => {
    expect(normalizeName('أحمد')).toBe(normalizeName('احمد')); expect(normalizeName('إبراهيم')).toBe(normalizeName('ابراهيم'));
    expect(normalizeName('آمنة')).toBe(normalizeName('امنه')); expect(normalizeName('موسى')).toBe(normalizeName('موسي'));
    expect(normalizeName('مؤمن')).toBe(normalizeName('مومن')); expect(normalizeName('سائل')).toBe(normalizeName('سايل'));
  });
  it('handles Latin accents, case and spacing, and keeps different names different', () => {
    expect(normalizeName('  Benali   ')).toBe('benali'); expect(normalizeName('Élodie')).toBe('elodie');
    expect(normalizeName('محمد')).not.toBe(normalizeName('احمد'));
    expect(normalizeName('')).toBe('');
  });
  it('fullNameKey combines given and family names', () => {
    expect(fullNameKey('أحمد', 'بن  عمر')).toBe('احمد بن عمر');
  });
});

describe('duplicate detection (BR-023): warn, same name + same birth date', () => {
  const a = { given: 'أحمد', family: 'بن عمر', birthDate: '2015-03-10' };
  it('flags the same child written differently', () => { expect(isLikelyDuplicate(a, { given: 'احمد', family: 'بن عُمَر', birthDate: '2015-03-10' })).toBe(true); });
  it('does not flag different birth dates, missing dates, or different names', () => {
    expect(isLikelyDuplicate(a, { ...a, birthDate: '2015-03-11' })).toBe(false);
    expect(isLikelyDuplicate({ ...a, birthDate: null }, { ...a, birthDate: null })).toBe(false);
    expect(isLikelyDuplicate(a, { ...a, given: 'يوسف' })).toBe(false);
  });
});

describe('attendance eligibility (BR-021, BR-019)', () => {
  it('only active, non-archived students appear in new attendance lists', () => {
    expect(appearsInNewAttendance({ status: 'active', archivedAt: null })).toBe(true);
    expect(appearsInNewAttendance({ status: 'suspended', archivedAt: null })).toBe(false);
    expect(appearsInNewAttendance({ status: 'active', archivedAt: '2026-01-01T00:00:00.000Z' })).toBe(false);
    for (const s of ['applicant', 'completed', 'withdrawn'] as const) expect(appearsInNewAttendance({ status: s, archivedAt: null })).toBe(false);
  });
});
