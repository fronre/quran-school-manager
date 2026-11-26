import { useCallback, useEffect, useState } from 'react';
import { studentsWord } from './api';

interface Overview { year: { id: string; name: string; startDate: string; endDate: string } | null; groups: number; openEnrollments: number; closedYears: { id: string; name: string }[] }
interface PlanRow { fromGroupId: string; fromName: string; branchId: string; branchName: string; yearName: string; candidates: number; suggested: { id: string; name: string } | null; targets: { id: string; name: string }[] }
type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const call = <T,>(channel: string, payload?: unknown) => window.mishkat.invoke(channel, payload) as Promise<T>;
const ERR: Record<string, string> = {
  forbidden: 'لا تملكون صلاحية هذا الإجراء.', invalid: 'اكتبوا اسماً للعام الجديد.', dates: 'تأكدوا من التاريخين: البداية قبل النهاية.', overlap: 'العام الجديد يجب أن يبدأ بعد نهاية العام الحالي، ولا يتداخل مع عام آخر.',
  duplicate_name: 'يوجد عام بهذا الاسم. اختاروا اسماً آخر.', not_found: 'لم يعد هذا العنصر متاحاً. أعيدوا تحميل الصفحة.', group_closed: 'الفوج الهدف مغلق.', branch_mismatch: 'الفوج الهدف من فرع آخر.', not_closed_year: 'هذا الفوج ليس من عام مُقفَل.', no_active_year: 'لا يوجد عام دراسي نشط.',
};
const nextName = (n: string) => { const m = n.match(/^(\d{4})\D+(\d{4})$/); return m ? `${Number(m[1]) + 1}-${Number(m[2]) + 1}` : ''; };
const shiftYear = (d: string, by: number) => { const y = Number(d.slice(0, 4)) + by; return `${y}${d.slice(4)}`; };

/** Settings section: close the academic year, open the next one, then carry students over group by group. Nothing moves by itself. */
export function YearSection({ onChanged }: { onChanged?: () => void }) {
  const [ov, setOv] = useState<Overview | null | undefined>(undefined); const [plan, setPlan] = useState<PlanRow[] | null>(null); const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', start: '', end: '', copy: true, word: '' }); const [banner, setBanner] = useState<string | null>(null); const [note, setNote] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<Record<string, string>>({});
  const load = useCallback(async () => { setOv((await call<{ overview: Overview | null }>('year.overview')).overview); const p = (await call<{ plan: PlanRow[] | null }>('year.plan')).plan; setPlan(p); setTarget(Object.fromEntries((p ?? []).map((r) => [r.fromGroupId, r.suggested?.id ?? '']))); }, []);
  useEffect(() => { load(); }, [load]);
  if (ov === undefined) return null;
  if (ov === null) return null; // only people who manage settings see this
  const y = ov.year;
  function begin() { if (!y) return; setF({ name: nextName(y.name), start: shiftYear(y.startDate, 1), end: shiftYear(y.endDate, 1), copy: true, word: '' }); setBanner(null); setNote(null); setOpen(true); }
  async function start() {
    setBusy(true); setBanner(null); const r = await call<Res<{ copiedGroups: number; endedEnrollments: number }>>('year.start', { name: f.name, startDate: f.start, endDate: f.end, copyGroups: f.copy }); setBusy(false);
    if (r.ok) { setOpen(false); setNote(`أُقفل العام وفُتح «${f.name}». نُسخ ${r.copiedGroups} من الأفواج، وانتهى تسجيل ${r.endedEnrollments} طالباً في العام السابق. انقلوا الطلاب إلى أفواج العام الجديد من الجدول أدناه.`); await load(); onChanged?.(); } else setBanner(ERR[r.error] ?? 'تعذّر الإجراء. لم يتغير شيء.');
  }
  async function carry(row: PlanRow) {
    const to = target[row.fromGroupId]; if (!to) return; setBusy(true); setBanner(null); const r = await call<Res<{ moved: number; skipped: number }>>('year.carryOver', { fromGroupId: row.fromGroupId, toGroupId: to }); setBusy(false);
    if (r.ok) { setNote(`نُقل ${r.moved} ${studentsWord(r.moved)} من «${row.fromName}».${r.skipped ? ` لم يُنقل ${r.skipped} (مؤرشفون أو غير نشطين).` : ''}`); await load(); } else setBanner(ERR[r.error] ?? 'تعذّر النقل.');
  }
  const pending = (plan ?? []).filter((r) => r.candidates > 0);
  return (
    <section className="step-box"><h2>السنة الدراسية</h2>
      {note && <div className="banner info" role="status">{note}</div>}{banner && <div className="banner error" role="alert">{banner}</div>}
      {y ? <p>العام الحالي: <b className="num">{y.name}</b> (<span className="num">{y.startDate}</span> إلى <span className="num">{y.endDate}</span>) — <span className="num">{ov.groups}</span> من الأفواج النشطة و<span className="num">{ov.openEnrollments}</span> تسجيلاً مفتوحاً.</p> : <p className="helper">لا يوجد عام دراسي نشط.</p>}
      {y && !open && <button className="btn" onClick={begin}>إقفال العام وفتح عام جديد</button>}
      {open && y && (
        <div className="confirm">
          <p><b>إقفال «{y.name}» عملية مقصودة تُسجَّل في السجل.</b> يُنهى تسجيل كل الطلاب في أفواج هذا العام (يبقى السجل والحضور والحفظ محفوظاً)، ويُفتح العام الجديد. لا ينتقل أي طالب تلقائياً: تنقلونهم أنتم فوجاً فوجاً بعد ذلك. المتأخرات المالية للعام المُقفَل تبقى في سجلاته ولا تظهر في تقرير المتأخرات الجاري.</p>
          <div className="grid2">
            <div className="field"><label htmlFor="yn">اسم العام الجديد</label><input id="yn" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="ys">يبدأ</label><input id="ys" type="date" className="ltr" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></div>
          </div>
          <div className="grid2"><div className="field"><label htmlFor="ye">ينتهي</label><input id="ye" type="date" className="ltr" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></div>
            <div className="field"><label className="check"><input type="checkbox" checked={f.copy} onChange={(e) => setF({ ...f, copy: e.target.checked })} /> انسخوا الأفواج النشطة (بأسمائها ومعلميها وسعتها) إلى العام الجديد</label></div></div>
          <div className="field"><label htmlFor="yw">اكتبوا كلمة «إقفال» للمتابعة</label><input id="yw" value={f.word} onChange={(e) => setF({ ...f, word: e.target.value })} autoComplete="off" /></div>
          <div className="row"><button className="btn danger" disabled={busy || f.word.trim() !== 'إقفال' || !f.name.trim()} onClick={start}>إقفال العام وفتح الجديد</button><button className="btn" onClick={() => setOpen(false)}>إلغاء</button></div>
        </div>
      )}
      {plan && plan.length > 0 && (
        <>
          <h3>نقل الطلاب إلى العام الجديد ({plan[0]!.yearName} ← العام الحالي)</h3>
          {pending.length === 0 ? <p className="helper">لا طلاب ينتظرون النقل.</p> : <p className="helper">لكل فوج من العام السابق اختاروا فوجه في العام الجديد، ثم «نقل». يبدأ الطلاب من أول يوم في العام الجديد. المؤرشفون وغير النشطين لا يُنقلون.</p>}
          <div className="grid-wrap"><table className="grid" aria-label="نقل الطلاب"><thead><tr><th scope="col">الفوج السابق</th><th scope="col">الفرع</th><th scope="col">طلاب ينتظرون</th><th scope="col">إلى الفوج</th><th scope="col" /></tr></thead>
            <tbody>{plan.map((r) => (
              <tr key={r.fromGroupId}><td><b>{r.fromName}</b></td><td>{r.branchName}</td><td className="num">{r.candidates}</td>
                <td>{r.candidates > 0 && <select aria-label={`فوج ${r.fromName} الجديد`} value={target[r.fromGroupId] ?? ''} onChange={(e) => setTarget({ ...target, [r.fromGroupId]: e.target.value })}><option value="">اختاروا فوجاً</option>{r.targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}</td>
                <td>{r.candidates > 0 && <button className="btn" disabled={busy || !target[r.fromGroupId]} onClick={() => carry(r)}>نقل</button>}</td></tr>))}</tbody></table></div>
        </>
      )}
      {ov.closedYears.length > 0 && <p className="helper">أعوام مُقفلة: {ov.closedYears.map((c) => c.name).join('، ')}</p>}
    </section>
  );
}
