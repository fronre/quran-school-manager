import { useEffect, useMemo, useState } from 'react';
import { validateStudent, STUDENT_STATUSES, type StudentInput, type StudentStatus } from '@mishkat/domain';
import { api, STATUS_LABEL, STATUS_TONE, STUDENT_ERROR_TEXT, STUDENT_ISSUE_TEXT, type StudentRow } from './api';
import { Activity, PhotoBox, ProfileFrame } from './Profile';
import { StudentGroupFacts } from './Groups';
import { StudentMemo, useMemoAccess } from './Memorization';
import { StudentGuardians } from './Guardians';
import { PrintStudentButton } from './PrintStudent';

const today = () => new Date().toISOString().slice(0, 10);
const toInput = (r: StudentRow): StudentInput => ({ givenName: r.givenName, familyName: r.familyName, birthDate: r.birthDate, phone: r.phone, branchId: r.branchId, status: r.status, joinedOn: r.joinedOn, studentNo: r.studentNo });

function Field({ id, label, helper, error, children }: { id: string; label: string; helper?: string; error?: string; children: React.ReactNode }) {
  return <div className="field"><label htmlFor={id}>{label}</label>{children}{helper && !error && <p className="helper">{helper}</p>}{error && <p className="field-error" role="alert">{error}</p>}</div>;
}

/** Full profile page of one student: photo, editable data, and the history of what happened to the record. */
export function StudentProfile({ row, branches, canTransfer, canEdit, association = '', onBack, onChanged }: {
  row: StudentRow; branches: { id: string; name: string }[]; canTransfer: boolean; canEdit: boolean; association?: string; onBack: () => void; onChanged: () => void;
}) {
  const [tab, setTab] = useState('data'); const [f, setF] = useState<StudentInput>(toInput(row)); const [editing, setEditing] = useState(false);
  const [touched, setTouched] = useState(false); const [busy, setBusy] = useState(false); const [refresh, setRefresh] = useState(0);
  const [banner, setBanner] = useState<{ tone: 'error' | 'warn' | 'info'; text: string; dups?: StudentRow[] } | null>(null); const [serverIssues, setServerIssues] = useState<Record<string, string>>({});
  const [archiving, setArchiving] = useState(false); const [reason, setReason] = useState('');
  useEffect(() => { setF(toInput(row)); setEditing(false); setTouched(false); setBanner(null); }, [row]);

  const memoAccess = useMemoAccess();
  const readOnly = !canEdit || !!row.archivedAt;
  const issues = useMemo(() => Object.fromEntries(validateStudent(f, today()).map((i) => [i.field, STUDENT_ISSUE_TEXT[i.code]!])), [f]);
  const err = (k: string) => (touched ? issues[k] : undefined) ?? serverIssues[k];
  const set = <K extends keyof StudentInput>(k: K, v: StudentInput[K]) => { setF({ ...f, [k]: v }); setServerIssues({}); };
  const branchLocked = !canTransfer;
  const dirty = JSON.stringify(f) !== JSON.stringify(toInput(row));

  async function save(ignore = false) {
    setTouched(true); setBanner(null); if (Object.keys(issues).length) return;
    setBusy(true); const r = await api.studentUpdate(row.id, row.version, f, ignore); setBusy(false);
    if (r.ok) { setRefresh((n) => n + 1); onChanged(); return; }
    if (r.error === 'duplicates') { setBanner({ tone: 'warn', text: 'قد يكون هذا الطالب مسجّلاً من قبل (الاسم وتاريخ الميلاد متطابقان):', dups: r.duplicates }); return; }
    if (r.error === 'invalid') { setServerIssues(Object.fromEntries((r.issues ?? []).map((i) => [i.field, STUDENT_ISSUE_TEXT[i.code] ?? '']))); setBanner({ tone: 'error', text: STUDENT_ERROR_TEXT.invalid! }); return; }
    if (r.error === 'duplicate_number') setServerIssues({ studentNo: STUDENT_ERROR_TEXT.duplicate_number! });
    setBanner({ tone: 'error', text: STUDENT_ERROR_TEXT[r.error] ?? 'تعذّر الحفظ. أعيدوا المحاولة. بياناتكم الحالية سليمة.' });
  }
  async function archive() { setBusy(true); const r = await api.studentArchive(row.id, reason); setBusy(false); if (r.ok) { setArchiving(false); setReason(''); onChanged(); } else setBanner({ tone: 'error', text: STUDENT_ERROR_TEXT[r.error] ?? 'تعذّرت الأرشفة.' }); }
  async function restore() { setBusy(true); const r = await api.studentUnarchive(row.id); setBusy(false); if (r.ok) onChanged(); else setBanner({ tone: 'error', text: STUDENT_ERROR_TEXT[r.error] ?? 'تعذّرت الاستعادة.' }); }

  const name = `${row.givenName} ${row.familyName}`;
  const badge = <span className={`badge ${row.archivedAt ? 'neutral' : STATUS_TONE[row.status]}`}><i aria-hidden="true" />{row.archivedAt ? 'مؤرشف' : STATUS_LABEL[row.status]}</span>;

  return (
    <ProfileFrame onBack={onBack} backLabel="كل الطلاب" headline={name} badges={badge} tabs={memoAccess?.canView ? [['data', 'البيانات'], ['guardians', 'الأولياء'], ['memo', 'الحفظ'], ['activity', 'السجل']] : [['data', 'البيانات'], ['guardians', 'الأولياء'], ['activity', 'السجل']]} tab={tab} onTab={setTab}
      aside={<>
        <PhotoBox kind="student" id={row.id} given={row.givenName} family={row.familyName} canEdit={canEdit && !row.archivedAt} consentLabel="من وافق على حفظ صورة الطالب؟" onChanged={() => setRefresh((n) => n + 1)} />
        <dl className="facts">
          <dt>رقم الطالب</dt><dd className="num">{row.studentNo}</dd>
          <dt>الفرع</dt><dd>{row.branchName}</dd>
          <dt>الانضمام</dt><dd className="num">{row.joinedOn ?? '—'}</dd>
        </dl>
        <StudentGroupFacts studentId={row.id} />
        <p><PrintStudentButton row={row} association={association} /></p>
      </>}>
      {tab === 'guardians' ? <StudentGuardians studentId={row.id} studentName={`${row.givenName} ${row.familyName}`} association={association} canEdit={canEdit && !row.archivedAt} /> : tab === 'memo' ? <StudentMemo studentId={row.id} canRecord={!!memoAccess?.canRecord && !row.archivedAt} /> : tab === 'activity' ? <Activity kind="student" id={row.id} refreshKey={refresh} /> : (
        <div className="profile-form">
          {row.archivedAt && <div className="banner info">الطالب في الأرشيف. السبب: {row.archiveReason}</div>}
          {banner && (
            <div className={`banner ${banner.tone === 'warn' ? 'warn' : banner.tone === 'info' ? 'info' : 'error'}`} role="alert">{banner.text}
              {banner.dups && <ul className="dups">{banner.dups.map((d) => <li key={d.id}>{d.givenName} {d.familyName} — <span className="num">{d.studentNo}</span> — {d.branchName}</li>)}</ul>}
              {banner.dups && <div className="row-actions"><button className="btn" onClick={() => setBanner(null)}>تعديل البيانات</button><button className="btn primary" onClick={() => save(true)} disabled={busy}>حفظ رغم ذلك</button></div>}
            </div>
          )}
          <div className="grid2">
            <Field id="pg" label="الاسم" error={err('givenName')}><input id="pg" value={f.givenName} disabled={!editing} onChange={(e) => set('givenName', e.target.value)} /></Field>
            <Field id="pf" label="اللقب" error={err('familyName')}><input id="pf" value={f.familyName} disabled={!editing} onChange={(e) => set('familyName', e.target.value)} /></Field>
          </div>
          <div className="grid2">
            <Field id="pn" label="رقم الطالب" error={err('studentNo')}><input id="pn" className="ltr num" value={f.studentNo} disabled={!editing} onChange={(e) => set('studentNo', e.target.value)} /></Field>
            <Field id="pb" label="الفرع" helper={branchLocked && editing ? 'نقل الطالب بين الفروع غير متاح لحسابكم.' : undefined} error={err('branchId')}>
              <select id="pb" value={f.branchId} disabled={!editing || branchLocked} onChange={(e) => set('branchId', e.target.value)}>
                {branches.every((b) => b.id !== f.branchId) && <option value={f.branchId}>{row.branchName}</option>}{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid2">
            <Field id="ps" label="الحالة" error={err('status')}><select id="ps" value={f.status} disabled={!editing} onChange={(e) => set('status', e.target.value as StudentStatus)}>{STUDENT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></Field>
            <Field id="pj" label="تاريخ الانضمام" error={err('joinedOn')}><input id="pj" type="date" className="ltr" value={f.joinedOn ?? ''} disabled={!editing} onChange={(e) => set('joinedOn', e.target.value || null)} /></Field>
          </div>
          <div className="grid2">
            <Field id="pd" label="تاريخ الميلاد" error={err('birthDate')}><input id="pd" type="date" className="ltr" value={f.birthDate ?? ''} disabled={!editing} onChange={(e) => set('birthDate', e.target.value || null)} /></Field>
            <Field id="pp" label="الهاتف" error={err('phone')}><input id="pp" className="ltr num" value={f.phone ?? ''} disabled={!editing} onChange={(e) => set('phone', e.target.value || null)} /></Field>
          </div>
          {archiving && (
            <div className="confirm"><p><b>أرشفة الطالب لا تحذف شيئاً.</b> يختفي من القوائم الحالية وتبقى كل بياناته، ويمكن استعادته.</p>
              <Field id="par" label="سبب الأرشفة"><input id="par" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
              <div className="row-actions"><button className="btn" onClick={() => setArchiving(false)}>إلغاء</button><button className="btn danger" onClick={archive} disabled={busy || !reason.trim()}>أرشفة الطالب</button></div></div>
          )}
          <div className="row-actions sticky">
            {!readOnly && !editing && <button className="btn primary" onClick={() => setEditing(true)}>تعديل البيانات</button>}
            {editing && <><button className="btn primary" onClick={() => save(false)} disabled={busy || !dirty}>حفظ التعديلات</button><button className="btn" onClick={() => { setF(toInput(row)); setEditing(false); setTouched(false); setBanner(null); }} disabled={busy}>إلغاء</button></>}
            {canEdit && !row.archivedAt && !archiving && !editing && <button className="btn" onClick={() => setArchiving(true)}>أرشفة</button>}
            {canEdit && row.archivedAt && <button className="btn primary" onClick={restore} disabled={busy}>استعادة الطالب</button>}
          </div>
        </div>
      )}
    </ProfileFrame>
  );
}
