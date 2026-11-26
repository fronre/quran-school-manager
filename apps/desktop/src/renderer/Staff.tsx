import { useCallback, useEffect, useMemo, useState } from 'react';
import { validateStaff, STAFF_KINDS, STAFF_POSITIONS, type StaffInput, type StaffKind, type StaffPosition } from '@mishkat/domain';
import { api, KIND_LABEL, POSITION_LABEL, STAFF_ERROR_TEXT, STAFF_ISSUE_TEXT, type PhotoData, type StaffRow, type UserView } from './api';
import { Activity, Avatar, PhotoBox, ProfileFrame } from './Profile';
import { TeacherGroupFacts } from './Groups';

const today = () => new Date().toISOString().slice(0, 10);
const toInput = (r: StaffRow): StaffInput => ({ givenName: r.givenName, familyName: r.familyName, birthDate: r.birthDate, phone: r.phone, branchId: r.branchId ?? '', position: r.position, kind: r.kind });
const POSITIONS = STAFF_POSITIONS.filter((p) => p !== 'administrator');

function Field({ id, label, helper, error, children }: { id: string; label: string; helper?: string; error?: string; children: React.ReactNode }) {
  return <div className="field"><label htmlFor={id}>{label}</label>{children}{helper && !error && <p className="helper">{helper}</p>}{error && <p className="field-error" role="alert">{error}</p>}</div>;
}

function RowAvatar({ row }: { row: StaffRow }) {
  const [photo, setPhoto] = useState<PhotoData | null>(null);
  useEffect(() => { let live = true; if (row.hasPhoto) api.photoGet('staff', row.id).then((r) => { if (live) setPhoto(r.photo); }); else setPhoto(null); return () => { live = false; }; }, [row.id, row.hasPhoto, row.version]);
  return <Avatar given={row.givenName} family={row.familyName} photo={photo} />;
}

/** Profile page of a teacher / staff member, or the form for adding a new one (row = null). */
function StaffProfile({ row, branches, canTransfer, canEdit, defaultBranch, onBack, onChanged, onCreated, onNewGroup }: {
  row: StaffRow | null; branches: { id: string; name: string }[]; canTransfer: boolean; canEdit: boolean; defaultBranch: string; onBack: () => void; onChanged: () => void; onNewGroup?: (t: { id: string; name: string; branchId: string }) => void; onCreated: (id: string) => void;
}) {
  const isNew = !row;
  const blank: StaffInput = { givenName: '', familyName: '', birthDate: null, phone: null, branchId: defaultBranch || branches[0]?.id || '', position: 'teacher', kind: 'employee' };
  const [tab, setTab] = useState('data'); const [f, setF] = useState<StaffInput>(row ? toInput(row) : blank); const [editing, setEditing] = useState(isNew);
  const [touched, setTouched] = useState(false); const [busy, setBusy] = useState(false); const [refresh, setRefresh] = useState(0);
  const [banner, setBanner] = useState<string | null>(null); const [serverIssues, setServerIssues] = useState<Record<string, string>>({});
  const [archiving, setArchiving] = useState(false); const [reason, setReason] = useState('');
  useEffect(() => { if (row) { setF(toInput(row)); setEditing(false); setTouched(false); setBanner(null); } }, [row]);

  const readOnly = !canEdit || !!row?.archivedAt;
  const issues = useMemo(() => Object.fromEntries(validateStaff(f, today()).map((i) => [i.field, STAFF_ISSUE_TEXT[i.code]!])), [f]);
  const err = (k: string) => (touched ? issues[k] : undefined) ?? serverIssues[k];
  const set = <K extends keyof StaffInput>(k: K, v: StaffInput[K]) => { setF({ ...f, [k]: v }); setServerIssues({}); };
  const branchLocked = !!row && !canTransfer;
  const dirty = !row || JSON.stringify(f) !== JSON.stringify(toInput(row));

  async function save() {
    setTouched(true); setBanner(null); if (Object.keys(issues).length) return;
    setBusy(true); const r = row ? await api.staffUpdate(row.id, row.version, f) : await api.staffCreate(f); setBusy(false);
    if (r.ok) {
      const createdId = (r as unknown as { id?: string }).id;
      if (!row && createdId) onCreated(createdId); else { setRefresh((n) => n + 1); onChanged(); }
      return;
    }
    if (r.error === 'invalid') { setServerIssues(Object.fromEntries((r.issues ?? []).map((i) => [i.field, STAFF_ISSUE_TEXT[i.code] ?? '']))); setBanner(STAFF_ERROR_TEXT.invalid!); return; }
    setBanner(STAFF_ERROR_TEXT[r.error] ?? 'تعذّر الحفظ. أعيدوا المحاولة. بياناتكم الحالية سليمة.');
  }
  async function archive() { setBusy(true); const r = await api.staffArchive(row!.id, reason); setBusy(false); if (r.ok) { setArchiving(false); setReason(''); onChanged(); } else setBanner(STAFF_ERROR_TEXT[r.error] ?? 'تعذّرت الأرشفة.'); }
  async function restore() { setBusy(true); const r = await api.staffUnarchive(row!.id); setBusy(false); if (r.ok) onChanged(); else setBanner(STAFF_ERROR_TEXT[r.error] ?? 'تعذّرت الاستعادة.'); }

  const headline = row ? `${row.givenName} ${row.familyName}` : 'إضافة معلم';
  const badge = row ? <span className={`badge ${row.archivedAt ? 'neutral' : 'teal'}`}><i aria-hidden="true" />{row.archivedAt ? 'مؤرشف' : POSITION_LABEL[row.position]}</span> : undefined;
  return (
    <ProfileFrame onBack={onBack} backLabel="كل المعلمين" headline={headline} badges={badge} tabs={isNew ? [['data', 'البيانات']] : [['data', 'البيانات'], ['activity', 'السجل']]} tab={tab} onTab={setTab}
      aside={row ? <>
        <PhotoBox kind="staff" id={row.id} given={row.givenName} family={row.familyName} canEdit={canEdit && !row.archivedAt} consentLabel="من وافق على حفظ الصورة؟" onChanged={() => { setRefresh((n) => n + 1); onChanged(); }} />
        <dl className="facts"><dt>الفرع</dt><dd>{row.branchName}</dd><dt>الوظيفة</dt><dd>{POSITION_LABEL[row.position]}</dd><dt>النوع</dt><dd>{KIND_LABEL[row.kind]}</dd></dl>
        {row.position === 'teacher' && <TeacherGroupFacts staffId={row.id} />}
        {row.position === 'teacher' && !row.archivedAt && row.branchId && onNewGroup && <p><button className="btn primary" onClick={() => onNewGroup({ id: row.id, name: `${row.givenName} ${row.familyName}`, branchId: row.branchId! })}>إنشاء فوج لهذا المعلم</button></p>}
      </> : <p className="helper">يمكنكم إضافة الصورة بعد حفظ البيانات.</p>}>
      {tab === 'activity' && row ? <Activity kind="staff" id={row.id} refreshKey={refresh} /> : (
        <div className="profile-form">
          {row?.archivedAt && <div className="banner info">السجل في الأرشيف. السبب: {row.archiveReason}</div>}
          {banner && <div className="banner error" role="alert">{banner}</div>}
          <div className="grid2">
            <Field id="sg" label="الاسم" error={err('givenName')}><input id="sg" value={f.givenName} disabled={!editing} onChange={(e) => set('givenName', e.target.value)} autoFocus={isNew} /></Field>
            <Field id="sf" label="اللقب" error={err('familyName')}><input id="sf" value={f.familyName} disabled={!editing} onChange={(e) => set('familyName', e.target.value)} /></Field>
          </div>
          <div className="grid2">
            <Field id="sb" label="الفرع" helper={branchLocked && editing ? 'نقل المعلم بين الفروع غير متاح لحسابكم.' : undefined} error={err('branchId')}>
              <select id="sb" value={f.branchId} disabled={!editing || branchLocked} onChange={(e) => set('branchId', e.target.value)}>
                {branches.every((b) => b.id !== f.branchId) && <option value={f.branchId}>{row?.branchName ?? ''}</option>}{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <Field id="sp" label="الوظيفة" error={err('position')}><select id="sp" value={f.position} disabled={!editing} onChange={(e) => set('position', e.target.value as StaffPosition)}>{POSITIONS.map((p) => <option key={p} value={p}>{POSITION_LABEL[p]}</option>)}</select></Field>
          </div>
          <div className="grid2">
            <Field id="sk" label="النوع" error={err('kind')}><select id="sk" value={f.kind} disabled={!editing} onChange={(e) => set('kind', e.target.value as StaffKind)}>{STAFF_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></Field>
            <Field id="sd" label="تاريخ الميلاد (اختياري)" error={err('birthDate')}><input id="sd" type="date" className="ltr" value={f.birthDate ?? ''} disabled={!editing} onChange={(e) => set('birthDate', e.target.value || null)} /></Field>
          </div>
          <Field id="sh" label="الهاتف (اختياري)" error={err('phone')}><input id="sh" className="ltr num" value={f.phone ?? ''} disabled={!editing} onChange={(e) => set('phone', e.target.value || null)} /></Field>
          <p className="helper">الأفواج التي يدرّسها المعلم تُضاف عند بناء شاشة الأفواج.</p>
          {archiving && row && (
            <div className="confirm"><p><b>الأرشفة لا تحذف شيئاً.</b> يختفي من القائمة الحالية وتبقى بياناته، ويمكن استعادته.</p>
              <Field id="sar" label="سبب الأرشفة"><input id="sar" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
              <div className="row-actions"><button className="btn" onClick={() => setArchiving(false)}>إلغاء</button><button className="btn danger" onClick={archive} disabled={busy || !reason.trim()}>أرشفة</button></div></div>
          )}
          <div className="row-actions sticky">
            {isNew && <><button className="btn primary" onClick={save} disabled={busy}>إضافة المعلم</button><button className="btn" onClick={onBack}>إلغاء</button></>}
            {row && !readOnly && !editing && <button className="btn primary" onClick={() => setEditing(true)}>تعديل البيانات</button>}
            {row && editing && <><button className="btn primary" onClick={save} disabled={busy || !dirty}>حفظ التعديلات</button><button className="btn" onClick={() => { setF(toInput(row)); setEditing(false); setTouched(false); setBanner(null); }} disabled={busy}>إلغاء</button></>}
            {row && canEdit && !row.archivedAt && !archiving && !editing && <button className="btn" onClick={() => setArchiving(true)}>أرشفة</button>}
            {row && canEdit && row.archivedAt && <button className="btn primary" onClick={restore} disabled={busy}>استعادة</button>}
          </div>
        </div>
      )}
    </ProfileFrame>
  );
}

export function Staff({ user, scope, onNewGroup }: { user: UserView; scope: string; onNewGroup?: (t: { id: string; name: string; branchId: string }) => void }) {
  const canEdit = user.permissions.includes('staff.edit');
  const [search, setSearch] = useState(''); const branchId = scope; const [position, setPosition] = useState<StaffPosition | 'all'>('teacher'); const [archived, setArchived] = useState<'active' | 'archived'>('active');
  const [data, setData] = useState<{ rows: StaffRow[]; total: number } | null>(null); const [opts, setOpts] = useState<{ branches: { id: string; name: string }[]; canTransfer: boolean } | null>(null);
  const [profile, setProfile] = useState<StaffRow | 'new' | null>(null); const [debounced, setDebounced] = useState('');
  useEffect(() => { const t = setTimeout(() => setDebounced(search), 200); return () => clearTimeout(t); }, [search]);
  const load = useCallback(async () => { setData(await api.staffList({ search: debounced || undefined, branchId: branchId || undefined, position, archived, limit: 200 })); }, [debounced, branchId, position, archived]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.staffForm().then(setOpts); }, []);
  const empty = data && data.total === 0 && !debounced && !branchId && position === 'teacher' && archived === 'active';

  if (profile && opts) {
    return <StaffProfile row={profile === 'new' ? null : profile} branches={opts.branches} canTransfer={opts.canTransfer} canEdit={canEdit} defaultBranch={branchId} onNewGroup={user.permissions.includes('group.edit') ? onNewGroup : undefined}
      onBack={() => setProfile(null)} onChanged={async () => { await load(); if (profile !== 'new') { const r = await api.staffGet(profile.id); if (r.staff) setProfile(r.staff); } }}
      onCreated={async (id) => { await load(); const r = await api.staffGet(id); setProfile(r.staff ?? null); }} />;
  }
  return (
    <div className="students">
      <div className="filters">
        <input className="search" type="search" placeholder="ابحثوا بالاسم" aria-label="بحث في المعلمين" value={search} onChange={(e) => setSearch(e.target.value)} />
                <select aria-label="الوظيفة" value={position} onChange={(e) => setPosition(e.target.value as StaffPosition | 'all')}><option value="teacher">المعلمون</option><option value="supervisor">المشرفون</option><option value="other">آخرون</option><option value="all">كل العاملين</option></select>
        <div className="seg" role="group" aria-label="العرض"><button aria-pressed={archived === 'active'} onClick={() => setArchived('active')}>الحاليون</button><button aria-pressed={archived === 'archived'} onClick={() => setArchived('archived')}>الأرشيف</button></div>
        <span className="sp" />
        {canEdit && <button className="btn primary" disabled={!opts || opts.branches.length === 0} onClick={() => setProfile('new')}>إضافة معلم</button>}
      </div>
      {data && data.total === 0 ? (
        <div className="empty"><div className="niche" aria-hidden="true" />
          {empty ? <><h2>ابدؤوا بإضافة المعلمين</h2><p>لا يوجد معلمون بعد. أضيفوا المعلم الأول لكل فرع، وستظهر صورهم وبياناتهم هنا.</p>{canEdit && <button className="btn primary" onClick={() => setProfile('new')}>إضافة معلم</button>}</>
            : <><h2>لا نتائج مطابقة</h2><p>لا يوجد من يطابق البحث أو التصفية الحالية.</p><button className="btn" onClick={() => { setSearch(''); setPosition('teacher'); setArchived('active'); }}>مسح التصفية</button></>}
        </div>
      ) : (
        <div className="grid-wrap"><table className="grid" aria-label="قائمة المعلمين">
          <thead><tr><th scope="col" className="avatar-col" /><th scope="col">الاسم</th><th scope="col">الفرع</th><th scope="col">الوظيفة</th><th scope="col">النوع</th><th scope="col">الهاتف</th></tr></thead>
          <tbody>{(data?.rows ?? []).map((r) => (
            <tr key={r.id} tabIndex={0} onClick={() => setProfile(r)} onKeyDown={(e) => { if (e.key === 'Enter') setProfile(r); }}>
              <td className="avatar-col"><RowAvatar row={r} /></td><td><b>{r.givenName} {r.familyName}</b></td><td>{r.branchName}</td><td>{POSITION_LABEL[r.position]}</td><td>{KIND_LABEL[r.kind]}</td><td className="num">{r.phone ?? '—'}</td>
            </tr>))}</tbody></table>
          <div className="grid-foot"><span><span className="num">{data?.total ?? 0}</span> من العاملين</span></div></div>
      )}
    </div>
  );
}
