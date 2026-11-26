/** Quran reference data and range logic (BR-012, BR-033, BR-034). Pure; reference-only (names and ayah counts, no Quran text; OD-027 option a).
 *  VERIFY: the ayah counts follow the Kufan numbering used with Hafs from 'Asim (6,236 ayat, basmala not counted as an ayah except in Al-Fatiha).
 *  The source of this table and its license terms still need to be recorded before shipping (OD-027). */
export const QURAN_DATASET_VERSION = 'kufan-6236-v1';

const DATA: readonly (readonly [string, number])[] = [
  ['الفاتحة', 7], ['البقرة', 286], ['آل عمران', 200], ['النساء', 176], ['المائدة', 120], ['الأنعام', 165], ['الأعراف', 206], ['الأنفال', 75], ['التوبة', 129], ['يونس', 109],
  ['هود', 123], ['يوسف', 111], ['الرعد', 43], ['إبراهيم', 52], ['الحجر', 99], ['النحل', 128], ['الإسراء', 111], ['الكهف', 110], ['مريم', 98], ['طه', 135],
  ['الأنبياء', 112], ['الحج', 78], ['المؤمنون', 118], ['النور', 64], ['الفرقان', 77], ['الشعراء', 227], ['النمل', 93], ['القصص', 88], ['العنكبوت', 69], ['الروم', 60],
  ['لقمان', 34], ['السجدة', 30], ['الأحزاب', 73], ['سبأ', 54], ['فاطر', 45], ['يس', 83], ['الصافات', 182], ['ص', 88], ['الزمر', 75], ['غافر', 85],
  ['فصلت', 54], ['الشورى', 53], ['الزخرف', 89], ['الدخان', 59], ['الجاثية', 37], ['الأحقاف', 35], ['محمد', 38], ['الفتح', 29], ['الحجرات', 18], ['ق', 45],
  ['الذاريات', 60], ['الطور', 49], ['النجم', 62], ['القمر', 55], ['الرحمن', 78], ['الواقعة', 96], ['الحديد', 29], ['المجادلة', 22], ['الحشر', 24], ['الممتحنة', 13],
  ['الصف', 14], ['الجمعة', 11], ['المنافقون', 11], ['التغابن', 18], ['الطلاق', 12], ['التحريم', 12], ['الملك', 30], ['القلم', 52], ['الحاقة', 52], ['المعارج', 44],
  ['نوح', 28], ['الجن', 28], ['المزمل', 20], ['المدثر', 56], ['القيامة', 40], ['الإنسان', 31], ['المرسلات', 50], ['النبأ', 40], ['النازعات', 46], ['عبس', 42],
  ['التكوير', 29], ['الانفطار', 19], ['المطففين', 36], ['الانشقاق', 25], ['البروج', 22], ['الطارق', 17], ['الأعلى', 19], ['الغاشية', 26], ['الفجر', 30], ['البلد', 20],
  ['الشمس', 15], ['الليل', 21], ['الضحى', 11], ['الشرح', 8], ['التين', 8], ['العلق', 19], ['القدر', 5], ['البينة', 8], ['الزلزلة', 8], ['العاديات', 11],
  ['القارعة', 11], ['التكاثر', 8], ['العصر', 3], ['الهمزة', 9], ['الفيل', 5], ['قريش', 4], ['الماعون', 7], ['الكوثر', 3], ['الكافرون', 6], ['النصر', 3],
  ['المسد', 5], ['الإخلاص', 4], ['الفلق', 5], ['الناس', 6],
];
export const SURAH_COUNT = DATA.length;
export interface Surah { no: number; name: string; ayahCount: number; /** ordinal of its first ayah (1-based, global) */ firstOrdinal: number }
export const SURAHS: readonly Surah[] = (() => { let o = 1; return DATA.map(([name, ayahCount], i) => { const s = { no: i + 1, name, ayahCount, firstOrdinal: o }; o += ayahCount; return s; }); })();
export const TOTAL_AYAT = SURAHS.reduce((a, s) => a + s.ayahCount, 0);

export interface AyahRef { surah: number; ayah: number }
export const isValidAyah = (r: AyahRef): boolean => Number.isInteger(r.surah) && Number.isInteger(r.ayah) && r.surah >= 1 && r.surah <= SURAH_COUNT && r.ayah >= 1 && r.ayah <= SURAHS[r.surah - 1]!.ayahCount;
/** Global 1-based position of an ayah in the dataset. */
export function ordinalOf(r: AyahRef): number { if (!isValidAyah(r)) throw new RangeError('invalid ayah ' + r.surah + ':' + r.ayah); return SURAHS[r.surah - 1]!.firstOrdinal + r.ayah - 1; }
export function refOf(ordinal: number): AyahRef {
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > TOTAL_AYAT) throw new RangeError('invalid ordinal ' + ordinal);
  let lo = 0, hi = SURAH_COUNT - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (SURAHS[mid]!.firstOrdinal <= ordinal) lo = mid; else hi = mid - 1; }
  return { surah: lo + 1, ayah: ordinal - SURAHS[lo]!.firstOrdinal + 1 };
}

export interface AyahRange { start: AyahRef; end: AyahRef }
export type RangeIssue = 'invalid_start' | 'invalid_end' | 'reversed';
/** BR-033: both ends exist in the dataset and start is not after end. A range may span surahs. */
export function validateRange(r: AyahRange): RangeIssue | null {
  if (!isValidAyah(r.start)) return 'invalid_start'; if (!isValidAyah(r.end)) return 'invalid_end';
  return ordinalOf(r.start) > ordinalOf(r.end) ? 'reversed' : null;
}
export const rangeLength = (r: AyahRange): number => ordinalOf(r.end) - ordinalOf(r.start) + 1;

export type OrdRange = [number, number];
/** BR-034: the union of ordinal ranges, merged (overlapping or touching ranges become one), sorted. Never a sum of lengths. */
export function unionOrdinals(ranges: readonly OrdRange[]): OrdRange[] {
  const sorted = ranges.filter(([a, b]) => a <= b).map(([a, b]) => [a, b] as OrdRange).sort((x, y) => x[0] - y[0] || x[1] - y[1]); const out: OrdRange[] = [];
  for (const r of sorted) { const last = out[out.length - 1]; if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]); else out.push(r); }
  return out;
}
export const countOrdinals = (u: readonly OrdRange[]): number => u.reduce((a, [s, e]) => a + (e - s + 1), 0);

/** Human text of a range: "الفاتحة 1–7", "البقرة 5 – آل عمران 10", single ayah "الفاتحة 3". Numbers are plain digits (shown LTR by the UI). */
export function rangeText(r: AyahRange): string {
  const a = SURAHS[r.start.surah - 1]!, b = SURAHS[r.end.surah - 1]!;
  if (r.start.surah === r.end.surah) return r.start.ayah === r.end.ayah ? `${a.name} ${r.start.ayah}` : `${a.name} ${r.start.ayah}–${r.end.ayah}`;
  return `${a.name} ${r.start.ayah} – ${b.name} ${r.end.ayah}`;
}
/** Splits ordinal ranges into per-surah pieces, so a merged range crossing surahs is shown surah by surah. */
export function surahPieces(u: readonly OrdRange[]): { surah: number; from: number; to: number; whole: boolean }[] {
  const out: { surah: number; from: number; to: number; whole: boolean }[] = [];
  for (const [s, e] of u) { let cur = s; while (cur <= e) { const r = refOf(cur); const sur = SURAHS[r.surah - 1]!; const lastOrd = Math.min(e, sur.firstOrdinal + sur.ayahCount - 1); const to = lastOrd - sur.firstOrdinal + 1; out.push({ surah: r.surah, from: r.ayah, to, whole: r.ayah === 1 && to === sur.ayahCount }); cur = lastOrd + 1; } }
  return out;
}
