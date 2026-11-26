import { PrintHead } from './PrintKit';
import { useEffect, useMemo, useState } from 'react';
import type { UserView } from './api';
import { groupsApi, type GroupMember, type GroupRow } from './groupsApi';

interface EnrollmentRow { groupId: string; groupName: string; branchName: string; level: string | null; capacity: number; students: number; teachers: string }
interface EnrollmentReport { year: string | null; groups: EnrollmentRow[]; totals: { students: number; unassigned: number; groups: number } }
interface AttRow { studentId: string; studentNo: string; name: string; groupName: string; branchName: string; present: number; late: number; excused: number; absent: number; recorded: number; ratePct: number | null }
interface ActRow { groupId: string; groupName: string; branchName: string; teachers: string; held: number; cancelled: number; recorded: number }
type Res<T> = ({ ok: true } & T) | { ok: false; error: string };
const call = <T,>(channel: string, payload?: unknown) => window.mishkat.invoke(channel, payload) as Promise<T>;
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const FAIL: Record<string, string> = { forbidden: 'لا تملكون صلاحية هذا التقرير.', invalid: 'راجعوا الفترة: تاريخ البداية قبل النهاية.' };

function Period({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  return <><label>من <input type="date" className="ltr" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label><label>إلى <input type="date" className="ltr" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></label></>;
}


export function Reports({ user, scope }: { user: UserView; scope: string }) {
  const full = user.permissions.includes('report.view');
  const [tab, setTab] = useState<'enroll' | 'att' | 'act' | 'paper'>(full ? 'att' : 'enroll');
  const t = todayStr(); const [from, setFrom] = useState(t.slice(0, 8) + '01'); const [to, setTo] = useState(t);
  const [groups, setGroups] = useState<GroupRow[]>([]); const [groupId, setGroupId] = useState('');
  const [enroll, setEnroll] = useState<Res<{ report: EnrollmentReport }> | null>(null); const [att, setAtt] = useState<Res<{ rows: AttRow[]; heldSessions: number }> | null>(null); const [act, setAct] = useState<Res<{ rows: ActRow[] }> | null>(null);
  const [members, setMembers] = useState<{ group: GroupRow; members: GroupMember[] } | null>(null);
  const [note, setNote] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [printing, setPrinting] = useState(false); const [sortBy, setSortBy] = useState<'name' | 'rate'>('name');
  useEffect(() => { groupsApi.list({ branchId: scope || undefined, status: 'active' }).then((r) => { setGroups(r.rows); setGroupId((cur) => (r.rows.some((g) => g.id === cur) ? cur : r.rows[0]?.id ?? '')); }); }, [scope]);
  const b = scope || undefined;
  useEffect(() => { if (tab === 'enroll') call<typeof enroll>('reports.enrollment', { branchId: b }).then(setEnroll); }, [tab, b]);
  useEffect(() => { if (tab === 'att' && full) call<typeof att>('reports.attendance', { branchId: b, groupId: groupId && groupId !== 'all' ? groupId : undefined, from, to }).then(setAtt); }, [tab, b, groupId, from, to, full]);
  useEffect(() => { if (tab === 'act' && full) call<typeof act>('reports.activity', { branchId: b, from, to }).then(setAct); }, [tab, b, from, to, full]);
  useEffect(() => { if (tab === 'paper' && groupId) groupsApi.get(groupId).then((r) => setMembers(r.found)); else setMembers(null); }, [tab, groupId]);
  useEffect(() => { if (printing) { const h = setTimeout(() => { window.print(); setPrinting(false); }, 150); return () => clearTimeout(h); } }, [printing]);
  const attRows = useMemo(() => { const r = att && att.ok ? [...att.rows] : []; if (sortBy === 'rate') r.sort((x, y) => (x.ratePct ?? 101) - (y.ratePct ?? 101)); return r; }, [att, sortBy]);

  async function exportXlsx() {
    setBusy(true); setNote(null);
    const kind = tab === 'enroll' ? 'enrollment' : tab === 'att' ? 'attendance' : 'activity';
    const r = await call<{ ok: boolean; error?: string; count?: number }>('reports.export', { kind, branchId: b, groupId: kind === 'attendance' && groupId && groupId !== 'all' ? groupId : undefined, from: kind === 'enrollment' ? undefined : from, to: kind === 'enrollment' ? undefined : to });
    setBusy(false); if (r.ok) setNote('تم حفظ الملف.'); else if (r.error !== 'cancelled') setNote('تعذّر حفظ الملف. أعيدوا المحاولة.');
  }
  const assoc = user.associationName; const period = `من ${from} إلى ${to}`;
  const failed = (r: Res<object> | null) => (r && !r.ok ? FAIL[r.error] ?? 'تعذّر عرض التقرير.' : null);
  const canPrint = (tab === 'enroll' && enroll?.ok && enroll.report.groups.length > 0) || (tab === 'att' && att?.ok && att.rows.length > 0) || (tab === 'act' && act?.ok && act.rows.length > 0) || (tab === 'paper' && !!members);
  const showPeriod = tab === 'att' || tab === 'act';

  return (
    <div className="students">
      <div className="filters">
        <div className="seg" role="group" aria-label="التقرير">
          <button aria-pressed={tab === 'enroll'} onClick={() => setTab('enroll')}>التسجيل</button>
          {full && <button aria-pressed={tab === 'att'} onClick={() => setTab('att')}>الحضور</button>}
          {full && <button aria-pressed={tab === 'act'} onClick={() => setTab('act')}>نشاط الأفواج</button>}
          {full && <button aria-pressed={tab === 'paper'} onClick={() => setTab('paper')}>ورقة حضور للطباعة</button>}
        </div>
        {showPeriod && <Period from={from} to={to} setFrom={setFrom} setTo={setTo} />}
        {(tab === 'att' || tab === 'paper') && <select aria-label="الفوج" value={groupId} onChange={(e) => setGroupId(e.target.value)}>{tab === 'att' && <option value="all">كل الأفواج</option>}{groups.map((g) => <option key={g.id} value={g.id}>{g.name} — {g.branchName}</option>)}</select>}
        <span className="sp" />
        {tab !== 'paper' && <button className="btn" disabled={busy || !canPrint} onClick={exportXlsx}>تصدير Excel</button>}
        <button className="btn" disabled={!canPrint} onClick={() => setPrinting(true)}>طباعة</button>
      </div>
      {note && <div className="banner info" role="status">{note}</div>}

      {tab === 'enroll' && (failed(enroll) ? <div className="banner error">{failed(enroll)}</div> : enroll?.ok && (
        <>
          <div className="grid-wrap"><table className="grid" aria-label="تقرير التسجيل"><thead><tr><th scope="col">الفوج</th><th scope="col">الفرع</th><th scope="col">المستوى</th><th scope="col">المعلمون</th><th scope="col">الطلاب</th><th scope="col">السعة</th></tr></thead>
            <tbody>{enroll.report.groups.map((g) => <tr key={g.groupId}><td><b>{g.groupName}</b></td><td>{g.branchName}</td><td>{g.level ?? '—'}</td><td>{g.teachers || <span className="helper">بلا معلم</span>}</td><td className="num">{g.students}</td><td className="num">{g.capacity}</td></tr>)}</tbody></table>
            {enroll.report.groups.length === 0 && <div className="empty"><div className="niche" aria-hidden="true" /><h2>لا أفواج بعد</h2><p>أنشئوا الأفواج من صفحة «الأفواج» ليظهر هذا التقرير.</p></div>}
            <div className="grid-foot"><span>إجمالي الطلاب المسجَّلين: <span className="num">{enroll.report.totals.students}</span> · عدد الأفواج: <span className="num">{enroll.report.totals.groups}</span> ·<span className="num">{enroll.report.totals.unassigned}</span> طلاب نشطون بلا فوج</span></div></div>
        </>
      ))}

      {tab === 'att' && (failed(att) ? <div className="banner error">{failed(att)}</div> : att?.ok && (att.rows.length === 0 ? (
        <div className="empty"><div className="niche" aria-hidden="true" /><h2>لا حضور مسجَّل في هذه الفترة</h2><p>سجّلوا الحضور من صفحة «الحضور»، أو غيّروا الفترة.</p></div>
      ) : (
        <div className="grid-wrap"><table className="grid" aria-label="تقرير الحضور"><thead><tr><th scope="col">الرقم</th><th scope="col">الاسم</th><th scope="col">الفوج</th><th scope="col">حاضر</th><th scope="col">متأخر</th><th scope="col">غائب</th><th scope="col">بعذر</th><th scope="col"><button className="btn quiet" onClick={() => setSortBy(sortBy === 'rate' ? 'name' : 'rate')}>نسبة الحضور {sortBy === 'rate' ? '↑' : ''}</button></th></tr></thead>
          <tbody>{attRows.map((r) => <tr key={r.studentId + r.groupName}><td className="num">{r.studentNo}</td><td><b>{r.name}</b></td><td>{r.groupName}</td><td className="num">{r.present}</td><td className="num">{r.late}</td><td className="num">{r.absent}</td><td className="num">{r.excused}</td><td className="num">{r.ratePct === null ? '—' : r.ratePct + '%'}</td></tr>)}</tbody></table>
          <div className="grid-foot"><span><span className="num">{att.heldSessions}</span> حصة عُقدت في الفترة · نسبة الحضور = (حاضر + متأخر) ÷ الأيام المسجَّلة</span></div></div>
      )))}

      {tab === 'act' && (failed(act) ? <div className="banner error">{failed(act)}</div> : act?.ok && (act.rows.length === 0 ? (
        <div className="empty"><div className="niche" aria-hidden="true" /><h2>لا أفواج</h2></div>
      ) : (
        <div className="grid-wrap"><table className="grid" aria-label="نشاط الأفواج"><thead><tr><th scope="col">الفوج</th><th scope="col">الفرع</th><th scope="col">المعلمون</th><th scope="col">حصص عُقدت</th><th scope="col">أيام بلا حصة</th><th scope="col">تسجيلات حضور</th></tr></thead>
          <tbody>{act.rows.map((r) => <tr key={r.groupId}><td><b>{r.groupName}</b></td><td>{r.branchName}</td><td>{r.teachers || <span className="helper">بلا معلم</span>}</td><td className="num">{r.held}</td><td className="num">{r.cancelled}</td><td className="num">{r.recorded}</td></tr>)}</tbody></table>
          <div className="grid-foot"><span>الحضور يُسجَّل بحساب الدخول المشترك، لذا لا يُنسب إلى معلم بعينه. المعلمون المعروضون هم المربوطون بالفوج.</span></div></div>
      )))}

      {tab === 'paper' && (members ? (
        <p className="helper">ورقة فارغة لفوج «{members.group.name}» بأسماء طلابه الحاليين (<span className="num">{members.members.length}</span>). اكتبوا التواريخ بخط اليد، ثم أدخلوا الحضور في البرنامج لاحقاً.</p>
      ) : <div className="empty"><div className="niche" aria-hidden="true" /><h2>اختاروا فوجاً</h2></div>)}

      {printing && (
        <div className="print-sheet" dir="rtl">
          {tab === 'enroll' && enroll?.ok && <><PrintHead assoc={assoc} title="تقرير التسجيل" sub={`العام ${enroll.report.year ?? ''}`} />
            <table><thead><tr><th>الفوج</th><th>الفرع</th><th>المعلمون</th><th>الطلاب</th><th>السعة</th></tr></thead><tbody>{enroll.report.groups.map((g) => <tr key={g.groupId}><td>{g.groupName}</td><td>{g.branchName}</td><td>{g.teachers}</td><td className="num">{g.students}</td><td className="num">{g.capacity}</td></tr>)}</tbody></table>
            <p>طلاب نشطون بلا فوج: <span className="num">{enroll.report.totals.unassigned}</span></p></>}
          {tab === 'att' && att?.ok && <><PrintHead assoc={assoc} title="تقرير الحضور" sub={period} />
            <table><thead><tr><th>الرقم</th><th>الاسم</th><th>الفوج</th><th>حاضر</th><th>متأخر</th><th>غائب</th><th>بعذر</th><th>النسبة</th></tr></thead><tbody>{attRows.map((r) => <tr key={r.studentId + r.groupName}><td className="num">{r.studentNo}</td><td>{r.name}</td><td>{r.groupName}</td><td className="num">{r.present}</td><td className="num">{r.late}</td><td className="num">{r.absent}</td><td className="num">{r.excused}</td><td className="num">{r.ratePct === null ? '—' : r.ratePct + '%'}</td></tr>)}</tbody></table></>}
          {tab === 'act' && act?.ok && <><PrintHead assoc={assoc} title="نشاط الأفواج" sub={period} />
            <table><thead><tr><th>الفوج</th><th>المعلمون</th><th>حصص عُقدت</th><th>بلا حصة</th><th>تسجيلات</th></tr></thead><tbody>{act.rows.map((r) => <tr key={r.groupId}><td>{r.groupName}</td><td>{r.teachers}</td><td className="num">{r.held}</td><td className="num">{r.cancelled}</td><td className="num">{r.recorded}</td></tr>)}</tbody></table></>}
          {tab === 'paper' && members && <><PrintHead assoc={assoc} title="ورقة الحضور" sub={`الفوج: ${members.group.name} — ${members.group.branchName} — المعلمون: ${members.group.teachers.map((x) => x.name).join('، ') || '..............'} — الشهر: ..........`} />
            <table className="paper"><thead><tr><th>#</th><th>الاسم</th>{Array.from({ length: 14 }, (_, i) => <th key={i} />)}</tr></thead><tbody>{members.members.map((m, i) => <tr key={m.enrollmentId}><td className="num">{i + 1}</td><td>{m.name}</td>{Array.from({ length: 14 }, (_, k) => <td key={k} />)}</tr>)}</tbody></table>
            <p>الرموز: ✓ حاضر · ت متأخر · غ غائب · ع غائب بعذر</p></>}
        </div>
      )}
    </div>
  );
}
