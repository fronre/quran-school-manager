import { useCallback, useEffect, useState } from 'react';
import { SURAHS, MEMO_TYPES, MEMO_TYPE_AR, validateRange, ordinalOf, TOTAL_AYAT, type MemoType } from '@mishkat/domain';
import { groupsApi, type GroupRow } from './groupsApi';
import type { UserView } from './api';

interface Piece { surah: number; name: string; from: number; to: number; whole: boolean }
interface Summary { memorizedAyat: number; totalAyat: number; passRank: number; scale: { rank: number; label: string }[]; pieces: Piece[]; wholeSurahs: number; counts: { new: number; revision: number; consolidation: number }; lastDate: string | null }
interface Row { id: string; date: string; type: MemoType; rangeText: string; ayat: number; groupName: string; evalRank: number | null; evalLabel: string | null; comment: string | null; voided: boolean; voidReason: string | null; counts: boolean }
interface GRow { studentId: string; studentNo: string; name: string; memorizedAyat: number; pct: number; wholeSurahs: number; lastDate: string | null; newCount: number; revisionCount: number; consolidationCount: number }
type Res = { ok: true } | { ok: false; error: string; detail?: string };
const call = <T,>(channel: string, payload?: unknown) => window.mishkat.invoke(channel, payload) as Promise<T>;
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const ERR: Record<string, string> = {
  forbidden: 'لا تملكون صلاحية هذا الإجراء.', not_found: 'لم يعد هذا السجل متاحاً. أعيدوا تحميل الصفحة.', invalid_range: 'المدى غير صحيح: تأكدوا أن الآيتين موجودتان وأن البداية قبل النهاية.', invalid: 'راجعوا التاريخ والملاحظة (حتى 300 حرف).',
  future_date: 'لا يمكن تسجيل تاريخ لم يأتِ بعد.', not_enrolled: 'الطالب لم يكن مسجَّلاً في فوج في هذا التاريخ.', invalid_eval: 'اختاروا تقديراً من القائمة.', eval_required: 'التقدير مطلوب للحفظ الجديد.',
  reason_required: 'اكتبوا السبب (حتى 300 حرف).', already_voided: 'السجل مُلغى من قبل.',
};
const TYPE_TONE: Record<MemoType, string> = { new: 'ok', revision: 'teal', consolidation: 'neutral' };
export const useMemoAccess = () => { const [a, setA] = useState<{ canView: boolean; canRecord: boolean } | null>(null); useEffect(() => { call<{ canView: boolean; canRecord: boolean }>('memo.access').then(setA); }, []); return a; };

function AyahPicker({ idp, label, surah, ayah, onChange }: { idp: string; label: string; surah: number; ayah: string; onChange: (s: number, a: string) => void }) {
  return (
    <div className="ayah-pick"><div className="field"><label htmlFor={idp + 's'}>{label === 'من' ? 'من سورة' : 'إلى سورة'}</label><select id={idp + 's'} value={surah} onChange={(e) => onChange(Number(e.target.value), ayah)}>{SURAHS.map((x) => <option key={x.no} value={x.no}>{x.name}</option>)}</select></div>
      <div className="field"><label htmlFor={idp + 'a'}>{label === 'من' ? 'من آية' : 'إلى آية'}</label><input id={idp + 'a'} className="ltr ayah-no" inputMode="numeric" placeholder={`1–${SURAHS[surah - 1]!.ayahCount}`} value={ayah} onChange={(e) => onChange(surah, e.target.value.replace(/\D/g, '').slice(0, 3))} /></div>
    </div>
  );
}

/** Surah map: one square per surah (114), shaded by how much of it is memorized. Click a square to start a new record at that surah. */
function SurahMap({ pieces, onPick }: { pieces: Piece[]; onPick?: (surah: number) => void }) {
  const per = new Map<number, number>(); for (const p of pieces) per.set(p.surah, (per.get(p.surah) ?? 0) + (p.to - p.from + 1));
  const [hover, setHover] = useState<number | null>(null);
  const level = (n: number, total: number) => (n <= 0 ? 0 : n >= total ? 4 : n / total <= 0.25 ? 1 : n / total <= 0.5 ? 2 : 3);
  const info = (no: number) => { const s = SURAHS[no - 1]!; const n = per.get(no) ?? 0; return `${s.no}. ${s.name} — ${n} من ${s.ayahCount} آية${n >= s.ayahCount ? ' (كاملة)' : ''}`; };
  return (
    <div className="surah-map-wrap">
      <div className="surah-map" role="group" aria-label="خريطة الحفظ: سورة سورة">
        {SURAHS.map((s) => { const n = per.get(s.no) ?? 0; return (
          <button key={s.no} type="button" className="sm-cell" style={{ ['--i' as string]: s.no }} data-l={level(n, s.ayahCount)} title={info(s.no)} aria-label={info(s.no)} disabled={!onPick}
            onMouseEnter={() => setHover(s.no)} onFocus={() => setHover(s.no)} onMouseLeave={() => setHover(null)} onBlur={() => setHover(null)} onClick={() => onPick?.(s.no)} />); })}
      </div>
      <div className="sm-foot"><span className="sm-hover" aria-live="polite">{hover ? info(hover) : onPick ? 'مرّروا المؤشر على أي مربع لاسم السورة، واضغطوا عليه لبدء تسجيل منها.' : 'مرّروا المؤشر على أي مربع لاسم السورة.'}</span>
        <span className="sm-legend" aria-hidden="true">أقل <i data-l="0" /><i data-l="1" /><i data-l="2" /><i data-l="3" /><i data-l="4" /> أكثر</span></div>
    </div>
  );
}

/** A student's memorization: stats, surah map, entry form and history. Used in the student's profile and from the group page. */
export function StudentMemo({ studentId, canRecord, onChanged }: { studentId: string; canRecord: boolean; onChanged?: () => void }) {
  const [data, setData] = useState<{ summary: Summary; records: Row[] } | null | undefined>(undefined); const [banner, setBanner] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ date: todayStr(), type: 'new' as MemoType, s1: 1, a1: '', s2: 1, a2: '', rank: '', comment: '' });
  const [voiding, setVoiding] = useState<Row | null>(null); const [reason, setReason] = useState(''); const [note, setNote] = useState<string | null>(null);
  const [att, setAtt] = useState<{ present: number; late: number; recorded: number } | null>(null);
  const load = useCallback(async () => {
    const p = (await call<{ progress: { summary: Summary; records: Row[] } | null }>('memo.progress', { studentId })).progress; setData(p);
    if (p) setF((x) => (x.rank === '' && x.type === 'new' ? { ...x, rank: String(p.summary.scale.find((e) => e.rank === p.summary.passRank + 1)?.rank ?? p.summary.passRank) } : x));
  }, [studentId]);
  useEffect(() => { setData(undefined); load(); call<{ totals: { present: number; late: number; recorded: number } | null }>('attendance.ofStudent', { studentId }).then((r) => setAtt(r.totals)).catch(() => setAtt(null)); }, [load, studentId]);
  if (data === undefined) return null;
  if (data === null) return <div className="banner error">لا تملكون صلاحية عرض حفظ هذا الطالب.</div>;
  const { summary: s, records } = data;
  const a1 = Number(f.a1), a2 = Number(f.a2); const filled = f.a1 !== '' && f.a2 !== '';
  const issue = filled ? validateRange({ start: { surah: f.s1, ayah: a1 }, end: { surah: f.s2, ayah: a2 } }) : null;
  const issueText = issue === 'invalid_start' ? 'آية البداية غير موجودة في هذه السورة.' : issue === 'invalid_end' ? 'آية النهاية غير موجودة في هذه السورة.' : issue === 'reversed' ? (f.s1 === f.s2 ? `نهاية المدى قبل بدايته. اختاروا آية أكبر من ${a1} أو تساويها.` : 'نهاية المدى قبل بدايته. اختاروا سورة النهاية بعد سورة البداية أو مثلها.') : null;
  // how many ayat of the entered range are already memorized (counted once, BR-034)
  const overlap = (() => {
    if (!filled || issue || f.type !== 'new') return 0; const lo = ordinalOf({ surah: f.s1, ayah: a1 }), hi = ordinalOf({ surah: f.s2, ayah: a2 }); let n = 0;
    for (const p of s.pieces) { const x = ordinalOf({ surah: p.surah, ayah: p.from }), y = ordinalOf({ surah: p.surah, ayah: p.to }); n += Math.max(0, Math.min(hi, y) - Math.max(lo, x) + 1); } return n;
  })();
  const surahsTouched = new Set(s.pieces.map((p) => p.surah)).size; const rate = att && att.recorded > 0 ? Math.round(((att.present + att.late) / att.recorded) * 100) : null;
  function pickSurah(no: number) { const piece = s.pieces.filter((p) => p.surah === no).sort((x, y) => y.to - x.to)[0]; const next = piece && piece.to < SURAHS[no - 1]!.ayahCount ? piece.to + 1 : 1; setF((x) => ({ ...x, s1: no, a1: String(next), s2: no, a2: '' })); }
  async function suggest() { const r = await call<{ next: { surah: number; ayah: number } | null }>('memo.suggest', { studentId }); if (r.next) setF((x) => ({ ...x, s1: r.next!.surah, a1: String(r.next!.ayah), s2: r.next!.surah, a2: String(r.next!.ayah) })); else setNote('لا يوجد حفظ جديد سابق لاقتراح الآية التالية.'); }
  async function save() {
    setBusy(true); setBanner(null); setNote(null);
    const r = await call<Res>('memo.record', { studentId, date: f.date, type: f.type, start: { surah: f.s1, ayah: a1 }, end: { surah: f.s2, ayah: a2 }, evalRank: f.rank === '' ? null : Number(f.rank), comment: f.comment.trim() || null }); setBusy(false);
    if (r.ok) { setNote('تم حفظ السجل.'); setF({ ...f, a1: '', a2: '', comment: '' }); await load(); onChanged?.(); } else setBanner(ERR[r.error] ?? 'تعذّر الحفظ. أعيدوا المحاولة.');
  }
  async function doVoid() { if (!voiding) return; setBusy(true); const r = await call<Res>('memo.void', { recordId: voiding.id, reason }); setBusy(false); if (r.ok) { setVoiding(null); setReason(''); await load(); onChanged?.(); } else setBanner(ERR[r.error] ?? 'تعذّر الإلغاء.'); }
  return (
    <div className="memo memo-layout">
      <div className="memo-main">
        <div className="memo-stats">
          <div><b className="num">{s.memorizedAyat}</b><span>آية محفوظة من <span className="num">{TOTAL_AYAT}</span> (<span className="num">{Math.round((s.memorizedAyat / TOTAL_AYAT) * 1000) / 10}%</span>)</span></div>
          <div><b className="num">{surahsTouched}</b><span>سورة بدأها أو أتمها <small>(كاملة: <span className="num">{s.wholeSurahs}</span>)</small></span></div>
          <div><b className="num">{rate === null ? '—' : rate + '%'}</b><span>نسبة الحضور هذا العام</span></div>
          <div><b className="num">{s.counts.new} / {s.counts.revision} / {s.counts.consolidation}</b><span>جديد / مراجعة / تثبيت</span></div>
        </div>
        <p className="helper">المحفوظ = اتحاد مدى الحفظ الجديد الذي قُدِّر «{s.scale.find((e) => e.rank === s.passRank)?.label}» فأعلى. المراجعة والتثبيت لا يغيّران المحفوظ، والتداخل يُحسب مرة واحدة.</p>
        <SurahMap pieces={s.pieces} onPick={canRecord ? pickSurah : undefined} />
        {records.length === 0 ? <div className="empty"><div className="niche" aria-hidden="true" /><h2>لا سجلات بعد</h2><p>{canRecord ? 'سجّلوا أول حفظ أو مراجعة من النموذج.' : 'لم يُسجَّل شيء بعد.'}</p></div> : (
          <>
            <h3 className="memo-sub">آخر التسجيلات</h3>
            <div className="grid-wrap"><table className="grid" aria-label="سجل الحفظ"><thead><tr><th scope="col">التاريخ</th><th scope="col">النوع</th><th scope="col">المدى</th><th scope="col">الآيات</th><th scope="col">التقدير</th><th scope="col">ملاحظة</th>{canRecord && <th scope="col" />}</tr></thead>
              <tbody>{records.map((r) => (
                <tr key={r.id} className={r.voided ? 'voided' : undefined}><td className="num">{r.date}</td><td><span className={`badge ${TYPE_TONE[r.type]}`}><i aria-hidden="true" />{MEMO_TYPE_AR[r.type]}</span></td><td><b>{r.rangeText}</b></td><td className="num">{r.ayat}</td>
                  <td>{r.evalLabel ?? '—'}{r.type === 'new' && !r.voided && !r.counts && <small className="helper"> لا يدخل في المحفوظ</small>}</td><td>{r.voided ? <span className="helper">مُلغى: {r.voidReason}</span> : r.comment ?? ''}</td>
                  {canRecord && <td>{!r.voided && <button className="btn quiet" onClick={() => { setVoiding(r); setReason(''); }}>إلغاء</button>}</td>}</tr>))}</tbody></table></div>
          </>
        )}
      </div>
      <aside className="memo-side">
        {banner && <div className="banner error" role="alert">{banner}</div>}{note && <div className="banner info" role="status">{note}</div>}
        {canRecord && (
          <section className="inline-panel memo-form-panel" aria-label="تسجيل حفظ"><h3>تسجيل جديد</h3>
            <div className="field"><span className="lbl">النوع</span><div className="seg wide" role="group" aria-label="نوع السجل">{MEMO_TYPES.map((t) => <button key={t} aria-pressed={f.type === t} onClick={() => setF({ ...f, type: t, rank: t === 'new' && f.rank === '' ? String(s.passRank + 1) : f.rank })}>{MEMO_TYPE_AR[t]}</button>)}</div></div>
            <AyahPicker idp="m1" label="من" surah={f.s1} ayah={f.a1} onChange={(sn, a) => setF((x) => ({ ...x, s1: sn, a1: a, ...(x.s2 === x.s1 && x.a2 === '' ? { s2: sn } : {}) }))} />
            <AyahPicker idp="m2" label="إلى" surah={f.s2} ayah={f.a2} onChange={(sn, a) => setF({ ...f, s2: sn, a2: a })} />
            {issueText && <p className="field-error" role="alert">{issueText}</p>}
            <div className="banner info small">{overlap > 0 ? <>هذا المدى يتداخل مع <b className="num">{overlap}</b> آية محفوظة سابقاً: ستُحسب مرة واحدة فقط.</> : 'إذا تداخل المدى مع محفوظ سابق فسيُحسب المتداخل مرة واحدة.'}</div>
            <div className="field"><span className="lbl">التقدير{f.type === 'new' ? '' : ' (اختياري)'}</span>
              <div className="rank-btns" role="group" aria-label="التقدير">{[...s.scale].map((e) => <button key={e.rank} aria-pressed={f.rank === String(e.rank)} onClick={() => setF({ ...f, rank: String(e.rank) })}>{e.label}</button>)}{f.type !== 'new' && <button aria-pressed={f.rank === ''} onClick={() => setF({ ...f, rank: '' })}>بلا تقدير</button>}</div></div>
            <div className="field"><label htmlFor="md">التاريخ</label><input id="md" type="date" className="ltr" value={f.date} max={todayStr()} onChange={(e) => e.target.value && setF({ ...f, date: e.target.value })} /></div>
            <div className="field"><label htmlFor="mc">ملاحظة (اختيارية)</label><textarea id="mc" rows={2} maxLength={300} value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} /></div>
            <div className="row"><button className="btn primary" disabled={busy || !filled || !!issue || (f.type === 'new' && f.rank === '')} onClick={save}>حفظ التسجيل</button><button className="btn" onClick={suggest}>ابدأ من الآية التالية</button></div>
          </section>
        )}
        {voiding && (
          <section className="inline-panel" aria-label="إلغاء سجل"><h3>إلغاء سجل «{voiding.rangeText}»</h3>
            <p className="helper">لا يُمحى السجل: يبقى ظاهراً مشطوباً مع السبب، ويزول أثره على المحفوظ. لتصحيحه أدخلوا سجلاً جديداً صحيحاً.</p>
            <div className="field"><label htmlFor="vr">السبب</label><input id="vr" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></div>
            <div className="row"><button className="btn danger" disabled={busy || !reason.trim()} onClick={doVoid}>إلغاء السجل</button><button className="btn" onClick={() => setVoiding(null)}>رجوع</button></div>
          </section>
        )}
      </aside>
    </div>
  );
}

/** The page: pick a group, see every student's progress, open one to record. */
export function Memorization({ scope }: { user: UserView; scope: string }) {
  const access = useMemoAccess();
  const [groups, setGroups] = useState<GroupRow[] | null>(null); const [groupId, setGroupId] = useState(''); const [rows, setRows] = useState<GRow[] | null>(null); const [open, setOpen] = useState<GRow | null>(null);
  useEffect(() => { groupsApi.list({ branchId: scope || undefined, status: 'active' }).then((r) => { setGroups(r.rows); setGroupId((cur) => (r.rows.some((g) => g.id === cur) ? cur : r.rows[0]?.id ?? '')); }); }, [scope]);
  const load = useCallback(async () => { if (groupId) setRows((await call<{ rows: GRow[] | null }>('memo.group', { groupId })).rows); else setRows(null); }, [groupId]);
  useEffect(() => { load(); }, [load]);
  if (!groups || !access) return null;
  if (groups.length === 0) return <div className="empty"><div className="niche" aria-hidden="true" /><h2>لا توجد أفواج</h2><p>أنشئوا فوجاً وسجّلوا فيه الطلاب أولاً، ثم يظهر تقدّمهم هنا.</p></div>;
  if (open) return (
    <div className="profile"><button className="btn quiet back" onClick={() => { setOpen(null); load(); }}>→ كل طلاب الفوج</button>
      <header className="profile-head"><h2>{open.name}</h2><span className="piece num">{open.studentNo}</span></header><StudentMemo studentId={open.studentId} canRecord={access.canRecord} onChanged={load} /></div>
  );
  return (
    <div className="students">
      <div className="filters"><select aria-label="الفوج" value={groupId} onChange={(e) => setGroupId(e.target.value)}>{groups.map((g) => <option key={g.id} value={g.id}>{g.name} — {g.branchName}</option>)}</select></div>
      {rows === null ? <div className="banner error">لا تملكون صلاحية عرض حفظ هذا الفوج.</div> : rows.length === 0 ? <div className="empty"><div className="niche" aria-hidden="true" /><h2>لا طلاب في هذا الفوج</h2></div> : (
        <div className="grid-wrap"><table className="grid" aria-label="تقدم الحفظ"><thead><tr><th scope="col">الرقم</th><th scope="col">الاسم</th><th scope="col">الآيات المحفوظة</th><th scope="col">النسبة</th><th scope="col">سور كاملة</th><th scope="col">آخر نشاط</th><th scope="col">جديد / مراجعة / تثبيت</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.studentId} tabIndex={0} onClick={() => setOpen(r)} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(r); }}><td className="num">{r.studentNo}</td><td><b>{r.name}</b></td><td className="num">{r.memorizedAyat}</td><td className="num">{r.pct}%</td><td className="num">{r.wholeSurahs}</td><td className="num">{r.lastDate ?? '—'}</td><td className="num">{r.newCount} / {r.revisionCount} / {r.consolidationCount}</td></tr>)}</tbody></table>
          <div className="grid-foot"><span>اضغطوا على اسم الطالب لتسجيل حفظه أو مراجعته.</span></div></div>
      )}
    </div>
  );
}
