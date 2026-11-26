import { PrintHead } from './PrintKit';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { validateStudent, STUDENT_STATUSES, type StudentInput, type StudentStatus } from '@mishkat/domain';
import { StudentProfile } from './StudentProfile';
import { api, studentsWord, STATUS_LABEL, STATUS_TONE, STUDENT_ERROR_TEXT, STUDENT_ISSUE_TEXT, type StudentRow, type UserView } from './api';

const PAGE = 50;
const today = () => new Date().toISOString().slice(0, 10);

function Badge({ status, archived }: { status: StudentStatus; archived: boolean }) {
  return <span className={`badge ${archived ? 'neutral' : STATUS_TONE[status]}`}><i aria-hidden="true" />{archived ? 'مؤرشف' : STATUS_LABEL[status]}</span>;
}

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]); return d;
}

interface FormOpts { nextNo: string; branches: { id: string; name: string }[]; canTransfer: boolean }
type Panel = { mode: 'closed' } | { mode: 'new' } | { mode: 'edit'; row: StudentRow };

function blankInput(o: FormOpts, scope = ''): StudentInput {
  return { givenName: '', familyName: '', birthDate: null, phone: null, branchId: o.branches.find((b) => b.id === scope)?.id ?? o.branches[0]?.id ?? '', status: 'active', joinedOn: today(), studentNo: o.nextNo };
}
const toInput = (r: StudentRow): StudentInput => ({ givenName: r.givenName, familyName: r.familyName, birthDate: r.birthDate, phone: r.phone, branchId: r.branchId, status: r.status, joinedOn: r.joinedOn, studentNo: r.studentNo });

function Field({ id, label, helper, error, children }: { id: string; label: string; helper?: string; error?: string; children: React.ReactNode }) {
  return <div className="field"><label htmlFor={id}>{label}</label>{children}{helper && !error && <p className="helper">{helper}</p>}{error && <p className="field-error" role="alert">{error}</p>}</div>;
}

function StudentPanel({ panel, opts, scope, canEdit, onClose, onChanged, toast }: { panel: Exclude<Panel, { mode: 'closed' }>; opts: FormOpts; scope: string; canEdit: boolean; onClose: () => void; onChanged: () => void; toast: (m: string) => void }) {
  const isNew = panel.mode === 'new'; const row = panel.mode === 'edit' ? panel.row : null;
  const [f, setF] = useState<StudentInput>(() => (row ? toInput(row) : blankInput(opts, scope)));
  const [touched, setTouched] = useState(false); const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ tone: 'error' | 'warn'; text: string; dups?: StudentRow[]; reload?: boolean } | null>(null);
  const [serverIssues, setServerIssues] = useState<Record<string, string>>({});
  const [archiving, setArchiving] = useState(false); const [reason, setReason] = useState('');
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  const readOnly = !canEdit || !!row?.archivedAt;
  const issues = useMemo(() => Object.fromEntries(validateStudent(f, today()).map((i) => [i.field, STUDENT_ISSUE_TEXT[i.code]!])), [f]);
  const err = (k: string) => (touched ? issues[k] : undefined) ?? serverIssues[k];
  const set = <K extends keyof StudentInput>(k: K, v: StudentInput[K]) => { setF({ ...f, [k]: v }); setServerIssues({}); };
  const branchName = opts.branches.find((b) => b.id === f.branchId)?.name ?? row?.branchName ?? '';
  const branchLocked = !!row && !opts.canTransfer;

  async function save(ignore = false) {
    setTouched(true); setBanner(null);
    if (Object.keys(issues).length) return;
    setBusy(true);
    const r = row ? await api.studentUpdate(row.id, row.version, f, ignore) : await api.studentCreate(f, ignore);
    setBusy(false);
    if (r.ok) { toast(row ? 'تم حفظ التعديلات' : 'تمت إضافة الطالب'); onChanged(); onClose(); return; }
    if (r.error === 'duplicates') { setBanner({ tone: 'warn', text: 'قد يكون هذا الطالب مسجّلاً من قبل (الاسم وتاريخ الميلاد متطابقان):', dups: r.duplicates }); return; }
    if (r.error === 'invalid') { setServerIssues(Object.fromEntries((r.issues ?? []).map((i) => [i.field, STUDENT_ISSUE_TEXT[i.code] ?? ''])));
      setBanner({ tone: 'error', text: STUDENT_ERROR_TEXT.invalid! }); return; }
    if (r.error === 'duplicate_number') setServerIssues({ studentNo: STUDENT_ERROR_TEXT.duplicate_number! });
    setBanner({ tone: 'error', text: STUDENT_ERROR_TEXT[r.error] ?? 'تعذّر الحفظ. أعيدوا المحاولة. بياناتكم الحالية سليمة.', reload: r.error === 'conflict' || r.error === 'not_found' });
  }
  async function archive() {
    if (!row) return; setBusy(true);
    const r = await api.studentArchive(row.id, reason); setBusy(false);
    if (r.ok) { toast('تمت أرشفة الطالب'); onChanged(); onClose(); } else setBanner({ tone: 'error', text: STUDENT_ERROR_TEXT[r.error] ?? 'تعذّرت الأرشفة.' });
  }
  async function restore() {
    if (!row) return; setBusy(true);
    const r = await api.studentUnarchive(row.id); setBusy(false);
    if (r.ok) { toast('تمت استعادة الطالب'); onChanged(); onClose(); } else setBanner({ tone: 'error', text: STUDENT_ERROR_TEXT[r.error] ?? 'تعذّرت الاستعادة.' });
  }

  return (
    <aside className="panel" role="dialog" aria-label={isNew ? 'إضافة طالب' : 'بيانات الطالب'} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <header className="panel-head">
        <h2>{isNew ? 'إضافة طالب' : `${row!.givenName} ${row!.familyName}`}</h2>
        <button className="btn quiet" onClick={onClose} aria-label="إغلاق">إغلاق</button>
      </header>
      <div className="panel-body">
        {row?.archivedAt && <div className="banner info">الطالب في الأرشيف. السبب: {row.archiveReason}</div>}
        {banner && (
          <div className={`banner ${banner.tone === 'warn' ? 'warn' : 'error'}`} role="alert">
            {banner.text}
            {banner.dups && <ul className="dups">{banner.dups.map((d) => <li key={d.id}>{d.givenName} {d.familyName} — <span className="num">{d.studentNo}</span> — {d.branchName}</li>)}</ul>}
            {banner.dups && <div className="row-actions"><button className="btn" onClick={() => setBanner(null)}>تعديل البيانات</button><button className="btn primary" onClick={() => save(true)} disabled={busy}>حفظ رغم ذلك</button></div>}
            {banner.reload && <div className="row-actions"><button className="btn" onClick={() => { onChanged(); onClose(); }}>إعادة التحميل</button></div>}
          </div>
        )}
        <div className="grid2">
          <Field id="sg" label="الاسم" error={err('givenName')}><input id="sg" ref={first} value={f.givenName} disabled={readOnly} onChange={(e) => set('givenName', e.target.value)} /></Field>
          <Field id="sf" label="اللقب" error={err('familyName')}><input id="sf" value={f.familyName} disabled={readOnly} onChange={(e) => set('familyName', e.target.value)} /></Field>
        </div>
        <div className="grid2">
          <Field id="sn" label="رقم الطالب" helper="مقترح تلقائياً، ويمكنكم تغييره." error={err('studentNo')}><input id="sn" className="ltr num" value={f.studentNo} disabled={readOnly} onChange={(e) => set('studentNo', e.target.value)} /></Field>
          <Field id="sb" label="الفرع" helper={branchLocked ? 'نقل الطالب بين الفروع غير متاح لحسابكم.' : undefined} error={err('branchId')}>
            <select id="sb" value={f.branchId} disabled={readOnly || branchLocked} onChange={(e) => set('branchId', e.target.value)}>
              {opts.branches.every((b) => b.id !== f.branchId) && <option value={f.branchId}>{branchName}</option>}
              {opts.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid2">
          <Field id="ss" label="الحالة" error={err('status')}>
            <select id="ss" value={f.status} disabled={readOnly} onChange={(e) => set('status', e.target.value as StudentStatus)}>{STUDENT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
          </Field>
          <Field id="sj" label="تاريخ الانضمام (اختياري)" error={err('joinedOn')}><input id="sj" type="date" className="ltr" value={f.joinedOn ?? ''} disabled={readOnly} onChange={(e) => set('joinedOn', e.target.value || null)} /></Field>
        </div>
        <div className="grid2">
          <Field id="sd" label="تاريخ الميلاد (اختياري)" helper="يساعد على كشف التسجيل المكرر." error={err('birthDate')}><input id="sd" type="date" className="ltr" value={f.birthDate ?? ''} disabled={readOnly} onChange={(e) => set('birthDate', e.target.value || null)} /></Field>
          <Field id="sp" label="الهاتف (اختياري)" error={err('phone')}><input id="sp" className="ltr num" value={f.phone ?? ''} disabled={readOnly} onChange={(e) => set('phone', e.target.value || null)} /></Field>
        </div>
        <p className="helper">الحقول المطلوبة قليلة عمداً. قائمة بيانات الطالب النهائية لم تُحسم بعد.</p>

        {archiving && (
          <div className="confirm">
            <p><b>أرشفة الطالب لا تحذف شيئاً.</b> يختفي من القوائم الحالية وتبقى كل بياناته وسجلاته، ويمكن استعادته.</p>
            <Field id="ar" label="سبب الأرشفة"><input id="ar" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
            <div className="row-actions"><button className="btn" onClick={() => setArchiving(false)}>إلغاء</button><button className="btn danger" onClick={archive} disabled={busy || !reason.trim()}>أرشفة الطالب</button></div>
          </div>
        )}
      </div>
      <footer className="panel-foot">
        {!readOnly && <button className="btn primary" onClick={() => save(false)} disabled={busy}>{isNew ? 'إضافة الطالب' : 'حفظ التعديلات'}</button>}
        {row && canEdit && !row.archivedAt && !archiving && <button className="btn" onClick={() => setArchiving(true)}>أرشفة</button>}
        {row && canEdit && row.archivedAt && <button className="btn primary" onClick={restore} disabled={busy}>استعادة الطالب</button>}
      </footer>
    </aside>
  );
}

export function Students({ user, scope, startNew, onStartedNew, onImport, onImportGuardians, onUpdateImport }: { user: UserView; scope: string; startNew: boolean; onStartedNew: () => void; onImport: () => void; onImportGuardians?: () => void; onUpdateImport?: () => void }) {
  const canEdit = user.permissions.includes('student.edit');
  const [search, setSearch] = useState(''); const q = useDebounced(search, 200);
  const branchId = scope; const [status, setStatus] = useState<'' | StudentStatus>(''); const [archived, setArchived] = useState<'active' | 'archived'>('active');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ rows: StudentRow[]; total: number; counts: { active: number; archived: number } } | null>(null);
  const [opts, setOpts] = useState<FormOpts | null>(null);
  const [panel, setPanel] = useState<Panel>({ mode: 'closed' });
  const [profile, setProfile] = useState<StudentRow | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [printRows, setPrintRows] = useState<StudentRow[] | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const canImport = user.permissions.includes('import.run');
  const canExport = user.permissions.includes('report.view') || user.permissions.includes('report.view_limited');

  const load = useCallback(async () => {
    try {
      const r = await api.studentsList({ search: q || undefined, branchId: branchId || undefined, status: status || undefined, archived, limit: PAGE, offset: page * PAGE });
      if ('rows' in r) { setData(r); setLoadError(false); } else setLoadError(true);
    } catch { setLoadError(true); }
  }, [q, branchId, status, archived, page]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [q, branchId, status, archived]);
  useEffect(() => { api.studentsForm().then((o) => { if ('nextNo' in o) setOpts(o); }); }, [panel.mode]);
  useEffect(() => { if (startNew && opts && canEdit) { setPanel({ mode: 'new' }); onStartedNew(); } }, [startNew, opts, canEdit, onStartedNew]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === '/' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement)) { e.preventDefault(); searchRef.current?.focus(); } };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, []);
  const currentFilter = () => ({ search: q || undefined, branchId: branchId || undefined, status: status || undefined, archived });
  async function exportAs(format: 'xlsx' | 'xml') {
    setFileBusy(true); const r = await api.exportStudents(format, currentFilter()); setFileBusy(false);
    if (r.ok) toast(`تم حفظ الملف (${r.count} ${studentsWord(r.count ?? 0)})`); else if (r.error !== 'cancelled') toast('تعذّر حفظ الملف. أعيدوا المحاولة.');
  }
  async function printList() {
    setFileBusy(true); const all: StudentRow[] = []; let off = 0;
    for (;;) { const r = await api.studentsList({ ...currentFilter(), limit: 500, offset: off }); if (!('rows' in r)) break; all.push(...r.rows); off += 500; if (off >= r.total) break; }
    setFileBusy(false); setPrintRows(all);
  }
  useEffect(() => { if (printRows) { const t = setTimeout(() => { window.print(); setPrintRows(null); }, 150); return () => clearTimeout(t); } }, [printRows]);
  const toast = (m: string) => { setToastMsg(m); setTimeout(() => setToastMsg(null), 2600); };

  const total = data?.total ?? 0; const from = total ? page * PAGE + 1 : 0; const to = Math.min((page + 1) * PAGE, total);
  const filtering = !!(q || branchId || status || archived === 'archived');
  const noStudentsAtAll = data && data.counts.active + data.counts.archived === 0;

  if (profile && opts) {
    return <StudentProfile row={profile} branches={opts.branches} canTransfer={opts.canTransfer} canEdit={canEdit} association={user.associationName} onBack={() => setProfile(null)}
      onChanged={async () => { await load(); const r = await api.studentGet(profile.id); if (r.student) setProfile(r.student); }} />;
  }
  return (
    <div className="students">
      <div className="filters">
        <input ref={searchRef} type="search" className="search" placeholder="ابحثوا بالاسم أو رقم الطالب  ( / )" aria-label="بحث في الطلاب" value={search} onChange={(e) => setSearch(e.target.value)} />
                <select aria-label="الحالة" value={status} onChange={(e) => setStatus(e.target.value as '' | StudentStatus)}>
          <option value="">كل الحالات</option>{STUDENT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <div className="seg" role="group" aria-label="العرض">
          <button aria-pressed={archived === 'active'} onClick={() => setArchived('active')}>الحاليون <span className="num">{data?.counts.active ?? 0}</span></button>
          <button aria-pressed={archived === 'archived'} onClick={() => setArchived('archived')}>الأرشيف <span className="num">{data?.counts.archived ?? 0}</span></button>
        </div>
        <span className="sp" />
        {canImport && <button className="btn" onClick={onImport}>استيراد من Excel</button>}
        {canImport && onUpdateImport && <button className="btn" onClick={onUpdateImport}>تحديث طلاب من Excel</button>}
        {user.permissions.includes('guardian.edit') && onImportGuardians && <button className="btn" onClick={onImportGuardians}>استيراد الأولياء</button>}
        {canExport && <><button className="btn" disabled={fileBusy || total === 0} onClick={() => exportAs('xlsx')}>تصدير Excel</button><button className="btn" disabled={fileBusy || total === 0} onClick={() => exportAs('xml')}>تصدير XML</button><button className="btn" disabled={fileBusy || total === 0} onClick={printList}>طباعة</button></>}
        {canEdit && <button className="btn primary" disabled={!opts || opts.branches.length === 0} onClick={() => setPanel({ mode: 'new' })}>إضافة طالب</button>}
      </div>

      {loadError && <div className="banner error" role="alert">تعذّر تحميل القائمة. أعيدوا المحاولة. بياناتكم سليمة. <button className="btn" onClick={load}>إعادة المحاولة</button></div>}

      {data && total === 0 && !loadError ? (
        <div className="empty">
          <div className="niche" aria-hidden="true" />
          {noStudentsAtAll ? (<><h2>ابدؤوا بإضافة الطلاب</h2><p>لا يوجد طلاب بعد. أضيفوا الطالب الأول، أو استوردوا قائمة موجودة لاحقاً من ملف Excel.</p>{canEdit && <button className="btn primary" onClick={() => setPanel({ mode: 'new' })}>إضافة طالب</button>}</>)
            : (<><h2>لا نتائج مطابقة</h2><p>لا يوجد طلاب يطابقون البحث أو التصفية الحالية.</p><button className="btn" onClick={() => { setSearch(''); setStatus(''); setArchived('active'); }}>مسح التصفية</button></>)}
        </div>
      ) : (
        <div className="grid-wrap">
          <table className="grid" aria-label="قائمة الطلاب" aria-rowcount={total}>
            <thead><tr><th scope="col">رقم الطالب</th><th scope="col">الاسم</th><th scope="col">الفرع</th><th scope="col">الحالة</th><th scope="col">الانضمام</th><th scope="col">الهاتف</th></tr></thead>
            <tbody>
              {(data?.rows ?? []).map((r) => (
                <tr key={r.id} tabIndex={0} aria-selected={profile?.id === r.id} onClick={() => setProfile(r)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setProfile(r); }}>
                  <td className="num">{r.studentNo}</td><td><b>{r.givenName} {r.familyName}</b></td><td>{r.branchName}</td>
                  <td><Badge status={r.status} archived={!!r.archivedAt} /></td><td className="num">{r.joinedOn ?? '—'}</td><td className="num">{r.phone ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid-foot" aria-live="polite">
            <span>عرض <span className="num">{from}–{to}</span> من <span className="num">{total}</span></span>
            <span className="sp" />
            <button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>السابق</button>
            <button className="btn" disabled={to >= total} onClick={() => setPage(page + 1)}>التالي</button>
          </div>
        </div>
      )}

      {panel.mode !== 'closed' && opts && <StudentPanel scope={scope} key={panel.mode === 'edit' ? panel.row.id + panel.row.version : 'new'} panel={panel} opts={opts} canEdit={canEdit} onClose={() => setPanel({ mode: 'closed' })} onChanged={load} toast={toast} />}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
      {printRows && (
        <div className="print-sheet" dir="rtl">
          <PrintHead assoc={user.associationName} title="قائمة الطلاب" sub={`${printRows.length} ${studentsWord(printRows.length)}${branchId ? ` — ${user.branches.find((b) => b.id === branchId)?.name ?? ''}` : ''}${status ? ` — ${STATUS_LABEL[status]}` : ''}${archived === 'archived' ? ' — الأرشيف' : ''}`} />
          <table>
            <thead><tr><th>الرقم</th><th>الاسم</th><th>الفرع</th><th>الحالة</th><th>الميلاد</th><th>الهاتف</th></tr></thead>
            <tbody>{printRows.map((r) => <tr key={r.id}><td className="num">{r.studentNo}</td><td>{r.givenName} {r.familyName}</td><td>{r.branchName}</td><td>{r.archivedAt ? 'مؤرشف' : STATUS_LABEL[r.status]}</td><td className="num">{r.birthDate ?? ''}</td><td className="num">{r.phone ?? ''}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
