import { describe, it, expect } from 'vitest';
import {
  SURAHS, SURAH_COUNT, TOTAL_AYAT, ordinalOf, refOf, isValidAyah, validateRange, rangeLength, unionOrdinals, countOrdinals, rangeText, surahPieces,
  memorizedCount, memorizedSet, countsAsMemorized, evalLabel, EVAL_SCALE, PASS_RANK, type MemoRecordLite,
} from '../src';

describe('Quran reference data', () => {
  it('has 114 surahs and 6236 ayat in the Kufan count, with contiguous ordinals', () => {
    expect(SURAH_COUNT).toBe(114); expect(TOTAL_AYAT).toBe(6236);
    expect(SURAHS[0]).toMatchObject({ name: 'الفاتحة', ayahCount: 7, firstOrdinal: 1 }); expect(SURAHS[1]).toMatchObject({ name: 'البقرة', ayahCount: 286, firstOrdinal: 8 });
    expect(SURAHS[113]).toMatchObject({ name: 'الناس', ayahCount: 6 }); expect(SURAHS[113]!.firstOrdinal + 5).toBe(6236);
    SURAHS.forEach((s, i) => { expect(s.no).toBe(i + 1); if (i) expect(s.firstOrdinal).toBe(SURAHS[i - 1]!.firstOrdinal + SURAHS[i - 1]!.ayahCount); });
  });
  it('spot-checks well-known ayah counts', () => {
    const c = (n: number) => SURAHS[n - 1]!.ayahCount;
    expect([c(3), c(4), c(9), c(18), c(36), c(55), c(67), c(78), c(103), c(108), c(112), c(113)]).toEqual([200, 176, 129, 110, 83, 78, 30, 40, 3, 3, 4, 5]);
    expect([c(19), c(20), c(26), c(37), c(56), c(76), c(97), c(110)]).toEqual([98, 135, 227, 182, 96, 31, 5, 3]);
  });
  it('maps surah:ayah to ordinals and back for every ayah', () => {
    expect(ordinalOf({ surah: 1, ayah: 1 })).toBe(1); expect(ordinalOf({ surah: 2, ayah: 1 })).toBe(8); expect(ordinalOf({ surah: 114, ayah: 6 })).toBe(6236);
    for (let o = 1; o <= TOTAL_AYAT; o++) expect(ordinalOf(refOf(o))).toBe(o);
  });
  it('rejects ayat that do not exist (BR-012)', () => {
    expect(isValidAyah({ surah: 2, ayah: 286 })).toBe(true); expect(isValidAyah({ surah: 2, ayah: 287 })).toBe(false);
    for (const bad of [{ surah: 0, ayah: 1 }, { surah: 115, ayah: 1 }, { surah: 1, ayah: 0 }, { surah: 1.5, ayah: 1 }, { surah: 1, ayah: NaN }]) expect(isValidAyah(bad)).toBe(false);
    expect(() => ordinalOf({ surah: 2, ayah: 287 })).toThrow(); expect(() => refOf(0)).toThrow(); expect(() => refOf(6237)).toThrow();
  });
});

describe('ranges (BR-033)', () => {
  const R = (a: [number, number], b: [number, number]) => ({ start: { surah: a[0], ayah: a[1] }, end: { surah: b[0], ayah: b[1] } });
  it('validates start/end, ordering and cross-surah spans', () => {
    expect(validateRange(R([1, 1], [1, 7]))).toBeNull(); expect(validateRange(R([1, 5], [2, 3]))).toBeNull(); expect(validateRange(R([1, 3], [1, 3]))).toBeNull();
    expect(validateRange(R([2, 287], [2, 290]))).toBe('invalid_start'); expect(validateRange(R([1, 1], [1, 8]))).toBe('invalid_end'); expect(validateRange(R([2, 5], [2, 4]))).toBe('reversed'); expect(validateRange(R([3, 1], [2, 1]))).toBe('reversed');
  });
  it('measures and prints ranges', () => {
    expect(rangeLength(R([1, 1], [1, 7]))).toBe(7); expect(rangeLength(R([1, 6], [2, 2]))).toBe(4);
    expect(rangeText(R([1, 1], [1, 7]))).toBe('الفاتحة 1–7'); expect(rangeText(R([1, 3], [1, 3]))).toBe('الفاتحة 3'); expect(rangeText(R([2, 285], [3, 3]))).toBe('البقرة 285 – آل عمران 3');
  });
});

describe('union of ranges (BR-034)', () => {
  it('counts overlaps once: 1:1-1:7 plus 1:5-1:7 is 7 ayat, not 10', () => { expect(countOrdinals(unionOrdinals([[1, 7], [5, 7]]))).toBe(7); });
  it('merges overlapping and touching ranges, ignores order and bad input', () => {
    expect(unionOrdinals([[20, 30], [1, 10], [11, 15], [5, 8], [40, 41], [41, 50]])).toEqual([[1, 15], [20, 30], [40, 50]]); expect(unionOrdinals([[5, 1]])).toEqual([]); expect(unionOrdinals([])).toEqual([]);
  });
  it('Overlapping example from BR: 2:1-2:20 and 2:10-2:30 give 30 ayat', () => { expect(countOrdinals(unionOrdinals([[8, 27], [17, 37]]))).toBe(30); });
  it('does not mutate its input', () => { const a: [number, number][] = [[5, 9], [1, 6]]; unionOrdinals(a); expect(a).toEqual([[5, 9], [1, 6]]); });
  it('splits merged ranges per surah and flags whole surahs', () => {
    expect(surahPieces([[1, 7]])).toEqual([{ surah: 1, from: 1, to: 7, whole: true }]);
    expect(surahPieces([[5, 10]])).toEqual([{ surah: 1, from: 5, to: 7, whole: false }, { surah: 2, from: 1, to: 3, whole: false }]);
    expect(surahPieces([[1, 8 + 285]])).toEqual([{ surah: 1, from: 1, to: 7, whole: true }, { surah: 2, from: 1, to: 286, whole: true }]);
  });
});

describe('what counts as memorized (BR-035, BR-036)', () => {
  const rec = (over: Partial<MemoRecordLite>): MemoRecordLite => ({ type: 'new', startOrdinal: 1, endOrdinal: 7, evalRank: 4, voided: false, ...over });
  it('only live new-memorization records at or above the pass mark count', () => {
    expect(countsAsMemorized(rec({}))).toBe(true); expect(countsAsMemorized(rec({ evalRank: PASS_RANK }))).toBe(true); expect(countsAsMemorized(rec({ evalRank: PASS_RANK - 1 }))).toBe(false);
    expect(countsAsMemorized(rec({ type: 'revision' }))).toBe(false); expect(countsAsMemorized(rec({ type: 'consolidation' }))).toBe(false); expect(countsAsMemorized(rec({ voided: true }))).toBe(false); expect(countsAsMemorized(rec({ evalRank: null }))).toBe(false);
  });
  it('revising Al-Fatiha twenty times never inflates progress', () => {
    const rs = [rec({}), ...Array.from({ length: 20 }, () => rec({ type: 'revision' }))]; expect(memorizedCount(rs)).toBe(7); expect(memorizedSet(rs)).toEqual([[1, 7]]);
  });
  it('failing and voided new records do not enter the set; overlapping ones are merged', () => {
    const rs = [rec({ startOrdinal: 8, endOrdinal: 27 }), rec({ startOrdinal: 17, endOrdinal: 37, evalRank: 5 }), rec({ startOrdinal: 100, endOrdinal: 120, evalRank: 1 }), rec({ startOrdinal: 200, endOrdinal: 210, voided: true })];
    expect(memorizedSet(rs)).toEqual([[8, 37]]); expect(memorizedCount(rs)).toBe(30);
  });
  it('has a five-step scale with unique ranks', () => { expect(EVAL_SCALE.map((e) => e.rank)).toEqual([5, 4, 3, 2, 1]); expect(evalLabel(3)).toBe('جيد'); expect(evalLabel(9)).toBeNull(); });
});
