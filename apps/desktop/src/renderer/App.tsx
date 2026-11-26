import { useEffect, useState, type FormEvent } from 'react';
import { api, shortBranch, PASSWORD_TEXT, ROLE_LABEL, type AppInfo, type UserView } from './api';
import { Wizard } from './Wizard';
import { Students } from './Students';
import { ImportScreen } from './ImportScreen';
import { Home } from './Home';
import { Finance } from './Finance';
import { Groups } from './Groups';
import { Attendance } from './Attendance';
import { Reports } from './Reports';
import { GuardianImport } from './Guardians';
import { UpdateImport } from './UpdateImport';
import { Memorization } from './Memorization';
import { Staff } from './Staff';
import { Backups } from './Backups';
import { SettingsScreen } from './SettingsScreen';
import { Accounts } from './Accounts';

/** Logo mark (docs/brand/mishkat-mark.svg). The flame is the only brass element. */
/** The association's own logo when one was added; otherwise the MISHKAT mark. */
function Emblem({ logo, size, reversed }: { logo?: string | null; size: number; reversed?: boolean }) {
  return logo ? <img className="emblem" src={logo} width={size} height={size} alt="شعار الجمعية" /> : <Mark size={size} reversed={reversed} />;
}
function Mark({ size = 40, reversed = false }: { size?: number; reversed?: boolean }) {
  const main = reversed ? '#F4F5F0' : '#064E3B';
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label="الشهاب">
      <path fill={main} fillRule="evenodd" d="M10 60V27C10 13.2 20 4 32 4s22 9.2 22 23v33zM19 60V29c0-8 5.5-15 13-15s13 7 13 15v31z" />
      <path fill={reversed ? '#C9A55B' : '#B48E43'} d="M32 24c3.6 4.4 5.6 7.4 5.6 10.6a5.6 5.6 0 0 1-11.2 0c0-3.2 2-6.2 5.6-10.6z" />
      <rect x="31" y="39" width="2" height="7" fill={main} />
      <path fill={main} d="M24.5 46h15c0 4.4-3.4 7.4-7.5 7.4s-7.5-3-7.5-7.4z" />
    </svg>
  );
}

const RESET_ERR: Record<string, string> = {
  bad_key: 'مفتاح الاسترداد غير صحيح. تأكدوا من الورقة التي طبعتموها في الإعداد الأول، وأن كل المجموعات مكتوبة.', weak: 'كلمة المرور الجديدة غير مقبولة.', no_account: 'لا يوجد حساب في هذا البرنامج.',
  locked: 'تكرّرت المحاولات بمفتاح خاطئ. انتظروا 15 دقيقة ثم أعيدوا المحاولة.', mismatch: 'كلمتا المرور غير متطابقتين.',
};
/** Forgotten password: the recovery key from the paper printed at setup proves ownership. No e-mail, no internet. */
function ResetPassword({ onBack, onDone }: { onBack: () => void; onDone: (username: string) => void }) {
  const [key, setKey] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null); if (pw !== pw2) { setErr(RESET_ERR.mismatch!); return; }
    setBusy(true); const r = await window.mishkat.invoke('auth.resetPassword', { recoveryKey: key, newPassword: pw }) as { ok: true; username: string } | { ok: false; error: string; problems?: string[]; retryAfterSeconds?: number }; setBusy(false);
    if (r.ok) { setKey(''); setPw(''); setPw2(''); onDone(r.username); return; }
    setErr(r.error === 'weak' && r.problems?.[0] ? (PASSWORD_TEXT[r.problems[0]] ?? RESET_ERR.weak!) : RESET_ERR[r.error] ?? 'تعذّر الإجراء. أعيدوا المحاولة.');
  }
  return (
    <form className="login-form" onSubmit={submit} noValidate>
      <h2>نسيتُ كلمة المرور</h2>
      <p className="helper">اكتبوا <b>مفتاح الاسترداد</b> من الورقة التي طُبعت في الإعداد الأول، ثم اختاروا كلمة مرور جديدة. لا تتغير بياناتكم.</p>
      {err && <div className="banner error" role="alert">{err}</div>}
      <div><label htmlFor="rk">مفتاح الاسترداد</label><textarea id="rk" className="ltr num" rows={3} autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} autoFocus /></div>
      <div><label htmlFor="np">كلمة المرور الجديدة</label><input id="np" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /><p className="helper">10 أحرف على الأقل، وليست اسم المستخدم.</p></div>
      <div><label htmlFor="np2">أعيدوا كتابتها</label><input id="np2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
      <button className="btn primary" type="submit" disabled={busy || !key.trim() || !pw || !pw2}>تغيير كلمة المرور</button>
      <p><button type="button" className="btn quiet" onClick={onBack}>← العودة إلى تسجيل الدخول</button></p>
    </form>
  );
}

/** The standard account (admin / admin) must choose its own password before anything else (OD-050). */
function ForceChange({ user, onDone, onLogout }: { user: UserView; onDone: () => void; onLogout: () => void }) {
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null); if (pw !== pw2) { setErr('كلمتا المرور غير متطابقتين.'); return; }
    setBusy(true); const r = await window.mishkat.invoke('account.setFirstPassword', { newPassword: pw }) as { ok: true } | { ok: false; error: string }; setBusy(false);
    if (r.ok) { onDone(); return; } setErr(r.error === 'weak' ? 'كلمة المرور غير مقبولة: استخدموا 10 أحرف على الأقل (عبارة من عدة كلمات أفضل)، ولا تكن اسم المستخدم أو admin.' : 'تعذّر تغيير كلمة المرور. أعيدوا المحاولة.');
  }
  return (
    <div className="login">
      <section className="login-brand"><Emblem logo={user.logo} size={96} reversed /><h1>الشهاب</h1>{user.associationName !== 'الشهاب' && <p>{user.associationName}</p>}<p>خطوة أخيرة قبل البدء: اختاروا كلمة مرور خاصة بكم.</p></section>
      <section>
        <form className="login-form" onSubmit={submit} noValidate>
          <h2>اختيار كلمة مرور جديدة</h2>
          <p className="helper">دخلتم بكلمة مرور مؤقتة. اختاروا الآن كلمة مرور خاصة بكم لا يعرفها غيركم، ثم احفظوها. اسم المستخدم يبقى <b className="num">{user.username}</b>.</p>
          {err && <div className="banner error" role="alert">{err}</div>}
          <div><label htmlFor="fp">كلمة المرور الجديدة</label><input id="fp" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus /><p className="helper">10 أحرف على الأقل. عبارة من عدة كلمات أفضل من كلمة معقّدة قصيرة.</p></div>
          <div><label htmlFor="fp2">أعيدوا كتابتها</label><input id="fp2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
          <button className="btn primary" type="submit" disabled={busy || !pw || !pw2}>حفظ ومتابعة</button>
          <p><button type="button" className="btn quiet" onClick={onLogout}>خروج</button></p>
        </form>
      </section>
    </div>
  );
}

function Login({ info, onDone }: { info: AppInfo; onDone: (u: UserView) => void }) {
  const [username, setUsername] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [failed, setFailed] = useState(false); const [forgot, setForgot] = useState(false); const [doneUser, setDoneUser] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setFailed(false);
    const r = await api.login(username, password);
    setBusy(false);
    if (r.ok && r.user) { setPassword(''); onDone(r.user); } else setFailed(true);
  }
  return (
    <div className="login">
      <section className="login-brand">
        <Emblem logo={info.logo} size={96} reversed />
        <h1>الشهاب</h1>
        <p>إدارة الجمعية القرآنية: الطلاب والحلقات والحضور والحفظ، في مكان واحد.</p>
        <p>يعمل البرنامج دون إنترنت. بياناتكم محفوظة على هذا الجهاز.</p>
        <p className="dua">ادعوا لوالدي بالرحمة والمغفرة</p>
      </section>
      <section>
        {forgot ? <ResetPassword onBack={() => setForgot(false)} onDone={(u) => { setForgot(false); setDoneUser(u); setUsername(u); }} /> : (
        <form className="login-form" onSubmit={submit} noValidate>
          {!doneUser && info.defaultAccountHint && <div className="banner info" role="status">أول مرة؟ الحساب الجاهز: اسم المستخدم <b className="num">admin</b> وكلمة المرور <b className="num">admin</b>. سيُطلب منكم تغيير كلمة المرور فور الدخول.</div>}
          {doneUser && <div className="banner info" role="status">تم تغيير كلمة المرور. اسم المستخدم: <b className="num">{doneUser}</b>. ادخلوا بكلمة المرور الجديدة.</div>}
          <h2>تسجيل الدخول</h2>
          {failed && <div className="banner error" role="alert">اسم المستخدم أو كلمة المرور غير صحيحة، أو أن الحساب مقفل مؤقتاً. أعيدوا المحاولة بعد قليل.</div>}
          <div><label htmlFor="u">اسم المستخدم</label><input id="u" className="ltr" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus /></div>
          <div><label htmlFor="p">كلمة المرور</label><input id="p" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          <button className="btn primary" type="submit" disabled={busy || !username || !password}>دخول</button>
          <p><button type="button" className="btn quiet" onClick={() => { setForgot(true); setDoneUser(null); setFailed(false); }}>نسيتُ كلمة المرور</button></p>
          <p className="helper">نسخة <span className="num">{info.version}</span></p>
        </form>)}
      </section>
    </div>
  );
}

const NAV: string[] = [];

function BackupStatus({ canBackup, refreshKey }: { canBackup: boolean; refreshKey: number }) {
  const [last, setLast] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false); const [failed, setFailed] = useState(false); const [tick, setTick] = useState(0);
  useEffect(() => { api.homeSummary().then((r) => setLast(r.lastBackupAt)); }, [refreshKey, tick]);
  async function now() { setBusy(true); setFailed(false); const r = await api.backupNow(); setBusy(false); if (r.ok) setTick((t) => t + 1); else setFailed(true); }
  if (last === undefined) return null;
  // Numeric, 24-hour, Latin digits: stays correct inside an isolated LTR span (DESIGN_SYSTEM section 8).
  const when = last ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(last)) : null;
  return (
    <span className="status">
      {when ? <span className="chip-ok">نسخة احتياطية موثّقة: <span className="num">{when}</span></span> : <span className="chip-warn">لا توجد نسخة احتياطية موثّقة بعد</span>}
      {canBackup && <button className="btn" onClick={now} disabled={busy}>{busy ? 'جارٍ النسخ…' : 'نسخ احتياطي الآن'}</button>}
      {failed && <span className="chip-warn" role="alert">تعذّر إنشاء النسخة. تأكدوا أن المجلد متاح، وبياناتكم الحالية سليمة.</span>}
    </span>
  );
}

function Shell({ user, onLogout, onRefreshUser, backupOk = true }: { user: UserView; onLogout: () => void; onRefreshUser: () => void; backupOk?: boolean }) {
  const today = new Intl.DateTimeFormat('ar-DZ-u-nu-latn', { dateStyle: 'full' }).format(new Date());
  const [page, setPage] = useState<'home' | 'students' | 'import' | 'gimport' | 'uimport' | 'finance' | 'staff' | 'groups' | 'attendance' | 'reports' | 'memo' | 'backups' | 'accounts' | 'settings'>('home');
  const [startNew, setStartNew] = useState(false);
  const [groupDraft, setGroupDraft] = useState<{ id: string; name: string; branchId: string } | null>(null);
  const [scope, setScope] = useState('');
  const canSeeStudents = user.permissions.includes('student.view');
  return (
    <div className="app">
      <aside className="side">
        <div className="brand"><Emblem logo={user.logo} size={44} reversed /><div><div className="brand-name">الشهاب</div>{user.associationName !== 'الشهاب' && <div className="brand-assoc">{user.associationName}</div>}</div></div>
        <div className="scope">
          {user.yearName && <div className="scope-label">العام الدراسي <span className="num">{user.yearName}</span></div>}
          {user.branches.length > 1 ? (
            <div className="scope-switch" role="group" aria-label="الفرع المعروض">
              <button aria-pressed={scope === ''} onClick={() => setScope('')}>الفرعان</button>
              {user.branches.map((b) => <button key={b.id} aria-pressed={scope === b.id} onClick={() => setScope(b.id)}>{shortBranch(b.name)}</button>)}
            </div>
          ) : <div className="chip-row">{user.branches.map((b) => <span className="chip" key={b.id}>{b.name}</span>)}</div>}
        </div>
        <nav className="nav" aria-label="التنقل الرئيسي">
          <a href="#home" aria-current={page === 'home' ? 'page' : undefined} onClick={(e) => { e.preventDefault(); setPage('home'); }}>الرئيسية</a>
          {canSeeStudents && <a href="#students" aria-current={page === 'students' || page === 'import' || page === 'gimport' || page === 'uimport' ? 'page' : undefined} onClick={(e) => { e.preventDefault(); setPage('students'); }}>الطلاب</a>}
          {user.permissions.includes('staff.view') && <a href="#staff" aria-current={page === 'staff' ? 'page' : undefined} onClick={(e) => { e.preventDefault(); setPage('staff'); }}>المعلمون</a>}
          {(user.permissions.includes('group.view') || user.permissions.includes('enrollment.manage')) && <a href="#groups" aria-current={page === 'groups' ? 'page' : undefined} onClick={(e) => { e.preventDefault(); setPage('groups'); }}>الأفواج</a>}
          {user.permissions.includes('attendance.view') && <a href="#attendance" aria-current={page === 'attendance' ? 'page' : undefined} onClick={(e) => { e.preventDefault(); setPage('attendance'); }}>الحضور</a>}
          {user.permissions.includes('memorization.view') && <a href="#memo" aria-current={page === 'memo' ? 'page' : undefined} onClick={(e) => { e.preventDefault(); setPage('memo'); }}>الحفظ والتقييم</a>}
          {user.permissions.includes('finance.manage') && <a href="#finance" aria-current={page === 'finance' ? 'page' : undefined} onClick={(e) => { e.preventDefault(); setPage('finance'); }}>المال</a>}
          {NAV.map((n) => <span key={n} aria-disabled="true">{n}<small>قريباً</small></span>)}
          {(user.permissions.includes('report.view') || user.permissions.includes('report.view_limited')) && <a href="#reports" aria-current={page === 'reports' ? 'page' : undefined} onClick={(e) => { e.preventDefault(); setPage('reports'); }}>التقارير</a>}
          {user.permissions.includes('backup.manage') && <a href="#backups" aria-current={page === 'backups' ? 'page' : undefined} onClick={(e) => { e.preventDefault(); setPage('backups'); }}>النسخ الاحتياطي</a>}
          {user.permissions.includes('settings.manage') && <a href="#accounts" aria-current={page === 'accounts' ? 'page' : undefined} onClick={(e) => { e.preventDefault(); setPage('accounts'); }}>الحسابات</a>}
          {user.permissions.includes('settings.manage') && <a href="#settings" aria-current={page === 'settings' ? 'page' : undefined} onClick={(e) => { e.preventDefault(); setPage('settings'); }}>الإعدادات</a>}
        </nav>
        {user.permissions.includes('settings.manage')
          ? <button type="button" className="who who-link" title="إدارة الحسابات" onClick={() => setPage('accounts')}><b>{user.displayName}</b><span>{ROLE_LABEL[user.roles[0] ?? ''] ?? 'حساب الدخول'} · إدارة الحسابات ←</span></button>
          : <div className="who"><b>{user.displayName}</b><span>{ROLE_LABEL[user.roles[0] ?? ''] ?? 'حساب الدخول'}</span></div>}
      </aside>
      <div className="main">
        <header className="topbar">
          <h1>{page === 'home' ? 'الرئيسية' : page === 'students' ? 'الطلاب' : page === 'finance' ? 'المال' : page === 'staff' ? 'المعلمون' : page === 'groups' ? 'الأفواج' : page === 'attendance' ? 'الحضور' : page === 'reports' ? 'التقارير' : page === 'memo' ? 'الحفظ والتقييم' : page === 'backups' ? 'النسخ الاحتياطي' : page === 'settings' ? 'الإعدادات' : page === 'accounts' ? 'الحسابات' : 'استيراد الطلاب من Excel'}</h1><span className="sp" />
          <BackupStatus canBackup={user.roles.includes('director')} refreshKey={backupOk ? 0 : 1} />
          <span className="date">{today}</span>
          <button className="btn" onClick={onLogout}>تسجيل الخروج</button>
        </header>
        <main className="content page-in" key={page}>
          {page === 'settings' ? <SettingsScreen onRenamed={onRefreshUser} /> : page === 'accounts' ? <Accounts canAudit={user.permissions.includes('audit.view')} /> : page === 'backups' ? <Backups /> : page === 'staff' ? <Staff user={user} scope={scope} onNewGroup={(t) => { setGroupDraft(t); setPage('groups'); }} /> : page === 'groups' ? <Groups user={user} scope={scope} draft={groupDraft} onDraftUsed={() => setGroupDraft(null)} /> : page === 'attendance' ? <Attendance user={user} scope={scope} /> : page === 'reports' ? <Reports user={user} scope={scope} /> : page === 'memo' ? <Memorization user={user} scope={scope} /> : page === 'finance' ? <Finance user={user} scope={scope} /> : page === 'import' ? <ImportScreen user={user} scope={scope} onDone={() => setPage('students')} /> : page === 'gimport' ? <GuardianImport onBack={() => setPage('students')} /> : page === 'uimport' ? <UpdateImport onBack={() => setPage('students')} /> : page === 'students' ? <Students user={user} scope={scope} startNew={startNew} onStartedNew={() => setStartNew(false)} onImport={() => setPage('import')} onImportGuardians={() => setPage('gimport')} onUpdateImport={() => setPage('uimport')} /> : <Home user={user} scope={scope} go={(pg, add) => { if (add) setStartNew(true); setPage(pg); }} />}
        </main>
      </div>
    </div>
  );
}

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [user, setUser] = useState<UserView | null>(null);
  const [firstBackupOk, setFirstBackupOk] = useState(true);
  useEffect(() => { (async () => { setInfo(await api.info()); setUser((await api.current()).user); })(); }, []);
  useEffect(() => { if (!user) api.info().then(setInfo); }, [user]); // the login screen shows the current logo after sign-out
  useEffect(() => { const l = user?.logo ?? info?.logo ?? null; const r = document.documentElement; r.classList.toggle('has-logo', !!l); r.style.setProperty('--logo', l ? `url("${l}")` : 'none'); }, [user, info]); // prints pick it up via CSS
  if (!info) return null;
  if (info.setupNeeded && !user) return <Wizard onDone={(u, ok) => { setFirstBackupOk(ok); setUser(u); setInfo({ ...info, setupNeeded: false }); }} />;
  if (!user) return <Login info={info} onDone={setUser} />;
  if (user.mustChange) return <ForceChange user={user} onDone={async () => { const r = await api.current(); if (r.user) setUser(r.user); }} onLogout={async () => { await api.logout(); setUser(null); }} />;
  return <Shell user={user} backupOk={firstBackupOk} onRefreshUser={async () => { const r = await api.current(); if (r.user) setUser(r.user); }} onLogout={async () => { await api.logout(); setUser(null); }} />;
}
