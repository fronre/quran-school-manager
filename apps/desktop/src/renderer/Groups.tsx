import { useCallback, useEffect, useState } from 'react';
import { api, studentsWord, type UserView } from './api';
import { groupsApi, GROUP_ERROR_TEXT, type GroupMember, type GroupRow } from './groupsApi';
import { ProfileFrame } from './Profile';
import { attApi } from './attApi';

const errText = (e: string) => GROUP_ERROR_TEXT[e] ?? 'تعذّر تنفيذ الإجراء. أعيدوا المحاولة. بياناتكم الحالية سليمة.';
function Field({ id, label, helper, children }: { id: string; label: string; helper?: string; children: React.ReactNode }) {
  return <div className="field"><label htmlFor={id}>{label}</label>{children}{helper && <p className="helper">{helper}</p>}</div>;
}
const fill = (g: GroupRow) => <span className={g.members > g.capacity ? 'chip-warn' : ''}><span className="num">{g.members}</span> / <span className="num">{g.capacity}</span></span>;

/** One group: its students, its teachers and its data. */
function GroupPage({ id, canEdit, canEnroll, onBack, onChanged, welcome }: { id: string; canEdit: boolean; canEnroll: boolean; onBack: () => void; onChanged: () => void; welcome?: string }) {
  const [data, setData] = useState<{ group: GroupRow; members: GroupMember[] } | null | undefined>(undefined);
  const [tab, setTab] = useState('students'); const [banner, setBanner] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [name, setName] = useState(''); const [level, setLevel] = useState(''); const [cap, setCap] = useState('');
  const [free, setFree] = useState<{ id: string; studentNo: string; name: string }[]>([]); const [q, setQ] = useState('');
  const [teachers, setTeachers] = useState<{ id: string; name: string }[]>([]); const [leaving, setLeaving] = useState<GroupMember | null>(null); const [reason, setReason] = useState('');
  const load = useCallback(async () => { const r = (await groupsApi.get(id)).found; setData(r); if (r) { setName(r.group.name); setLevel(r.group.level ?? ''); setCap(String(r.group.capacity)); } }, [id]);
  useEffect(() => { load(); }, [load]);
  const branchId = data?.group.branchId;
  useEffect(() => { if (branchId && canEnroll && tab === 'students') { const t = setTimeout(() => groupsApi.unassigned(branchId, q).then((r) => setFree(r.rows)), 150); return () => clearTimeout(t); } }, [branchId, canEnroll, tab, q, data?.members.length]);
  useEffect(() => { if (canEdit && tab === 'teachers') groupsApi.assignable(id).then((r) => setTeachers(r.rows)); }, [canEdit, tab, id, data?.group.teachers.length]);
  if (data === undefined) return null;
  if (data === null) return <div className="empty"><div className="niche" aria-hidden="true" /><h2>لم يعد الفوج متاحاً</h2><button className="btn" onClick={onBack}>العودة إلى الأفواج</button></div>;
  const g = data.group; const closed = g.status === 'closed';
  async function run(p: Promise<{ ok: boolean; error?: string }>) { setBusy(true); setBanner(null); const r = await p; setBusy(false); if (r.ok) { await load(); onChanged(); return true; } setBanner(errText(r.error ?? '')); return false; }
  const capNum = Number(cap); const dirty = name.trim() !== g.name || (level.trim() || null) !== g.level || capNum !== g.capacity;
  return (
    <ProfileFrame onBack={onBack} backLabel="كل الأفواج" headline={g.name} badges={<span className={`badge ${closed ? 'neutral' : 'teal'}`}><i aria-hidden="true" />{closed ? 'مغلق' : 'نشط'}</span>}
      tabs={[['students', 'الطلاب'], ['teachers', 'المعلمون'], ['data', 'البيانات']]} tab={tab} onTab={setTab}
      aside={<dl className="facts"><dt>الفرع</dt><dd>{g.branchName}</dd><dt>العام</dt><dd className="num">{g.yearName}</dd><dt>المستوى</dt><dd>{g.level ?? '—'}</dd><dt>الطلاب</dt><dd>{fill(g)}</dd></dl>}>
      {welcome && <div className="banner info" role="status">{welcome}</div>}
      {banner && <div className="banner error" role="alert">{banner}</div>}
      {g.members > g.capacity && <div className="banner info">عدد الطلاب أكبر من السعة المحددة. يمكنكم المتابعة، أو رفع السعة من «البيانات».</div>}
      {tab === 'students' && (
        <div>
          <div className="grid-wrap"><table className="grid" aria-label="طلاب الفوج"><thead><tr><th scope="col">الرقم</th><th scope="col">الاسم</th><th scope="col">منذ</th>{canEnroll && <th scope="col" />}</tr></thead>
            <tbody>{data.members.map((m) => <tr key={m.enrollmentId}><td className="num">{m.studentNo}</td><td><b>{m.name}</b></td><td className="num">{m.since}</td>
              {canEnroll && <td><button className="btn quiet" onClick={() => { setLeaving(m); setReason(''); }}>إخراج</button></td>}</tr>)}</tbody></table>
            {data.members.length === 0 && <div className="empty"><div className="niche" aria-hidden="true" /><h2>لا طلاب في هذا الفوج</h2><p>{canEnroll && !closed ? 'سجّلوا الطلاب من القائمة أدناه.' : 'لم يُسجَّل أحد بعد.'}</p></div>}
            <div className="grid-foot"><span><span className="num">{data.members.length}</span> {studentsWord(data.members.length)}</span></div></div>
          {leaving && (
            <div className="inline-panel" role="group" aria-label="إخراج طالب"><h3>إخراج {leaving.name} من الفوج</h3>
              <Field id="lr" label="السبب" helper="يبقى السجل محفوظاً، ويُسجَّل تاريخ الإخراج والسبب."><input id="lr" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
              <div className="row"><button className="btn primary" disabled={busy || !reason.trim()} onClick={async () => { if (await run(groupsApi.leave(id, leaving.studentId, reason))) setLeaving(null); }}>إخراج الطالب</button><button className="btn" onClick={() => setLeaving(null)}>إلغاء</button></div></div>
          )}
          {canEnroll && !closed && (
            <section className="inline-panel" aria-label="تسجيل طلاب"><h3>طلاب بلا فوج في {g.branchName}</h3>
              <input className="search" type="search" placeholder="ابحثوا بالاسم" aria-label="بحث في الطلاب بلا فوج" value={q} onChange={(e) => setQ(e.target.value)} />
              {free.length === 0 ? <p className="helper">{q ? 'لا نتائج مطابقة.' : 'كل الطلاب النشطين في هذا الفرع مسجَّلون في أفواج.'}</p> : (
                <table className="grid" aria-label="طلاب بلا فوج"><tbody>{free.map((s) => <tr key={s.id}><td className="num">{s.studentNo}</td><td><b>{s.name}</b></td><td><button className="btn" disabled={busy} onClick={() => run(groupsApi.enroll(id, s.id))}>تسجيل في الفوج</button></td></tr>)}</tbody></table>)}
            </section>
          )}
        </div>
      )}
      {tab === 'teachers' && (
        <div>
          {g.teachers.length === 0 ? <div className="empty"><div className="niche" aria-hidden="true" /><h2>لا معلم لهذا الفوج</h2><p>{canEdit ? 'أضيفوا معلماً من الفرع نفسه.' : 'لم يُحدَّد معلم بعد.'}</p></div> : (
            <table className="grid" aria-label="معلمو الفوج"><tbody>{g.teachers.map((t) => <tr key={t.id}><td><b>{t.name}</b></td>{canEdit && <td><button className="btn quiet" disabled={busy} onClick={() => run(groupsApi.removeTeacher(id, t.id))}>إزالة</button></td>}</tr>)}</tbody></table>)}
          {canEdit && !closed && (
            <section className="inline-panel" aria-label="إضافة معلم"><h3>إضافة معلم</h3>
              {teachers.length === 0 ? <p className="helper">لا يوجد معلمون آخرون في هذا الفرع. أضيفوا المعلمين من صفحة «المعلمون».</p> :
                <table className="grid" aria-label="معلمون متاحون"><tbody>{teachers.map((t) => <tr key={t.id}><td><b>{t.name}</b></td><td><button className="btn" disabled={busy} onClick={() => run(groupsApi.assignTeacher(id, t.id))}>إضافة إلى الفوج</button></td></tr>)}</tbody></table>}
            </section>
          )}
        </div>
      )}
      {tab === 'data' && (
        <div className="profile-form">
          <div className="grid2">
            <Field id="gn" label="اسم الفوج"><input id="gn" value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} /></Field>
            <Field id="gl" label="المستوى (اختياري)"><input id="gl" value={level} disabled={!canEdit} onChange={(e) => setLevel(e.target.value)} /></Field>
          </div>
          <Field id="gc" label="السعة" helper="للتنبيه فقط: يمكن تسجيل أكثر منها."><input id="gc" className="ltr" inputMode="numeric" value={cap} disabled={!canEdit} onChange={(e) => setCap(e.target.value.replace(/\D/g, ''))} /></Field>
          {canEdit && <div className="row">
            <button className="btn primary" disabled={busy || !dirty || !name.trim() || !(capNum >= 1)} onClick={() => run(groupsApi.update(id, g.version, { name, level: level.trim() || null, capacity: capNum }))}>حفظ التعديلات</button>
            <button className="btn" disabled={busy} onClick={() => run(groupsApi.setStatus(id, closed ? 'active' : 'closed'))}>{closed ? 'إعادة فتح الفوج' : 'إغلاق الفوج'}</button></div>}
        </div>
      )}
    </ProfileFrame>
  );
}

export function Groups({ user, scope, draft, onDraftUsed }: { user: UserView; scope: string; draft?: { id: string; name: string; branchId: string } | null; onDraftUsed?: () => void }) {
  const [status, setStatus] = useState<'active' | 'closed'>('active'); const [rows, setRows] = useState<GroupRow[] | null>(null);
  const [opts, setOpts] = useState<{ branches: { id: string; name: string }[]; canEnroll: boolean; canEdit: boolean } | null>(null);
  const [open, setOpen] = useState<string | null>(null); const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ branchId: '', name: '', level: '', capacity: '', teacherId: '' }); const [branchTeachers, setBranchTeachers] = useState<{ id: string; name: string }[]>([]); const [welcome, setWelcome] = useState<string | undefined>(); const [banner, setBanner] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  void user;
  const load = useCallback(async () => { setRows((await groupsApi.list({ branchId: scope || undefined, status })).rows); }, [scope, status]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { groupsApi.form().then(setOpts); }, []);
  useEffect(() => { if (!adding || !f.branchId) return; let live = true; api.staffList({ branchId: f.branchId, position: 'teacher', archived: 'active', limit: 200 }).then((r) => { if (live) setBranchTeachers(r.rows.map((t) => ({ id: t.id, name: `${t.givenName} ${t.familyName}` }))); }); return () => { live = false; }; }, [adding, f.branchId]);
  useEffect(() => { if (draft && opts?.canEdit) { setF({ branchId: draft.branchId, name: '', level: '', capacity: '', teacherId: draft.id }); setBanner(null); setAdding(true); onDraftUsed?.(); } }, [draft, opts?.canEdit]); // coming from a teacher's page: the form opens with that teacher chosen
  if (open && opts) return <GroupPage id={open} canEdit={opts.canEdit} canEnroll={opts.canEnroll} onBack={() => { setOpen(null); setWelcome(undefined); }} onChanged={load} welcome={welcome} />;
  const start = () => { setF({ branchId: scope || opts?.branches[0]?.id || '', name: '', level: '', capacity: '', teacherId: '' }); setBanner(null); setAdding(true); };
  async function create() {
    const cap = Number(f.capacity); if (!f.name.trim() || !(cap >= 1)) { setBanner(errText('invalid')); return; }
    setBusy(true); const r = await groupsApi.create({ branchId: f.branchId, name: f.name, level: f.level.trim() || null, capacity: cap }); setBusy(false);
    if (r.ok) {
      let note = 'تم إنشاء الفوج. سجّلوا طلابه الآن من القائمة أدناه (الطلاب الذين بلا فوج في هذا الفرع).';
      if (f.teacherId) { const a = await groupsApi.assignTeacher(r.id, f.teacherId); const t = branchTeachers.find((x) => x.id === f.teacherId)?.name ?? ''; note = a.ok ? `تم إنشاء الفوج وربطه بالمعلم ${t}. سجّلوا طلابه الآن من القائمة أدناه (الطلاب الذين بلا فوج في هذا الفرع).` : 'تم إنشاء الفوج لكن تعذّر ربط المعلم. أضيفوه من تبويب «المعلمون». ثم سجّلوا الطلاب من القائمة أدناه.'; }
      setWelcome(note); setAdding(false); await load(); setOpen(r.id);
    } else setBanner(errText(r.error));
  }
  const empty = rows && rows.length === 0 && status === 'active';
  return (
    <div className="students">
      <div className="filters">
        <div className="seg" role="group" aria-label="العرض"><button aria-pressed={status === 'active'} onClick={() => setStatus('active')}>النشطة</button><button aria-pressed={status === 'closed'} onClick={() => setStatus('closed')}>المغلقة</button></div>
        <span className="sp" />
        {opts?.canEdit && <button className="btn primary" disabled={opts.branches.length === 0} onClick={start}>إضافة فوج</button>}
      </div>
      {adding && opts && (
        <section className="inline-panel" aria-label="فوج جديد"><h3>فوج جديد</h3>
          {banner && <div className="banner error" role="alert">{banner}</div>}
          <div className="grid2">
            <Field id="nb" label="الفرع"><select id="nb" value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value, teacherId: '' })}>{opts.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
            <Field id="nn" label="اسم الفوج"><input id="nn" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
          </div>
          <div className="grid2">
            <Field id="nl" label="المستوى (اختياري)"><input id="nl" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })} /></Field>
            <Field id="nc" label="السعة" helper="عدد الطلاب المتوقع. للتنبيه فقط."><input id="nc" className="ltr" inputMode="numeric" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value.replace(/\D/g, '') })} /></Field>
          </div>
          <div className="grid2">
            <Field id="nt" label="المعلم (اختياري)" helper="المعلم يمكن أن يكون له أكثر من فوج. والفوج يمكن أن يكون له أكثر من معلم، ويمكنكم إضافتهم لاحقاً."><select id="nt" value={f.teacherId} onChange={(e) => setF({ ...f, teacherId: e.target.value })}><option value="">بلا معلم الآن</option>{branchTeachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
          </div>
          <div className="row"><button className="btn primary" disabled={busy} onClick={create}>إنشاء الفوج</button><button className="btn" onClick={() => setAdding(false)}>إلغاء</button></div>
        </section>
      )}
      {rows && rows.length === 0 ? (
        <div className="empty"><div className="niche" aria-hidden="true" />
          {empty ? <><h2>ابدؤوا بإنشاء الأفواج</h2><p>الفوج هو حلقة المعلم. أنشئوا أفواج كل فرع، ثم أضيفوا المعلمين والطلاب إليها.</p>{opts?.canEdit && <button className="btn primary" onClick={start}>إضافة فوج</button>}</>
            : <><h2>لا أفواج {status === 'closed' ? 'مغلقة' : 'هنا'}</h2><p>لا يوجد ما يطابق العرض الحالي.</p></>}
        </div>
      ) : (
        <div className="grid-wrap"><table className="grid" aria-label="قائمة الأفواج">
          <thead><tr><th scope="col">الفوج</th><th scope="col">الفرع</th><th scope="col">المستوى</th><th scope="col">المعلمون</th><th scope="col">الطلاب / السعة</th></tr></thead>
          <tbody>{(rows ?? []).map((g) => (
            <tr key={g.id} tabIndex={0} onClick={() => setOpen(g.id)} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(g.id); }}>
              <td><b>{g.name}</b></td><td>{g.branchName}</td><td>{g.level ?? '—'}</td><td>{g.teachers.length ? g.teachers.map((t) => t.name).join('، ') : <span className="helper">بلا معلم</span>}</td><td>{fill(g)}</td>
            </tr>))}</tbody></table>
          <div className="grid-foot"><span><span className="num">{rows?.length ?? 0}</span> من الأفواج</span></div></div>
      )}
    </div>
  );
}

/** Facts shown on a student's profile: the current group and past groups. */
export function StudentGroupFacts({ studentId }: { studentId: string }) {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof groupsApi.ofStudent>>['info']>(null);
  useEffect(() => { let live = true; groupsApi.ofStudent(studentId).then((r) => { if (live) setInfo(r.info); }); return () => { live = false; }; }, [studentId]);
  const [tot, setTot] = useState<{ present: number; late: number; excused: number; absent: number; recorded: number } | null>(null);
  useEffect(() => { let live = true; attApi.ofStudent(studentId).then((r) => { if (live) setTot(r.totals); }); return () => { live = false; }; }, [studentId]);
  if (!info) return null;
  return (
    <dl className="facts"><dt>الفوج</dt><dd>{info.current ? info.current.name : <span className="helper">غير مسجّل في فوج</span>}</dd>
      {info.past.length > 0 && <><dt>أفواج سابقة</dt><dd>{info.past.map((p) => p.name).join('، ')}</dd></>}
      {tot && tot.recorded > 0 && <><dt>الحضور هذا العام</dt><dd><span className="num">{tot.present + tot.late}</span> حضور من <span className="num">{tot.recorded}</span>، غياب <span className="num">{tot.absent}</span>، بعذر <span className="num">{tot.excused}</span></dd></>}</dl>
  );
}

/** Facts shown on a teacher's profile: the groups led. */
export function TeacherGroupFacts({ staffId }: { staffId: string }) {
  const [rows, setRows] = useState<{ id: string; name: string; members: number }[] | null>(null);
  useEffect(() => { let live = true; groupsApi.ofTeacher(staffId).then((r) => { if (live) setRows(r.rows); }); return () => { live = false; }; }, [staffId]);
  if (!rows) return null;
  return <dl className="facts"><dt>الأفواج</dt><dd>{rows.length ? rows.map((g) => `${g.name} (${g.members})`).join('، ') : <span className="helper">لا أفواج بعد</span>}</dd></dl>;
}
