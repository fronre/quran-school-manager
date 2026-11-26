import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ROLE_LABEL } from './api';

/** Named accounts and the activity log (OD-051). The Director adds one account per person; every action is then recorded under that person's name. */
interface AccountRow { id: string; username: string; givenName: string; familyName: string; name: string; role: string | null; branchId: string | null; branchName: string | null; status: 'active' | 'disabled'; lastLoginAt: string | null; mustChange: boolean; isMain: boolean }
interface ListData { accounts: AccountRow[]; branches: { id: string; name: string }[]; selfId: string }
interface Entry { seq: number; at: string; actorId: string; actorName: string; actorRole: string; action: string; entityType: string; branchName: string | null; reason: string | null }
type Fail = { ok: false; error: string };
const inv = <T,>(ch: string, p?: unknown) => window.mishkat.invoke(ch, p) as Promise<T>;

const ERR: Record<string, string> = {
  invalid: 'تأكدوا من الاسم، واسم المستخدم (3 إلى 30 حرفاً لاتينياً أو أرقاماً بلا مسافات)، والدور، والفرع.', username_taken: 'اسم المستخدم مستعمل. اختاروا غيره.', branch_not_found: 'الفرع غير موجود.',
  self: 'لا يمكنكم تنفيذ هذا على حسابكم أنتم.', main_account: 'هذا هو حساب المدير الرئيسي: لا يُوقَف ولا يتغير دوره، حتى لا يُقفل البرنامج على أصحابه.', forbidden: 'ليست لديكم صلاحية.', not_found: 'الحساب غير موجود.',
};
const ROLE_ORDER = ['director', 'branch_supervisor', 'registrar', 'academic_supervisor'];
const ROLE_HELP: Record<string, string> = {
  director: 'يرى الفرعين ويدير الحسابات والإعدادات والمال والنسخ الاحتياطي (أدمن).', branch_supervisor: 'يدير فرعه فقط: الطلاب والأفواج والحضور والحفظ والتقارير.',
  registrar: 'يسجّل الطلاب والحضور في فرعه فقط.', academic_supervisor: 'يتابع الحفظ والحضور والتقارير في فرعه، ويسجّل الحفظ.',
};
const fmt = (iso: string | null) => iso ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) : '—';

/** Plain Arabic for what was done; unknown actions show their code so nothing is hidden. */
export const ACTION_AR: Record<string, string> = {
  'login.success': 'سجّل الدخول', 'login.failed': 'محاولة دخول فاشلة', 'login.blocked': 'محاولة دخول أثناء القفل', 'user.password.changed': 'غيّر كلمة المرور', 'user.password.reset_by_recovery_key': 'استعاد الدخول بمفتاح الاسترداد',
  'user.reauth.failed': 'تأكيد كلمة مرور فاشل', 'user.create': 'أنشأ حساباً', 'role.assign': 'عيّن دوراً', 'account.create': 'أضاف حساب شخص', 'account.disable': 'أوقف حساباً', 'account.enable': 'أعاد تفعيل حساب', 'account.role_change': 'غيّر دور حساب',
  'account.password_reset': 'أعاد تعيين كلمة مرور حساب', 'account.rename': 'عدّل اسم حساب', 'setup.complete': 'أنهى إعداد البرنامج', 'association.update': 'عدّل بيانات الجمعية', 'branch.create': 'أضاف فرعاً', 'branch.rename': 'غيّر اسم فرع',
  'settings.logo_set': 'غيّر الشعار', 'settings.logo_removed': 'أزال الشعار', 'settings.memo_scale': 'غيّر سلّم التقييم', 'backup.restore': 'استرجع نسخة احتياطية',
  'student.create': 'أضاف طالباً', 'student.update': 'عدّل بيانات طالب', 'student.archive': 'أرشف طالباً', 'student.unarchive': 'أعاد طالباً من الأرشيف', 'student.import': 'استورد طلاباً من Excel', 'student.import_update': 'حدّث طلاباً من Excel',
  'staff.create': 'أضاف معلماً', 'staff.update': 'عدّل بيانات معلم', 'staff.archive': 'أرشف معلماً', 'staff.unarchive': 'أعاد معلماً من الأرشيف', 'photo.set': 'أضاف صورة', 'photo.remove': 'أزال صورة',
  'group.create': 'أنشأ فوجاً', 'group.update': 'عدّل فوجاً', 'group.close': 'أغلق فوجاً', 'group.reopen': 'أعاد فتح فوج', 'group.teacher_add': 'أضاف معلماً إلى فوج', 'group.teacher_remove': 'أزال معلماً من فوج',
  'enrollment.create': 'سجّل طالباً في فوج', 'enrollment.transfer': 'نقل طالباً بين الأفواج', 'enrollment.end': 'أخرج طالباً من فوج', 'enrollment.carry_over': 'رحّل طلاباً للسنة الجديدة', 'year.close_and_open': 'أغلق السنة وفتح سنة جديدة',
  'attendance.record': 'سجّل الحضور', 'attendance.correct': 'صحّح حضوراً', 'session.cancel': 'ألغى حصة', 'memorization.record': 'سجّل حفظاً', 'memorization.void': 'ألغى تسجيل حفظ',
  'guardian.add': 'أضاف ولي أمر', 'guardian.update': 'عدّل ولي أمر', 'guardian.remove': 'أزال ولي أمر', 'guardian.import': 'استورد أولياء من Excel', 'message.whatsapp_opened': 'فتح رسالة واتساب',
  'payment.record': 'سجّل دفعة', 'payment.cancel': 'ألغى دفعة', 'fee.rate.set': 'حدّد قيمة الاشتراك', 'fee.month.free': 'جعل شهراً مجانياً', 'fee.month.billable': 'أعاد احتساب شهر',
  'finance.password.set': 'عيّن كلمة سر المال', 'finance.password.changed': 'غيّر كلمة سر المال', 'finance.password.reset': 'أعاد تعيين كلمة سر المال', 'finance.unlock': 'فتح قسم المال', 'finance.unlock.failed': 'محاولة فاشلة لفتح المال',
  'recovery_key.acknowledged': 'أكّد حفظ مفتاح الاسترداد',
};

export function Accounts({ canAudit }: { canAudit: boolean }) {
  const [tab, setTab] = useState<'accounts' | 'log'>('accounts');
  return (
    <div className="settings wide">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'accounts'} onClick={() => setTab('accounts')}>الحسابات</button>
        {canAudit && <button role="tab" aria-selected={tab === 'log'} onClick={() => setTab('log')}>سجل النشاط</button>}
      </div>
      {tab === 'accounts' ? <AccountList /> : <ActivityLog />}
    </div>
  );
}

function AccountList() {
  const [d, setD] = useState<ListData | null>(null); const [msg, setMsg] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [adding, setAdding] = useState(false); const [temp, setTemp] = useState<{ name: string; username: string; password: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const load = useCallback(async () => { setD(await inv<ListData>('accounts.list')); }, []);
  useEffect(() => { void load(); }, [load]);
  const fail = (e: string) => setMsg({ tone: 'error', text: ERR[e] ?? 'تعذّر تنفيذ الإجراء. أعيدوا المحاولة.' });
  async function setStatus(a: AccountRow, status: 'active' | 'disabled') {
    if (status === 'disabled' && !window.confirm(`إيقاف حساب «${a.name}»؟ لن يستطيع الدخول، وتبقى سجلاته القديمة. يمكنكم إعادة تفعيله لاحقاً.`)) return;
    setMsg(null); setTemp(null); const r = await inv<{ ok: true } | Fail>('accounts.setStatus', { id: a.id, status }); if (r.ok) { setMsg({ tone: 'info', text: status === 'disabled' ? 'تم إيقاف الحساب.' : 'تمت إعادة تفعيل الحساب.' }); await load(); } else fail(r.error);
  }
  async function reset(a: AccountRow) {
    if (!window.confirm(`إعادة تعيين كلمة مرور «${a.name}»؟ تُنشأ كلمة مؤقتة جديدة تُعطونها له، وسيختار كلمته الخاصة عند الدخول.`)) return;
    setMsg(null); const r = await inv<{ ok: true; temporaryPassword: string } | Fail>('accounts.resetPassword', { id: a.id });
    if (r.ok) { setTemp({ name: a.name, username: a.username, password: r.temporaryPassword }); await load(); } else fail(r.error);
  }
  if (!d) return null;
  return (
    <>
      {msg && <div className={`banner ${msg.tone === 'error' ? 'error' : 'info'}`} role="alert">{msg.text}</div>}
      {temp && <div className="banner temp-pw" role="status"><b>كلمة المرور المؤقتة لـ «{temp.name}» (اسم المستخدم <span className="num">{temp.username}</span>):</b> <span className="num pw-chip">{temp.password}</span>
        <p className="helper">تظهر مرة واحدة فقط. اكتبوها وسلّموها له شخصياً؛ سيُطلب منه اختيار كلمة مرور خاصة به عند أول دخول. <button className="btn quiet" onClick={() => setTemp(null)}>أخفِ</button></p></div>}
      <section className="step-box"><h2>الحسابات</h2>
        <p className="helper">لكل شخص حسابه الخاص، فيُسجَّل كل ما يفعله باسمه. المدير الرئيسي (أول حساب) لا يُوقَف ولا يتغير دوره.</p>
        <div className="grid-wrap"><table className="grid" aria-label="الحسابات"><thead><tr><th scope="col">الاسم</th><th scope="col">اسم المستخدم</th><th scope="col">الدور</th><th scope="col">الفرع</th><th scope="col">الحالة</th><th scope="col">آخر دخول</th><th scope="col" /></tr></thead>
          <tbody>{d.accounts.map((a) => {
            const me = a.id === d.selfId;
            return (
              <tr key={a.id} className={a.status === 'disabled' ? 'row-muted' : undefined}>
                <td><b>{a.name}</b>{a.isMain && <span className="tag"> الرئيسي</span>}{me && <span className="tag"> أنت</span>}</td>
                <td className="num ltr">{a.username}</td><td>{a.role ? ROLE_LABEL[a.role] ?? a.role : '—'}</td><td>{a.branchName ?? (a.role === 'director' ? 'الفرعان' : '—')}</td>
                <td>{a.status === 'disabled' ? <span className="chip-warn">موقوف</span> : a.mustChange ? <span className="chip-warn">لم يغيّر كلمته المؤقتة</span> : <span className="chip-ok">فعّال</span>}</td>
                <td className="num">{fmt(a.lastLoginAt)}</td>
                <td><div className="row-actions">
                  <button className="btn" onClick={() => setEditing(editing === a.id ? null : a.id)}>تعديل</button>
                  {!me && <button className="btn" onClick={() => reset(a)}>كلمة مؤقتة جديدة</button>}
                  {!me && !a.isMain && (a.status === 'active' ? <button className="btn" onClick={() => setStatus(a, 'disabled')}>إيقاف</button> : <button className="btn" onClick={() => setStatus(a, 'active')}>تفعيل</button>)}
                </div></td>
              </tr>);
          })}</tbody></table></div>
        {editing && <EditAccount key={editing} d={d} a={d.accounts.find((x) => x.id === editing)!} onDone={async (m) => { setEditing(null); if (m) setMsg({ tone: 'info', text: m }); await load(); }} onFail={fail} />}
      </section>
      {adding ? <AddAccount d={d} onCancel={() => setAdding(false)} onFail={fail} onCreated={async (t) => { setAdding(false); setTemp(t); setMsg(null); await load(); }} />
        : <p><button className="btn primary" onClick={() => { setAdding(true); setTemp(null); setMsg(null); }}>إضافة شخص</button></p>}
    </>
  );
}

function RoleFields({ d, role, setRole, branchId, setBranchId, lockRole }: { d: ListData; role: string; setRole: (v: string) => void; branchId: string; setBranchId: (v: string) => void; lockRole?: boolean }) {
  return (
    <>
      <div className="field"><label htmlFor="rl">الدور</label>
        <select id="rl" value={role} disabled={lockRole} onChange={(e) => setRole(e.target.value)}>{ROLE_ORDER.map((r) => <option key={r} value={r}>{r === 'director' ? 'أدمن (المدير)' : ROLE_LABEL[r]}</option>)}</select>
        <p className="helper">{ROLE_HELP[role]}</p></div>
      {role !== 'director' && <div className="field"><label htmlFor="rb">الفرع</label>
        <select id="rb" value={branchId} onChange={(e) => setBranchId(e.target.value)}><option value="">اختاروا الفرع</option>{d.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>}
    </>
  );
}

function AddAccount({ d, onCancel, onCreated, onFail }: { d: ListData; onCancel: () => void; onCreated: (t: { name: string; username: string; password: string }) => void; onFail: (e: string) => void }) {
  const [given, setGiven] = useState(''); const [family, setFamily] = useState(''); const [username, setUsername] = useState('');
  const [role, setRole] = useState('branch_supervisor'); const [branchId, setBranchId] = useState(''); const [busy, setBusy] = useState(false);
  const ready = given.trim() && family.trim() && /^[A-Za-z0-9._-]{3,30}$/.test(username.trim()) && (role === 'director' || branchId);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    const r = await inv<{ ok: true; username: string; temporaryPassword: string } | Fail>('accounts.create', { givenName: given, familyName: family, username: username.trim(), role, branchId: role === 'director' ? null : branchId });
    setBusy(false); if (r.ok) onCreated({ name: `${given.trim()} ${family.trim()}`, username: r.username, password: r.temporaryPassword }); else onFail(r.error);
  }
  return (
    <form className="step-box" onSubmit={submit} noValidate><h2>إضافة شخص</h2>
      <p className="helper">يُنشأ له حساب بكلمة مرور مؤقتة تظهر لكم مرة واحدة، ويختار كلمته الخاصة عند أول دخول.</p>
      <div className="grid2"><div className="field"><label htmlFor="ag">الاسم</label><input id="ag" value={given} onChange={(e) => setGiven(e.target.value)} autoFocus /></div>
        <div className="field"><label htmlFor="af">اللقب</label><input id="af" value={family} onChange={(e) => setFamily(e.target.value)} /></div></div>
      <div className="field"><label htmlFor="au">اسم المستخدم</label><input id="au" className="ltr" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} /><p className="helper">حروف لاتينية وأرقام بلا مسافات، مثل ahmed أو fatima.</p></div>
      <RoleFields d={d} role={role} setRole={setRole} branchId={branchId} setBranchId={setBranchId} />
      <p><button className="btn primary" type="submit" disabled={busy || !ready}>إنشاء الحساب</button> <button className="btn quiet" type="button" onClick={onCancel}>إلغاء</button></p>
    </form>
  );
}

function EditAccount({ d, a, onDone, onFail }: { d: ListData; a: AccountRow; onDone: (msg?: string) => void; onFail: (e: string) => void }) {
  const [given, setGiven] = useState(a.givenName); const [family, setFamily] = useState(a.familyName);
  const [role, setRole] = useState(a.role ?? 'branch_supervisor'); const [branchId, setBranchId] = useState(a.branchId ?? ''); const protectedRole = a.isMain || a.id === d.selfId;
  async function save() {
    if (given.trim() !== a.givenName || family.trim() !== a.familyName) { const r = await inv<{ ok: true } | Fail>('accounts.rename', { id: a.id, givenName: given, familyName: family }); if (!r.ok) { onFail(r.error); return; } }
    if (!protectedRole && (role !== a.role || (role !== 'director' && branchId !== (a.branchId ?? '')))) { const r = await inv<{ ok: true } | Fail>('accounts.setRole', { id: a.id, role, branchId: role === 'director' ? null : branchId }); if (!r.ok) { onFail(r.error); return; } }
    onDone('تم حفظ التعديل.');
  }
  return (
    <div className="inline-panel"><h3>تعديل «{a.name}»</h3>
      <div className="grid2"><div className="field"><label htmlFor="eg">الاسم</label><input id="eg" value={given} onChange={(e) => setGiven(e.target.value)} /></div>
        <div className="field"><label htmlFor="ef">اللقب</label><input id="ef" value={family} onChange={(e) => setFamily(e.target.value)} /></div></div>
      {protectedRole ? <p className="helper">{a.isMain ? 'دور المدير الرئيسي ثابت.' : 'لا يمكنكم تغيير دور حسابكم أنتم.'}</p> : <RoleFields d={d} role={role} setRole={setRole} branchId={branchId} setBranchId={setBranchId} />}
      <p><button className="btn primary" onClick={save} disabled={!given.trim() || !family.trim() || (!protectedRole && role !== 'director' && !branchId)}>حفظ</button> <button className="btn quiet" onClick={() => onDone()}>إغلاق</button></p>
    </div>
  );
}

function ActivityLog() {
  const [data, setData] = useState<{ entries: Entry[]; people: { id: string; name: string }[] } | null>(null); const [who, setWho] = useState(''); const [more, setMore] = useState(true); const [busy, setBusy] = useState(false);
  const load = useCallback(async (userId: string) => { const r = await inv<{ entries: Entry[]; people: { id: string; name: string }[] }>('audit.list', { userId: userId || undefined, limit: 100 }); setData(r); setMore(r.entries.length === 100); }, []);
  useEffect(() => { void load(who); }, [load, who]);
  async function older() {
    if (!data || !data.entries.length) return; setBusy(true);
    const r = await inv<{ entries: Entry[]; people: { id: string; name: string }[] }>('audit.list', { userId: who || undefined, limit: 100, beforeSeq: data.entries[data.entries.length - 1]!.seq });
    setData({ ...data, entries: [...data.entries, ...r.entries] }); setMore(r.entries.length === 100); setBusy(false);
  }
  if (!data) return null;
  return (
    <section className="step-box"><h2>سجل النشاط</h2>
      <p className="helper">من فعل ماذا ومتى، من الأحدث إلى الأقدم. لا يمكن تعديل هذا السجل ولا حذف شيء منه.</p>
      <div className="field" style={{ maxWidth: 320 }}><label htmlFor="lw">الشخص</label>
        <select id="lw" value={who} onChange={(e) => setWho(e.target.value)}><option value="">الكل</option>{data.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      {data.entries.length === 0 ? <p className="empty">لا يوجد نشاط مسجَّل بعد.</p> : (
        <div className="grid-wrap"><table className="grid" aria-label="سجل النشاط"><thead><tr><th scope="col">الوقت</th><th scope="col">الشخص</th><th scope="col">ما فعله</th><th scope="col">الفرع</th><th scope="col">ملاحظة</th></tr></thead>
          <tbody>{data.entries.map((e) => <tr key={e.seq}><td className="num">{fmt(e.at)}</td><td><b>{e.actorName}</b></td><td>{ACTION_AR[e.action] ?? e.action}</td><td>{e.branchName ?? '—'}</td><td>{e.reason ?? ''}</td></tr>)}</tbody></table></div>)}
      {more && <p><button className="btn" onClick={older} disabled={busy}>عرض الأقدم</button></p>}
    </section>
  );
}
