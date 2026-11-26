import { useCallback, useEffect, useState } from 'react';
import { RELATIONS, RELATION_AR, GUARDIAN_ISSUE_AR, GUARDIAN_FIELD_AR, GUARDIAN_FIELDS, validateGuardian, prettyPhone, normalizePhone, type GuardianInput, type GuardianMapping, type Relation } from '@mishkat/domain';

export interface GuardianRow { linkId: string; guardianId: string; name: string; phone: string; relation: Relation; isPrimary: boolean; whatsapp: boolean; version: number; siblings: number; hasCode?: boolean }
type Res = { ok: true } | { ok: false; error: string; issues?: { field: string; code: string }[] };
const call = <T,>(channel: string, payload?: unknown) => window.mishkat.invoke(channel, payload) as Promise<T>;
const ERR: Record<string, string> = {
  forbidden: 'لا تملكون صلاحية تعديل الأولياء، أو أحدهم مرتبط بطالب من فرع آخر.', student_not_found: 'الطالب غير متاح.', not_found: 'لم يعد هذا السجل متاحاً. أعيدوا تحميل الصفحة.', invalid: 'راجعوا الاسم ورقم الهاتف وصلة القرابة.',
  conflict: 'عُدِّل هذا الولي من مكان آخر. أعيدوا فتحه ثم أعيدوا التعديل.', already_linked: 'هذا الولي مضاف لهذا الطالب من قبل.', not_available: 'تعذّر فتح واتساب لهذا الرقم.',
};
const blank = (): GuardianInput => ({ name: '', phone: '', relation: 'father', isPrimary: false });
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Provisional wording (OD-045): the person reads and edits the text before opening WhatsApp; nothing is sent by the program. */
export const MESSAGE_KINDS = ['general', 'absence'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];
export const MESSAGE_KIND_AR: Record<MessageKind, string> = { general: 'رسالة عامة', absence: 'إبلاغ بالغياب' };
export function messageText(kind: MessageKind, o: { association: string; student: string; date?: string; group?: string }): string {
  if (kind === 'absence') return `السلام عليكم ورحمة الله وبركاته. نُعلمكم أن الطالب ${o.student} تغيّب عن ${o.group ? `حصة ${o.group}` : 'الحصة'} بتاريخ ${o.date ?? todayStr()}. نرجو الاطمئنان على حاله. ${o.association}`;
  return `السلام عليكم ورحمة الله وبركاته. نتواصل معكم من ${o.association} بخصوص الطالب ${o.student}. `;
}

/** Opens a chat in the person's own WhatsApp with a ready, editable text. The number is read by the program from the record; nothing is sent automatically. */
export function WhatsAppPanel({ studentId, studentName, association, kind = 'general', date, group, onClose }: { studentId: string; studentName: string; association: string; kind?: MessageKind; date?: string; group?: string; onClose: () => void }) {
  const [rows, setRows] = useState<GuardianRow[] | null>(null); const [pick, setPick] = useState(''); const [k, setK] = useState<MessageKind>(kind); const [text, setText] = useState(messageText(kind, { association, student: studentName, date, group }));
  const [banner, setBanner] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  useEffect(() => { call<{ rows: GuardianRow[] | null }>('guardians.list', { studentId }).then((r) => { const wa = (r.rows ?? []).filter((g) => g.whatsapp); setRows(wa); setPick(wa[0]?.linkId ?? ''); }); }, [studentId]);
  async function open() { setBusy(true); setBanner(null); const r = await call<Res>('guardians.whatsapp', { linkId: pick, text, kind: k }); setBusy(false); if (r.ok) setDone(true); else setBanner(ERR[r.error] ?? 'تعذّر فتح واتساب.'); }
  if (!rows) return null;
  return (
    <section className="inline-panel" aria-label="رسالة واتساب"><h3>رسالة إلى ولي أمر {studentName}</h3>
      {rows.length === 0 ? <p className="helper">لا يوجد ولي له رقم نقال صالح لواتساب. أضيفوا الولي ورقمه من تبويب «الأولياء». الأرقام الأرضية لا تعمل مع واتساب.</p> : (
        <>
          {banner && <div className="banner error" role="alert">{banner}</div>}
          {done && <div className="banner info" role="status">فُتحت المحادثة في واتساب. راجعوا النص ثم اضغطوا «إرسال» هناك. لم يُرسَل شيء من البرنامج.</div>}
          {rows.length > 1 && <div className="field"><label htmlFor="wg">إلى</label><select id="wg" value={pick} onChange={(e) => setPick(e.target.value)}>{rows.map((g) => <option key={g.linkId} value={g.linkId}>{g.name} — {RELATION_AR[g.relation]} — {prettyPhone(g.phone)}</option>)}</select></div>}
          <div className="seg" role="group" aria-label="نوع الرسالة">{MESSAGE_KINDS.map((m) => <button key={m} aria-pressed={k === m} onClick={() => { setK(m); setText(messageText(m, { association, student: studentName, date, group })); }}>{MESSAGE_KIND_AR[m]}</button>)}</div>
          <div className="field"><label htmlFor="wt">نص الرسالة (يمكنكم تعديله)</label><textarea id="wt" rows={4} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} /></div>
        </>
      )}
      <div className="row">{rows.length > 0 && <button className="btn primary" disabled={busy || !text.trim()} onClick={open}>فتح واتساب</button>}<button className="btn" onClick={onClose}>إغلاق</button></div>
    </section>
  );
}

/** The "Guardians" tab of a student's profile. */
export function StudentGuardians({ studentId, studentName, association, canEdit }: { studentId: string; studentName: string; association: string; canEdit: boolean }) {
  const [rows, setRows] = useState<GuardianRow[] | null | undefined>(undefined); const [editing, setEditing] = useState<{ row: GuardianRow | null; f: GuardianInput } | null>(null);
  const [touched, setTouched] = useState(false); const [banner, setBanner] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [wa, setWa] = useState(false); const [shown, setShown] = useState<{ name: string; code: string } | null>(null);
  const load = useCallback(async () => setRows((await call<{ rows: GuardianRow[] | null }>('guardians.list', { studentId })).rows), [studentId]);
  useEffect(() => { setRows(undefined); load(); }, [load]);
  if (rows === undefined) return null;
  if (rows === null) return <div className="banner error">لا تملكون صلاحية عرض أولياء هذا الطالب.</div>;
  const f = editing?.f; const issues = f ? Object.fromEntries(validateGuardian(f).map((i) => [i.field, GUARDIAN_ISSUE_AR[i.code]])) : {};
  async function save() {
    if (!editing) return; setTouched(true); if (Object.keys(issues).length) return; setBusy(true); setBanner(null);
    const r = editing.row ? await call<Res>('guardians.update', { linkId: editing.row.linkId, expectedVersion: editing.row.version, ...editing.f }) : await call<Res>('guardians.add', { studentId, ...editing.f }); setBusy(false);
    if (r.ok) { setEditing(null); setTouched(false); await load(); } else setBanner(ERR[r.error] ?? 'تعذّر الحفظ. أعيدوا المحاولة.');
  }
  async function remove(g: GuardianRow) { setBusy(true); const r = await call<Res>('guardians.remove', { linkId: g.linkId }); setBusy(false); if (r.ok) await load(); else setBanner(ERR[r.error] ?? 'تعذّرت الإزالة.'); }
  async function issue(g: GuardianRow) { setBusy(true); setBanner(null); const r = await call<{ ok: true; code: string } | { ok: false; error: string }>('guardians.codeIssue', { guardianId: g.guardianId }); setBusy(false); if (r.ok) { setShown({ name: g.name, code: r.code }); await load(); } else setBanner(ERR[r.error] ?? 'تعذّر إنشاء الرمز.'); }
  async function revokeCode(g: GuardianRow) { setBusy(true); const r = await call<{ ok: boolean }>('guardians.codeRevoke', { guardianId: g.guardianId }); setBusy(false); if (r.ok) { setShown(null); await load(); } else setBanner('تعذّر إلغاء الرمز.'); }
  const phoneOk = f ? normalizePhone(f.phone) : null;
  return (
    <div className="guardians">
      {banner && <div className="banner error" role="alert">{banner}</div>}
      {shown && <div className="banner info" role="status"><b>رمز تطبيق الأولياء لـ {shown.name}:</b> <span className="num" style={{ fontSize: '1.4em', letterSpacing: '.08em' }}>{shown.code}</span><br />اكتبوه على ورقة وسلّموه للولي الآن. <b>لن يظهر مرة أخرى</b>، وإن ضاع أنشئوا رمزاً جديداً (يُلغي القديم). يدخل الولي برقم هاتفه المسجَّل مع هذا الرمز، ويرى أبناءه فقط.<br /><button className="btn" onClick={() => setShown(null)}>تم، أخفِ الرمز</button></div>}
      {rows.length === 0 ? <div className="empty"><div className="niche" aria-hidden="true" /><h2>لا أولياء مسجَّلون</h2><p>{canEdit ? 'أضيفوا ولي الأمر ورقم هاتفه لتتمكنوا من مراسلته.' : 'لم يُسجَّل ولي لهذا الطالب بعد.'}</p></div> : (
        <div className="grid-wrap"><table className="grid" aria-label="أولياء الطالب"><thead><tr><th scope="col">الاسم</th><th scope="col">الصلة</th><th scope="col">الهاتف</th><th scope="col" />{canEdit && <th scope="col" />}</tr></thead>
          <tbody>{rows.map((g) => (
            <tr key={g.linkId}><td><b>{g.name}</b>{g.isPrimary && <span className="badge teal"><i aria-hidden="true" />الأساسي</span>}{g.siblings > 0 && <small className="helper"> · مرتبط بـ {g.siblings} طالب آخر</small>}</td><td>{RELATION_AR[g.relation]}</td>
              <td className="num">{prettyPhone(g.phone)}{!g.whatsapp && <small className="helper"> (أرضي)</small>}</td>
              <td>{g.whatsapp && <button className="btn" onClick={() => setWa(true)}>واتساب</button>}</td>
              {canEdit && <td><button className="btn quiet" disabled={busy} onClick={() => issue(g)}>{g.hasCode ? 'رمز جديد للتطبيق' : 'رمز للتطبيق'}</button>{g.hasCode && <button className="btn quiet" disabled={busy} onClick={() => revokeCode(g)}>إلغاء الرمز</button>}<button className="btn quiet" onClick={() => { setEditing({ row: g, f: { name: g.name, phone: g.phone, relation: g.relation, isPrimary: g.isPrimary } }); setTouched(false); setBanner(null); }}>تعديل</button><button className="btn quiet" disabled={busy} onClick={() => remove(g)}>إزالة</button></td>}</tr>))}</tbody></table></div>
      )}
      {canEdit && !editing && <p><button className="btn primary" onClick={() => { setEditing({ row: null, f: blank() }); setTouched(false); setBanner(null); }}>إضافة ولي</button></p>}
      {wa && <WhatsAppPanel studentId={studentId} studentName={studentName} association={association} onClose={() => setWa(false)} />}
      {editing && f && (
        <section className="inline-panel" aria-label="بيانات الولي"><h3>{editing.row ? 'تعديل الولي' : 'ولي جديد'}</h3>
          {editing.row && editing.row.siblings > 0 && <div className="banner info">هذا الولي مرتبط بطلاب آخرين: تعديل اسمه أو هاتفه يغيّره عندهم جميعاً.</div>}
          <div className="grid2">
            <div className="field"><label htmlFor="gn">اسم الولي</label><input id="gn" value={f.name} onChange={(e) => setEditing({ ...editing, f: { ...f, name: e.target.value } })} autoFocus />{touched && issues.name && <p className="field-error">{issues.name}</p>}</div>
            <div className="field"><label htmlFor="gp">رقم الهاتف</label><input id="gp" className="ltr" inputMode="tel" value={f.phone} onChange={(e) => setEditing({ ...editing, f: { ...f, phone: e.target.value } })} />
              {touched && issues.phone ? <p className="field-error">{issues.phone}</p> : phoneOk?.ok ? <p className="helper">{phoneOk.kind === 'landline' ? 'رقم أرضي: لا يعمل مع واتساب.' : <>سيُحفظ: <span className="num">{prettyPhone(phoneOk.display)}</span></>}</p> : <p className="helper">مثال: 0550 12 34 56 أو +213550123456</p>}</div>
          </div>
          <div className="grid2">
            <div className="field"><label htmlFor="gr">صلة القرابة</label><select id="gr" value={f.relation} onChange={(e) => setEditing({ ...editing, f: { ...f, relation: e.target.value as Relation } })}>{RELATIONS.map((r) => <option key={r} value={r}>{RELATION_AR[r]}</option>)}</select></div>
            <div className="field"><label htmlFor="gm">جهة الاتصال الأساسية</label><label className="check"><input id="gm" type="checkbox" checked={f.isPrimary} onChange={(e) => setEditing({ ...editing, f: { ...f, isPrimary: e.target.checked } })} /> هذا هو الولي الأساسي لهذا الطالب</label></div>
          </div>
          <div className="row"><button className="btn primary" disabled={busy} onClick={save}>حفظ</button><button className="btn" onClick={() => setEditing(null)}>إلغاء</button></div>
        </section>
      )}
    </div>
  );
}

// ---------------- import of guardians from Excel ----------------
interface Picked { ok: true; fileName: string; headers: string[]; rowCount: number; sample: string[][]; mapping: GuardianMapping }
interface Prev { ok: true; total: number; valid: number; withIssues: number; issueCounts: Record<string, number>; issueText: Record<string, string>; warningText: Record<string, string>; rows: { row: number; student: { name: string; studentNo: string } | null; guardianName: string; phone: string | null; issues: string[]; warnings: string[] }[] }
export function GuardianImport({ onBack }: { onBack: () => void }) {
  const [file, setFile] = useState<Picked | null>(null); const [mapping, setMapping] = useState<GuardianMapping>({}); const [prev, setPrev] = useState<Prev | null>(null); const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [done, setDone] = useState<{ linked: number; created: number; alreadyThere: number; skipped: number } | null>(null); const [skip, setSkip] = useState(false);
  async function pick() {
    setBusy(true); setMsg(null); setPrev(null); setDone(null); const r = await call<Picked | { ok: false; error: string; message?: string }>('guardians.pickFile', {}); setBusy(false);
    if (r.ok) { setFile(r); setMapping(r.mapping); } else if (r.error !== 'cancelled') setMsg(r.message ?? 'تعذّر قراءة الملف.');
  }
  async function preview(m = mapping) {
    setBusy(true); setMsg(null); const r = await call<Prev | { ok: false; error: string; problems?: string[] }>('guardians.preview', { mapping: m }); setBusy(false);
    if (r.ok) setPrev(r); else { setPrev(null); setMsg(r.problems?.join(' ') ?? 'تعذّرت المعاينة.'); }
  }
  async function commit() {
    setBusy(true); setMsg(null); const r = await call<{ ok: true; linked: number; created: number; alreadyThere: number; skipped: number } | { ok: false; error: string }>('guardians.commit', { mapping, skipInvalid: skip }); setBusy(false);
    if (r.ok) { setDone(r); setPrev(null); } else setMsg(r.error === 'invalid' ? 'في الملف صفوف بها مشاكل. صحّحوها أو فعّلوا «تجاهل الصفوف التي بها مشاكل».' : r.error === 'nothing_to_import' ? 'لا توجد صفوف صالحة للاستيراد.' : 'تعذّر الاستيراد. لم يتغير شيء.');
  }
  return (
    <div className="import">
      <button className="btn quiet back" onClick={onBack}>→ الطلاب</button>
      <h2>استيراد أولياء الأمور من Excel</h2>
      <p className="helper">يُربط كل صف بطالب موجود: برقم الطالب، وإلا بالاسم مع تاريخ الميلاد. ما لا يُطابق بدقة يُعرض لكم ولا يُخمَّن. إعادة استيراد الملف نفسه لا تُضيف شيئاً مكرراً.</p>
      {msg && <div className="banner error" role="alert">{msg}</div>}
      {done && <div className="banner info" role="status">تم الاستيراد: ربط <span className="num">{done.linked}</span> ولي، وأُنشئ <span className="num">{done.created}</span> سجل جديد، و<span className="num">{done.alreadyThere}</span> كانوا مرتبطين من قبل، وتُجوهل <span className="num">{done.skipped}</span> صف.</div>}
      <p><button className="btn primary" onClick={pick} disabled={busy}>{file ? 'اختيار ملف آخر' : 'اختيار ملف Excel'}</button></p>
      {file && !done && (
        <>
          <section className="inline-panel"><h3>الأعمدة ({file.fileName} — <span className="num">{file.rowCount}</span> صف)</h3>
            <div className="grid2">{GUARDIAN_FIELDS.map((f) => (
              <div className="field" key={f}><label htmlFor={'gf' + f}>{GUARDIAN_FIELD_AR[f]}</label>
                <select id={'gf' + f} value={mapping[f] ?? ''} onChange={(e) => { const m = { ...mapping }; if (e.target.value === '') delete m[f]; else m[f] = Number(e.target.value); setMapping(m); setPrev(null); }}><option value="">— بلا عمود —</option>{file.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}</select></div>))}</div>
            <div className="row"><button className="btn primary" disabled={busy} onClick={() => preview()}>معاينة</button></div>
          </section>
          {prev && (
            <section className="inline-panel"><h3>المعاينة: <span className="num">{prev.valid}</span> صالح من <span className="num">{prev.total}</span></h3>
              {Object.keys(prev.issueCounts).length > 0 && <ul>{Object.entries(prev.issueCounts).map(([k, n]) => <li key={k}>{prev.issueText[k] ?? k}: <span className="num">{n}</span></li>)}</ul>}
              <div className="grid-wrap"><table className="grid" aria-label="معاينة الأولياء"><thead><tr><th scope="col">الصف</th><th scope="col">الطالب</th><th scope="col">الولي</th><th scope="col">الهاتف</th><th scope="col">الملاحظات</th></tr></thead>
                <tbody>{prev.rows.map((r) => <tr key={r.row}><td className="num">{r.row}</td><td>{r.student ? `${r.student.name} (${r.student.studentNo})` : '—'}</td><td>{r.guardianName || '—'}</td><td className="num">{r.phone ? prettyPhone(r.phone) : '—'}</td>
                  <td>{[...r.issues.map((i) => prev.issueText[i] ?? i), ...r.warnings.map((w) => prev.warningText[w] ?? w)].join('، ')}</td></tr>)}</tbody></table></div>
              {prev.withIssues > 0 && <label className="check"><input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} /> تجاهل الصفوف التي بها مشاكل (<span className="num">{prev.withIssues}</span>) واستيراد الباقي</label>}
              <div className="row"><button className="btn primary" disabled={busy || prev.valid === 0 || (prev.withIssues > 0 && !skip)} onClick={commit}>استيراد الأولياء</button></div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
