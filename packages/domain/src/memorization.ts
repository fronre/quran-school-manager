import { countOrdinals, ordinalOf, unionOrdinals, type AyahRange, type OrdRange } from './quran';

/** Memorization records (BR-032..BR-037). Pure. */
export const MEMO_TYPES = ['new', 'revision', 'consolidation'] as const;
export type MemoType = (typeof MEMO_TYPES)[number];
export const MEMO_TYPE_AR: Record<MemoType, string> = { new: 'حفظ جديد', revision: 'مراجعة', consolidation: 'تثبيت' };

/** Evaluation scale v1 (OD-021 default: a label scale pre-installed; a settings screen for changing it is not built yet).
 *  The label AND its rank are stored with every record, together with the scale version, so changing the scale later cannot change what old records meant (BR-036). */
export const EVAL_SCALE_VERSION = 1;
export const EVAL_SCALE: readonly { rank: number; label: string }[] = [
  { rank: 5, label: 'ممتاز' }, { rank: 4, label: 'جيد جداً' }, { rank: 3, label: 'جيد' }, { rank: 2, label: 'مقبول' }, { rank: 1, label: 'يحتاج مراجعة' },
];
/** Provisional pass mark (OD-024): a new-memorization record counts toward the memorized set from this rank up ("مقبول"). Not an association rule yet. */
export const PASS_RANK = 2;
export const evalLabel = (rank: number): string | null => EVAL_SCALE.find((e) => e.rank === rank)?.label ?? null;

export interface MemoRecordLite { type: MemoType; startOrdinal: number; endOrdinal: number; evalRank: number | null; voided: boolean }
/** Does this record add to the memorized set? Only live, new-memorization records at or above the pass mark (BR-035). */
export const countsAsMemorized = (r: MemoRecordLite, pass = PASS_RANK): boolean => !r.voided && r.type === 'new' && r.evalRank !== null && r.evalRank >= pass;
/** The student's memorized set: the union of qualifying ranges, as merged ordinal ranges (BR-034). */
export function memorizedSet(records: readonly MemoRecordLite[], pass = PASS_RANK): OrdRange[] {
  return unionOrdinals(records.filter((r) => countsAsMemorized(r, pass)).map((r) => [r.startOrdinal, r.endOrdinal] as OrdRange));
}
export const memorizedCount = (records: readonly MemoRecordLite[], pass = PASS_RANK): number => countOrdinals(memorizedSet(records, pass));

export const toOrdinals = (r: AyahRange): OrdRange => [ordinalOf(r.start), ordinalOf(r.end)];
