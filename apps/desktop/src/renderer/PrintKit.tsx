/** Shared letterhead and footer for everything the program prints. Styles live in styles.css (the print-sheet rules). */
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export function PrintHead({ assoc, title, sub }: { assoc: string; title: string; sub?: string }) {
  return (
    <>
      <header className="ph">
        <div className="ph-id"><span className="ph-logo" aria-hidden="true" /><div><b>{assoc}</b><small>الشهاب · إدارة الجمعية القرآنية</small></div></div>
        <div className="ph-doc"><h1>{title}</h1><p>{sub ? <>{sub} · </> : null}<span className="num">{today()}</span></p></div>
      </header>
      <footer className="pf"><span>{assoc}</span><span>طُبع بتاريخ <span className="num">{today()}</span></span></footer>
    </>
  );
}

/** The surah map for paper: 114 squares, shaded by how much of each surah is memorized (same levels as the screen). */
import { SURAHS } from '@mishkat/domain';
export function PrintSurahMap({ pieces }: { pieces: { surah: number; from: number; to: number }[] }) {
  const per = new Map<number, number>(); for (const p of pieces) per.set(p.surah, (per.get(p.surah) ?? 0) + (p.to - p.from + 1));
  const level = (n: number, t: number) => (n <= 0 ? 0 : n >= t ? 4 : n / t <= 0.25 ? 1 : n / t <= 0.5 ? 2 : 3);
  return (
    <div className="pmap" aria-hidden="true">
      <div className="pmap-grid">{SURAHS.map((s) => <i key={s.no} data-l={level(per.get(s.no) ?? 0, s.ayahCount)}>{s.no}</i>)}</div>
      <div className="pmap-legend">خريطة الحفظ (سورة سورة): <i data-l="0" /> لم يبدأ <i data-l="1" /> أقل من ربع <i data-l="2" /> حتى النصف <i data-l="3" /> أكثر من النصف <i data-l="4" /> كاملة</div>
    </div>
  );
}
