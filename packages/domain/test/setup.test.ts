import { describe, it, expect } from 'vitest';
import { validateSetup, isValidIsoDate, MAX_BRANCHES, type SetupInput } from '../src';

const good = (): SetupInput => ({
  admin: { givenName: 'علي', familyName: 'الجزائري', username: 'ali.director', password: 'عبارة سر طويلة 2026' },
  association: { name: 'جمعية النور القرآنية', address: 'الجزائر', contact: '0550 12 34 56' },
  branches: [{ name: 'فرع الرجال' }, { name: 'فرع النساء' }],
  year: { name: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30' },
});
const codes = (i: SetupInput) => validateSetup(i).map((x) => `${x.field}:${x.code}`);

describe('setup validation (WF-01)', () => {
  it('accepts a complete valid input', () => expect(validateSetup(good())).toEqual([]));
  it('requires names, association, a branch and a year', () => {
    const i = good(); i.admin.givenName = ' '; i.association.name = ''; i.branches = []; i.year.name = '';
    expect(codes(i)).toEqual(expect.arrayContaining(['admin.givenName:required', 'association.name:required', 'branches:required', 'year.name:required']));
  });
  it('validates usernames: allowed characters and length, Arabic letters allowed', () => {
    for (const u of ['ab', 'has space', 'a'.repeat(41), 'bad/char', 'x@y']) { const i = good(); i.admin.username = u; expect(codes(i)).toContain('admin.username:bad_username'); }
    for (const u of ['علي_المدير', 'ali.dir-1', 'abc']) { const i = good(); i.admin.username = u; expect(codes(i)).not.toContain('admin.username:bad_username'); }
    const i = good(); i.admin.username = ''; expect(codes(i)).toContain('admin.username:required');
  });
  it('applies the password policy and reports which rule failed', () => {
    const i = good(); i.admin.password = 'short';
    expect(validateSetup(i)).toContainEqual({ field: 'admin.password', code: 'weak_password', detail: 'too_short' });
    i.admin.username = 'director1'; i.admin.password = 'my-director1-secret';
    expect(validateSetup(i)).toContainEqual({ field: 'admin.password', code: 'weak_password', detail: 'contains_username' });
  });
  it('rejects duplicate branch names regardless of case and spacing, and too many branches', () => {
    const i = good(); i.branches = [{ name: 'Men' }, { name: ' men ' }];
    expect(codes(i)).toContain('branches.1.name:duplicate');
    i.branches = Array.from({ length: MAX_BRANCHES + 1 }, (_, n) => ({ name: `b${n}` }));
    expect(codes(i)).toContain('branches:too_many');
  });
  it('supports a single branch (the model is 1..N, REQ-003)', () => {
    const i = good(); i.branches = [{ name: 'الفرع الرئيسي' }]; expect(validateSetup(i)).toEqual([]);
  });
  it('validates the academic year dates', () => {
    const bad = (s: string, e: string) => { const i = good(); i.year.startDate = s; i.year.endDate = e; return codes(i); };
    expect(bad('2026-02-30', '2027-06-30')).toContain('year.startDate:bad_date');
    expect(bad('2026-09-01', '30/06/2027')).toContain('year.endDate:bad_date');
    expect(bad('', '2027-06-30')).toContain('year.startDate:required');
    expect(bad('2027-06-30', '2026-09-01')).toContain('year.endDate:date_order');
    expect(bad('2026-09-01', '2026-09-01')).toContain('year.endDate:date_order');
    expect(bad('2026-09-01', '2027-06-30')).toEqual([]);
  });
  it('limits field lengths in code points', () => {
    const i = good(); i.association.name = 'ا'.repeat(101); i.association.address = 'x'.repeat(301);
    expect(codes(i)).toEqual(expect.arrayContaining(['association.name:too_long', 'association.address:too_long']));
  });
  it('isValidIsoDate handles leap years and malformed input', () => {
    expect(isValidIsoDate('2028-02-29')).toBe(true); expect(isValidIsoDate('2027-02-29')).toBe(false);
    for (const s of ['', '2026-1-1', '2026-13-01', '2026-00-10', 'abcd-ef-gh']) expect(isValidIsoDate(s), s).toBe(false);
  });
});
