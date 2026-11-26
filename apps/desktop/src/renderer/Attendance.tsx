import { useCallback, useEffect, useMemo, useState } from 'react';
import { studentsWord, type UserView } from './api';
import { groupsApi, type GroupRow } from './groupsApi';
import { WhatsAppPanel } from './Guardians';
import { attApi, ATT_ERROR_TEXT, ATT_LABEL, ATT_ORDER, type AttStatus, type HistoryRow, type Sheet, type SheetRow } from './attApi';
import { PrintHead } from './PrintKit';

const errText = (e: string) => ATT_ERROR_TEXT[e] ?? 'تعذّر تنفيذ الإجراء. أعيدوا المحاولة. بياناتكم الحالية سليمة.';
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** One student's entry while the sheet is being filled. Everyone starts present (the administrator only taps the absentees).
 *  "Left early" is not a status: the student counts as present and the time goes into the note (decided with the owner 2026-11-22). */
interface Draft { status: AttStatus; late: string; note: string; leftAt: string; open: boolean }
const NEW_DRAFT: Draft = { status: 'present', late: '', note: '', leftAt: '', open: false };
const LEFT_EARLY = 'خرج مبكراً على الساعة';
export const noteOf = (d: Pick<Draft, 'note' | 'leftAt'>): string | null => {
  const parts = [d.leftAt ? `${LEFT_EARLY} ${d.leftAt}` : '', d.note.trim()].filter(Boolean);
  return parts.length ? parts.join(' — ').slice(0, 300) : null;
};

function StatusPicker({ value, onChange, label }: { value: AttStatus | null; onChange: (s: AttStatus) => void; label: string }) {
  return (
    <div className="seg att-seg" role="group" aria-label={label}>
      {ATT_ORDER.map((s) => <button key={s} className={`att-${s}`} aria-pressed={value === s} onClick={() => onChange(s)}>{ATT_LABEL[s]}</button>)}
    </div>
  );
}

function SheetView({ groupId, date, canRecord, canCorrect, association }: { groupId: string; date: string; canRecord: boolean; canCorrect: boolean; association: string }) {
  const [wa, setWa] = useState<SheetRow | null>(null);
  const [sheet, setSheet] = useState<Sheet | null | undefined>(undefined); const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [times, setTimes] = useState({ startTime: '16:00', endTime: '17:00' }); const [banner, setBanner] = useState<string | null>(null); const [note, setNote] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [fixing, setFixing] = useState<SheetRow | null>(null); const [fix, setFix] = useState<{ status: AttStatus; late: string; reason: string }>({ status: 'present', late: '', reason: '' });
  const [cancelling, setCancelling] = useState(false); const [cancelReason, setCancelReason] = useState('');
  const load = useCallback(async () => { const s = (await attApi.sheet(groupId, date)).sheet; setSheet(s); setDraft({}); if (s?.session) setTimes({ startTime: s.session.startTime, endTime: s.session.endTime }); }, [groupId, date]);
  useEffect(() => { setSheet(undefined); setBanner(null); setNote(null); setFixing(null); setCancelling(false); load(); }, [load]);
  const [printing, setPrinting] = useState(false);
  useEffect(() => { if (printing) { const h = setTimeout(() => { window.print(); setPrinting(false); }, 150); return () => clearTimeout(h); } }, [printing]);
  const open = useMemo(() => (sheet?.rows ?? []).filter((r) => !r.recordId), [sheet]);
  if (sheet === undefined) return null;
  if (sheet === null) return <div className="empty"><div className="niche" aria-hidden="true" /><h2>لا يمكن عرض هذه الورقة</h2><p>الفوج أو التاريخ غير متاح.</p></div>;
  const cancelled = sheet.session?.status === 'cancelled'; const closed = sheet.group.status === 'closed';
  const editable = canRecord && !cancelled && !closed;
  const dr = (id: string): Draft => draft[id] ?? NEW_DRAFT;
  const setD = (id: string, p: Partial<Draft>) => setDraft((d) => ({ ...d, [id]: { ...(d[id] ?? NEW_DRAFT), ...p } }));
  const toggle = (id: string) => setD(id, { status: dr(id).status === 'present' ? 'absent' : 'present', late: '' });
  const recordedCount = sheet.rows.length - open.length;
  const count = (s: AttStatus) => open.filter((r) => dr(r.studentId).status === s).length;
  const resetAll = () => setDraft({});

  async function save() {
    setBusy(true); setBanner(null); setNote(null);
    const entries = open.map((r) => { const d = dr(r.studentId); const late = d.status === 'late' && d.late ? Number(d.late) : null; return { studentId: r.studentId, status: d.status, lateMinutes: late, note: noteOf(d) }; });
    const r = await attApi.save(groupId, date, times.startTime, times.endTime, entries); setBusy(false);
    if (r.ok) { setNote(`تم حفظ حضور ${r.saved} ${studentsWord(r.saved)}.`); await load(); } else setBanner(errText(r.error));
  }
  async function saveFix() {
    if (!fixing) return; setBusy(true); setBanner(null);
    const r = await attApi.correct(fixing.recordId!, fix.status, fix.status === 'late' && fix.late ? Number(fix.late) : null, fix.reason); setBusy(false);
    if (r.ok) { setFixing(null); setNote('تم التصحيح، وسُجّل في سجل التصحيحات.'); await load(); } else setBanner(errText(r.error));
  }
  async function cancelDay() {
    setBusy(true); setBanner(null); const r = await attApi.cancel(groupId, date, cancelReason, times.startTime, times.endTime); setBusy(false);
    if (r.ok) { setCancelling(false); setCancelReason(''); await load(); } else setBanner(errText(r.error));
  }
  return (
    <div className="att-sheet">
      {banner && <div className="banner error" role="alert">{banner}</div>}
      {note && <div className="banner info" role="status">{note}</div>}
      {cancelled && <div className="banner info">يوم بلا حصة. السبب: {sheet.session?.cancelReason}</div>}
      {closed && <div className="banner info">الفوج مغلق، فلا يُسجَّل فيه حضور جديد.</div>}
      {sheet.rows.length === 0 ? (
        <div className="empty"><div className="niche" aria-hidden="true" /><h2>لا طلاب في هذا اليوم</h2><p>لم يكن في الفوج طلاب مسجَّلون بتاريخ {date}. سجّلوا الطلاب من صفحة «الأفواج».</p></div>
      ) : (
        <div className="grid-wrap">
          <table className="grid att-grid" aria-label="ورقة الحضور">
            <thead><tr><th scope="col">الرقم</th><th scope="col">الاسم</th><th scope="col">الحالة</th><th scope="col">ملاحظة</th>{canCorrect && <th scope="col" />}</tr></thead>
            <tbody>{sheet.rows.map((r) => {
              const d = dr(r.studentId);
              return r.recordId ? (
                <tr key={r.studentId}><td className="num">{r.studentNo}</td><td><b>{r.name}</b></td>
                  <td><span className={`badge att-b-${r.status}`}><i aria-hidden="true" />{ATT_LABEL[r.status!]}{r.status === 'late' && r.lateMinutes ? <> <span className="num">{r.lateMinutes}</span> د</> : null}</span>{r.enteredLate && <small className="helper"> أُدخل بعد اليوم</small>}</td>
                  <td>{r.note ?? ''}</td>
                  {canCorrect && <td>{r.status === 'absent' && <button className="btn quiet" onClick={() => setWa(r)}>واتساب للولي</button>}<button className="btn quiet" onClick={() => { setFixing(r); setFix({ status: r.status!, late: r.lateMinutes ? String(r.lateMinutes) : '', reason: '' }); }}>تصحيح</button></td>}</tr>
              ) : !editable ? (
                <tr key={r.studentId}><td className="num">{r.studentNo}</td><td><b>{r.name}</b></td><td><span className="helper">لم يُسجَّل</span></td><td />{canCorrect && <td />}</tr>
              ) : (
                <tr key={r.studentId} className={`att-row att-row-${d.status}`}><td className="num">{r.studentNo}</td>
                  <td><button type="button" className="att-name" onClick={() => toggle(r.studentId)} aria-label={`${r.name}: ${ATT_LABEL[d.status]}. اضغطوا للتبديل بين حاضر وغائب`}><b>{r.name}</b></button></td>
                  <td><div className="att-cell">
                    <button type="button" className={`att-toggle att-${d.status}`} aria-pressed={d.status !== 'present'} onClick={() => toggle(r.studentId)}>{d.status === 'present' ? '✓ حاضر' : d.status === 'absent' ? '✗ غائب' : ATT_LABEL[d.status]}</button>
                    {d.status === 'late' && <input className="ltr att-min" inputMode="numeric" aria-label="دقائق التأخر" placeholder="دقائق" value={d.late} onChange={(e) => setD(r.studentId, { late: e.target.value.replace(/\D/g, '').slice(0, 3) })} />}
                    <button type="button" className="btn quiet att-more" aria-expanded={d.open} onClick={() => setD(r.studentId, { open: !d.open })}>{d.open ? 'إخفاء' : 'خيارات'}</button>
                  </div>
                    {d.open && <div className="att-extra">
                      <span className="att-other" role="group" aria-label={`حالة أخرى لـ ${r.name}`}>{(['late', 'excused'] as AttStatus[]).map((s) => <button key={s} type="button" className={`btn quiet att-${s}`} aria-pressed={d.status === s} onClick={() => setD(r.studentId, { status: d.status === s ? 'present' : s })}>{ATT_LABEL[s]}</button>)}</span>
                      <label className="att-left">{LEFT_EARLY} <input type="time" className="ltr" value={d.leftAt} onChange={(e) => setD(r.studentId, { leftAt: e.target.value })} aria-label={`وقت خروج ${r.name}`} />{d.leftAt && <button type="button" className="btn quiet" onClick={() => setD(r.studentId, { leftAt: '' })}>مسح</button>}</label>
                    </div>}</td>
                  <td>{d.open || d.note ? <input aria-label={`ملاحظة ${r.name}`} maxLength={250} placeholder="ملاحظة (اختياري)" value={d.note} onChange={(e) => setD(r.studentId, { note: e.target.value })} /> : null}
                    {noteOf(d) && !d.open && <small className="helper att-note-preview">{noteOf(d)}</small>}</td>
                  {canCorrect && <td />}</tr>
              );
            })}</tbody>
          </table>
          <div className="grid-foot"><span><span className="num">{recordedCount}</span> مسجَّل من <span className="num">{sheet.rows.length}</span></span></div>
        </div>
      )}
      {printing && (
        <div className="print-sheet" dir="rtl">
          <PrintHead assoc={association} title="ورقة النداء" sub={`الفوج: ${sheet.group.name} — ${sheet.group.branchName} — اليوم: ${date}`} />
          <table className="rollcall"><thead><tr><th>#</th><th>الاسم</th><th>✓ حاضر</th><th>✗ غائب</th><th>ملاحظة (تأخر، خروج مبكر…)</th></tr></thead>
            <tbody>{sheet.rows.map((r, i) => <tr key={r.studentId}><td className="num">{i + 1}</td><td>{r.name}</td><td /><td /><td /></tr>)}</tbody></table>
          <p className="rollcall-sign">الأستاذ(ة): ..................................  التوقيع: ..................  وقت الحصة: من ........ إلى ........</p>
          <p className="helper">ينادي الأستاذ كل اسم ويضع ✓ للحاضر و ✗ للغائب، ويكتب في «ملاحظة» التأخر أو وقت الخروج المبكر. ثم تُسلَّم الورقة (أو صورتها) للإدارة لإدخالها في البرنامج.</p>
        </div>
      )}
      {wa && <WhatsAppPanel studentId={wa.studentId} studentName={wa.name} association={association} kind="absence" date={date} group={sheet.group.name} onClose={() => setWa(null)} />}
      {fixing && (
        <section className="inline-panel" aria-label="تصحيح حضور"><h3>تصحيح حضور {fixing.name}</h3>
          <p className="helper">التصحيح لا يمحو القديم: يُحفظ في سجل التصحيحات بالحالة القديمة والجديدة والسبب.</p>
          <StatusPicker label="الحالة الصحيحة" value={fix.status} onChange={(s) => setFix({ ...fix, status: s })} />
          {fix.status === 'late' && <div className="field"><label htmlFor="fm">دقائق التأخر (اختياري)</label><input id="fm" className="ltr" inputMode="numeric" value={fix.late} onChange={(e) => setFix({ ...fix, late: e.target.value.replace(/\D/g, '').slice(0, 3) })} /></div>}
          <div className="field"><label htmlFor="fr">سبب التصحيح</label><input id="fr" maxLength={300} value={fix.reason} onChange={(e) => setFix({ ...fix, reason: e.target.value })} autoFocus /></div>
          <div className="row"><button className="btn primary" disabled={busy || !fix.reason.trim()} onClick={saveFix}>حفظ التصحيح</button><button className="btn" onClick={() => setFixing(null)}>إلغاء</button></div>
        </section>
      )}
      {sheet.rows.length > 0 && <p className="att-print"><button className="btn" onClick={() => setPrinting(true)}>طباعة ورقة النداء للأستاذ</button> <span className="helper">ورقة بأسماء الفوج لهذا اليوم: ✓ للحاضر و ✗ للغائب، وخانة للملاحظات.</span></p>}
      {editable && open.length > 0 && (
        <div className="att-foot">
          {!sheet.session && <div className="att-times"><label htmlFor="t1">من</label><input id="t1" type="time" className="ltr" value={times.startTime} onChange={(e) => setTimes({ ...times, startTime: e.target.value })} /><label htmlFor="t2">إلى</label><input id="t2" type="time" className="ltr" value={times.endTime} onChange={(e) => setTimes({ ...times, endTime: e.target.value })} /></div>}
          <span className="att-count"><span className="badge att-b-present"><i aria-hidden="true" />حاضر <span className="num">{count('present')}</span></span> <span className="badge att-b-absent"><i aria-hidden="true" />غائب <span className="num">{count('absent')}</span></span>{count('late') > 0 && <> <span className="badge att-b-late"><i aria-hidden="true" />متأخر <span className="num">{count('late')}</span></span></>}{count('excused') > 0 && <> <span className="badge att-b-excused"><i aria-hidden="true" />بعذر <span className="num">{count('excused')}</span></span></>}</span>
          <span className="sp" />
          <button className="btn quiet" onClick={resetAll} disabled={busy || Object.keys(draft).length === 0}>إرجاع الكل حاضرين</button>
          <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'جارٍ الحفظ…' : 'حفظ الحضور'}</button>
        </div>
      )}
      {editable && open.length > 0 && <p className="helper">الكل «حاضر» في البداية: اضغطوا على اسم الغائب (أو على ✓) ليصير ✗ غائب. «خيارات» للمتأخر، والغائب بعذر، والخروج المبكر، والملاحظة.</p>}
      {canRecord && !cancelled && !closed && recordedCount === 0 && !cancelling && <p><button className="btn quiet" onClick={() => setCancelling(true)}>لا حصة في هذا اليوم</button></p>}
      {cancelling && (
        <section className="inline-panel" aria-label="يوم بلا حصة"><h3>تعليم اليوم «بلا حصة»</h3>
          <div className="field"><label htmlFor="cr">السبب (عطلة، ظرف طارئ…)</label><input id="cr" maxLength={300} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} autoFocus /></div>
          <div className="row"><button className="btn primary" disabled={busy || !cancelReason.trim()} onClick={cancelDay}>تأكيد</button><button className="btn" onClick={() => setCancelling(false)}>إلغاء</button></div>
        </section>
      )}
    </div>
  );
}

function HistoryView({ groupId }: { groupId: string }) {
  const t = todayStr(); const [from, setFrom] = useState(t.slice(0, 8) + '01'); const [to, setTo] = useState(t);
  const [h, setH] = useState<{ sessions: { date: string; status: string; recorded: number }[]; students: HistoryRow[] } | null | undefined>(undefined);
  useEffect(() => { let live = true; attApi.history(groupId, from, to).then((r) => { if (live) setH(r.history); }); return () => { live = false; }; }, [groupId, from, to]);
  return (
    <div>
      <div className="filters"><label>من <input type="date" className="ltr" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label><label>إلى <input type="date" className="ltr" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></label></div>
      {h === undefined ? null : h === null ? <div className="banner error">تعذّر عرض السجل لهذه الفترة.</div> : h.sessions.length === 0 ? (
        <div className="empty"><div className="niche" aria-hidden="true" /><h2>لا حصص مسجَّلة في هذه الفترة</h2></div>
      ) : (
        <>
          <div className="grid-wrap"><table className="grid" aria-label="حضور الطلاب"><thead><tr><th scope="col">الرقم</th><th scope="col">الاسم</th><th scope="col">حاضر</th><th scope="col">متأخر</th><th scope="col">غائب</th><th scope="col">بعذر</th></tr></thead>
            <tbody>{h.students.map((s) => <tr key={s.studentId}><td className="num">{s.studentNo}</td><td><b>{s.name}</b></td><td className="num">{s.present}</td><td className="num">{s.late}</td><td className="num">{s.absent}</td><td className="num">{s.excused}</td></tr>)}</tbody></table></div>
          <div className="grid-wrap"><table className="grid" aria-label="أيام الحصص"><thead><tr><th scope="col">اليوم</th><th scope="col">الحالة</th><th scope="col">المسجَّلون</th></tr></thead>
            <tbody>{h.sessions.map((s) => <tr key={s.date}><td className="num">{s.date}</td><td>{s.status === 'held' ? 'عُقدت' : s.status === 'cancelled' ? 'بلا حصة' : 'مجدولة'}</td><td className="num">{s.recorded}</td></tr>)}</tbody></table></div>
        </>
      )}
    </div>
  );
}

export function Attendance({ user, scope }: { user: UserView; scope: string }) {
  const canRecord = user.permissions.includes('attendance.record'); const canCorrect = user.permissions.includes('attendance.correct');
  const [groups, setGroups] = useState<GroupRow[] | null>(null); const [groupId, setGroupId] = useState(''); const [date, setDate] = useState(todayStr()); const [tab, setTab] = useState<'sheet' | 'history'>('sheet');
  useEffect(() => { groupsApi.list({ branchId: scope || undefined, status: 'active' }).then((r) => { setGroups(r.rows); setGroupId((cur) => (r.rows.some((g) => g.id === cur) ? cur : r.rows[0]?.id ?? '')); }); }, [scope]);
  if (!groups) return null;
  if (groups.length === 0) return <div className="empty"><div className="niche" aria-hidden="true" /><h2>لا توجد أفواج</h2><p>أنشئوا فوجاً وسجّلوا فيه الطلاب من صفحة «الأفواج»، ثم يظهر هنا لتسجيل الحضور.</p></div>;
  return (
    <div className="students">
      <div className="filters">
        <select aria-label="الفوج" value={groupId} onChange={(e) => setGroupId(e.target.value)}>{groups.map((g) => <option key={g.id} value={g.id}>{g.name} — {g.branchName}</option>)}</select>
        <input type="date" className="ltr" aria-label="التاريخ" value={date} max={todayStr()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <div className="seg" role="group" aria-label="العرض"><button aria-pressed={tab === 'sheet'} onClick={() => setTab('sheet')}>ورقة اليوم</button><button aria-pressed={tab === 'history'} onClick={() => setTab('history')}>السجل</button></div>
      </div>
      {groupId && (tab === 'sheet' ? <SheetView groupId={groupId} date={date} canRecord={canRecord} canCorrect={canCorrect} association={user.associationName} /> : <HistoryView groupId={groupId} />)}
    </div>
  );
}
