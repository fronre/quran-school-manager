import { useEffect, useMemo, useState } from 'react';
import { validateSetup, MAX_BRANCHES, type SetupInput, type SetupIssue } from '@mishkat/domain';
import { api, ISSUE_TEXT, PASSWORD_TEXT, type UserView } from './api';

const STEPS = ['البداية', 'حساب الدخول', 'مفتاح الاسترداد', 'تأكيد المفتاح', 'الجمعية', 'الفروع', 'السنة الدراسية', 'النسخة الأولى'] as const;

const COMMIT_ERROR: Record<string, string> = {
  key_mismatch: 'المجموعتان المكتوبتان لا تطابقان المفتاح. راجعوا الورقة التي حفظتموها ثم أعيدوا الكتابة.',
  no_key: 'انتهت جلسة الإعداد. ارجعوا إلى خطوة مفتاح الاسترداد.',
  os_protection_unavailable: 'تعذّر حفظ المفتاح بحماية ويندوز على هذا الجهاز. لم يُحفظ شيء. أعيدوا المحاولة، وإن تكرّر فاتصلوا بالدعم.',
  username_taken: 'اسم المستخدم مستخدم. اختاروا غيره.',
  already_set_up: 'الجمعية مُعدّة من قبل.',
  failed: 'تعذّر إكمال الإعداد. لم يُحفظ شيء. أعيدوا المحاولة.',
};

/** Field prefixes that belong to each step, so errors only show where the user can fix them. */
/** Today on this PC as yyyy-mm-dd (local time, like the dates typed in the form). */
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dmy = (iso: string) => iso.split('-').reverse().join('/');
const STEP_FIELDS: Record<number, string[]> ={ 1: ['admin.'], 4: ['association.'], 5: ['branches'], 6: ['year.'] };

function Field({ id, label, helper, error, children }: { id: string; label: string; helper?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {helper && !error && <p className="helper">{helper}</p>}
      {error && <p className="field-error" id={`${id}-err`} role="alert">{error}</p>}
    </div>
  );
}

const RESTORE_ERROR: Record<string, string> = {
  cancelled: 'لم يُختر ملف.',
  unreadable: 'تعذّرت قراءة الملف. تأكدوا أن الفلاشة أو القرص ما زال موصولاً ثم أعيدوا المحاولة.',
  bad_format: 'هذا الملف ليس نسخة احتياطية من الشهاب، أو أنه تالف. اختاروا ملفاً ينتهي بـ ‎.mshkbk‎.',
  newer_schema: 'هذه النسخة صُنعت بإصدار أحدث من البرنامج. ثبّتوا الإصدار نفسه أو أحدث على هذا الحاسوب ثم أعيدوا المحاولة.',
  no_file: 'لم يعد الملف موجوداً في مكانه. اختاروه مرة أخرى.',
  bad_key: 'المفتاح غير صحيح الكتابة: تأكدوا من كتابة الأحرف الستة والخمسين كما في الورقة.',
  wrong_key_or_tampered: 'هذا المفتاح لا يفتح هذه النسخة. تأكدوا أنها ورقة مفتاح هذه الجمعية، وأن الملف لم يتلف.',
  wrong_tenant: 'النسخة لا تطابق بياناتها الداخلية. لم يُغيَّر شيء.',
  integrity_failed: 'النسخة تالفة من الداخل ولا يمكن استعمالها. جرّبوا نسخة أخرى (أقدم قليلاً).',
  audit_chain_broken: 'سجل العمليات داخل النسخة غير سليم، لذلك رُفضت. جرّبوا نسخة أخرى.',
  os_protection_unavailable: 'تعذّر حفظ المفتاح بحماية ويندوز على هذا الحاسوب. لم يُغيَّر شيء. أعيدوا المحاولة.',
  already_set_up: 'هذا الحاسوب فيه جمعية مُعدّة من قبل. لا يمكن الكتابة فوق بياناتها من هنا.',
  restore_interrupted: 'توقفت العملية في منتصفها. سيُعاد تشغيل البرنامج؛ أعيدوا المحاولة بعده.',
  failed: 'تعذّرت الاستعادة. لم يُغيَّر شيء. أعيدوا المحاولة.',
};

/** Moving the association to another computer: backup file + paper recovery key -> the same data, users and passwords as before. */
function RestorePanel({ onBack }: { onBack: () => void }) {
  const [file, setFile] = useState<{ name: string; createdAt: string; sizeBytes: number } | null>(null);
  const [key, setKey] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null); const [firstOk, setFirstOk] = useState(true);
  async function pick() {
    setError(null); const r = await api.restorePick();
    if (r.ok) setFile({ name: r.name, createdAt: r.createdAt, sizeBytes: r.sizeBytes }); else if (r.error !== 'cancelled') setError(RESTORE_ERROR[r.error] ?? RESTORE_ERROR.failed!);
  }
  async function go() {
    setBusy(true); setError(null); const r = await api.restoreCommit(key); setBusy(false);
    if (r.ok) { setFirstOk(r.firstBackup !== false); setDone(r.backupCreatedAt ?? ''); return; }
    if (r.error === 'locked') { setError(`محاولات خاطئة كثيرة. انتظروا ${Math.ceil((r.retryAfterSeconds ?? 900) / 60)} دقيقة ثم أعيدوا المحاولة.`); return; }
    setError(RESTORE_ERROR[r.error ?? 'failed'] ?? RESTORE_ERROR.failed!);
  }
  const when = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleString('ar-DZ-u-nu-latn', { dateStyle: 'long', timeStyle: 'short' }); };
  return (
    <div className="wizard">
      <aside className="wiz-side">
        <div className="brand-name">نقل الجمعية</div>
        <ol className="steps" aria-label="خطوات النقل">
          {['ملف النسخة', 'مفتاح الاسترداد', 'تم'].map((s, n) => { const at = done !== null ? 2 : file ? 1 : 0; return <li key={s} aria-current={n === at ? 'step' : undefined} className={n < at ? 'done' : ''}><span className="num">{n + 1}</span>{s}</li>; })}
        </ol>
      </aside>
      <main className="wiz-main">
        {done !== null ? (<section>
          <h1>نُقلت بيانات الجمعية</h1>
          <div className="banner info">رجعت البيانات كما كانت في النسخة{done ? ` المأخوذة يوم ${when(done)}` : ''}. سيُعاد تشغيل البرنامج الآن، فادخلوا بنفس اسم المستخدم وكلمة المرور التي كنتم تستعملونها في الحاسوب القديم.</div>
          <div className="banner warn"><b>من الآن اعملوا على هذا الحاسوب وحده.</b> لا تُدخلوا بيانات جديدة في الحاسوب القديم، وإلا صار عندكم نسختان مختلفتان من الجمعية.</div>
          {!firstOk && <div className="banner error">تعذّر إنشاء أول نسخة احتياطية على هذا الحاسوب. بعد الدخول افتحوا «النسخ الاحتياطي» واختاروا المجلد ثم «نسخ احتياطي الآن».</div>}
          <p className="helper">جارٍ إعادة التشغيل…</p>
        </section>) : (<section>
          <h1>نقل البيانات من حاسوب آخر</h1>
          <p>تحتاجون إلى شيئين: <b>ملف نسخة احتياطية</b> من الحاسوب القديم (امتداده <bdi dir="ltr">mshkbk</bdi>)، على فلاشة أو في Google Drive)، و<b>ورقة مفتاح الاسترداد</b> التي حفظتموها عند الإعداد أول مرة.</p>
          <div className="banner info">خذوا من الحاسوب القديم <b>أحدث نسخة</b>: من شاشة «النسخ الاحتياطي» اضغطوا «نسخ احتياطي الآن» ثم انسخوا الملف إلى فلاشة. ما أُدخل بعد تلك النسخة لن ينتقل.</div>
          <div className="folder-box">
            <div><div className="helper">ملف النسخة</div>
              {file ? <div><b className="ltr">{file.name}</b><div className="helper">حسب الملف: أُنشئت يوم {when(file.createdAt)} — {(file.sizeBytes / 1048576).toFixed(1)} ميغابايت</div></div> : <div className="helper">لم يُختر بعد</div>}
            </div>
            <button className="btn" onClick={pick} disabled={busy}>{file ? 'اختيار ملف آخر' : 'اختيار ملف النسخة'}</button>
          </div>
          {file && (<div className="field">
            <label htmlFor="rk">مفتاح الاسترداد (من الورقة)</label>
            <textarea id="rk" className="ltr num" style={{ width: '100%', boxSizing: 'border-box', fontSize: 18, letterSpacing: 1 }} rows={2} dir="ltr" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder="XXXX-XXXX-XXXX-…" />
            <p className="helper">اكتبوه كاملاً. الشَّرطات والمسافات لا تهم، ولا الأحرف الكبيرة أو الصغيرة.</p>
          </div>)}
          {error && <div className="banner error" role="alert">{error}</div>}
        </section>)}
        {done === null && <div className="wiz-actions">
          <button className="btn" onClick={onBack} disabled={busy}>رجوع</button>
          <span className="sp" />
          <button className="btn primary" onClick={go} disabled={busy || !file || key.replace(/[\s-]/g, '').length < 56}>{busy ? 'جارٍ التحقق والنقل…' : 'نقل البيانات'}</button>
        </div>}
      </main>
    </div>
  );
}

export function Wizard({ onDone }: { onDone: (u: UserView, backupOk: boolean) => void }) {
  const [mode, setMode] = useState<'new' | 'restore'>('new');
  const [step, setStep] = useState(0);
  const [keyDisplay, setKeyDisplay] = useState(''); const [defaultFolder, setDefaultFolder] = useState('');
  const [folder, setFolder] = useState<string | null>(null);
  const [admin] = useState({ givenName: 'مستخدم', familyName: 'البرنامج', username: 'admin', password: 'admin' }); // the standard account (the program replaces these values; OD-050)
  const [assoc, setAssoc] = useState({ name: 'جمعية علماء المسلمين في سيدي عون', address: '', contact: '' });
  const [branches, setBranches] = useState([{ name: 'فرع الرجال' }, { name: 'فرع النساء' }]);
  const [year, setYearRaw] = useState({ name: '', startDate: '', endDate: '' });
  const [yearOk, setYearOk] = useState(false); // explicit "yes, this year is right" when it does not contain today
  const setYear = (y: typeof year) => { if (y.startDate !== year.startDate || y.endDate !== year.endDate) setYearOk(false); setYearRaw(y); };
  const today = localToday();
  const yearMissesToday = !!(year.startDate && year.endDate && year.startDate <= year.endDate && (today < year.startDate || today > year.endDate));
  const [confirm, setConfirm] = useState({ first: '', last: '' });
  const [touched, setTouched] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.setupBegin().then((r) => { setKeyDisplay(r.keyDisplay); setDefaultFolder(r.defaultBackupFolder); }); }, []);

  const input: SetupInput = useMemo(() => ({ admin, association: assoc, branches, year }), [admin, assoc, branches, year]);
  const issues: SetupIssue[] = useMemo(() => validateSetup(input).filter((i) => i.field !== 'admin.password'), [input]);
  const stepIssues = (s: number) => issues.filter((i) => (STEP_FIELDS[s] ?? []).some((p) => i.field.startsWith(p)));
  const errOf = (field: string) => { const i = issues.find((x) => x.field === field); return touched[step] && i ? ISSUE_TEXT[i.code] : undefined; };
  const groups = keyDisplay.split('-');

  function canLeave(): boolean {
    if (step === 3) return confirm.first.trim().length > 0 && confirm.last.trim().length > 0;
    if (step === 6 && stepIssues(6).length === 0 && yearMissesToday && !yearOk) return false;
    if (STEP_FIELDS[step]) return stepIssues(step).length === 0;
    return true;
  }
  const next = () => { setTouched((t) => ({ ...t, [step]: true })); if (canLeave()) { setError(null); setStep((s) => s + 1); } };

  async function finish() {
    setBusy(true); setError(null);
    const r = await api.setupCommit(input, confirm);
    setBusy(false);
    if (r.ok) { onDone(r.user, r.backup.ok); return; }
    if (r.error === 'invalid') {
      const f = r.issues.map((i) => i.field);
      setStep(f.some((x) => x.startsWith('admin.')) ? 1 : f.some((x) => x.startsWith('association.')) ? 4 : f.some((x) => x.startsWith('branches')) ? 5 : 6);
      setTouched({ 1: true, 4: true, 5: true, 6: true }); setError('بعض البيانات تحتاج إلى تصحيح. راجعوا الحقول المعلَّمة.'); return;
    }
    if (r.error === 'key_mismatch') setStep(3);
    setError(COMMIT_ERROR[r.error] ?? COMMIT_ERROR.failed!);
  }

  if (mode === 'restore') return <RestorePanel onBack={() => setMode('new')} />;

  return (
    <div className="wizard">
      <aside className="wiz-side">
        <div className="brand-name">إعداد الجمعية</div>
        <ol className="steps" aria-label="خطوات الإعداد">
          {STEPS.map((s, n) => <li key={s} aria-current={n === step ? 'step' : undefined} className={n < step ? 'done' : ''}><span className="num">{n + 1}</span>{s}</li>)}
        </ol>
      </aside>
      <main className="wiz-main">
        {step === 0 && (<section>
          <h1>مرحباً بكم في الشهاب</h1>
          <p>سنجهّز الجمعية في سبع خطوات قصيرة: حساب الدخول، ومفتاح الاسترداد، وبيانات الجمعية والفروع والسنة الدراسية، ثم نسخة احتياطية أولى.</p>
          <p className="helper">يعمل البرنامج دون إنترنت. إن أغلقتم البرنامج قبل النهاية فسيبدأ الإعداد من جديد ولن يُحفظ شيء.</p>
          <div className="banner info"><b>هل كانت الجمعية تعمل بالشهاب على حاسوب آخر؟</b> لا تُعدّوها من جديد: انقلوا بياناتها بملف النسخة الاحتياطية وورقة مفتاح الاسترداد.
            <div style={{ marginTop: 8 }}><button className="btn" onClick={() => { setError(null); setMode('restore'); }}>نقل البيانات من حاسوب آخر</button></div>
          </div>
        </section>)}

        {step === 1 && (<section>
          <h1>حساب الدخول</h1>
          <p>يدخل الجميع إلى البرنامج بحساب واحد. في أول مرة يكون الحساب الجاهز:</p>
          <div className="default-account"><div><span>اسم المستخدم</span><b>admin</b></div><div><span>كلمة المرور</span><b>admin</b></div></div>
          <div className="banner info"><b>سيطلب منكم البرنامج اختيار كلمة مرور جديدة فور دخولكم لأول مرة</b>، ولا يمكنكم استعمال البرنامج قبل ذلك. اسم المستخدم يبقى admin.</div>
          <p className="helper">إن نسيتم كلمة المرور لاحقاً فمفتاح الاسترداد (في الخطوة التالية) يعيد لكم الدخول دون أن تتغير بياناتكم.</p>
        </section>)}

        {step === 2 && (<section>
          <h1>مفتاح الاسترداد</h1>
          <div className="banner warn"><b>هذا المفتاح لا يظهر مرة أخرى.</b> إن فقدتم الجهاز أو نسيتم كلمة المرور فهو الطريق الوحيد لاسترجاع بيانات الجمعية. لا يستطيع أي أحد، ولا حتى فريق الدعم، إعادة إنشائه.</div>
          <div className="key-sheet">
            <p className="key-title">الشهاب — مفتاح الاسترداد</p>
            <div className="key-grid num" aria-label="مفتاح الاسترداد">{groups.map((g, n) => <span key={n}>{g}</span>)}</div>
            <p className="helper">اكتبوه أو اطبعوه واحفظوه في مكان آمن بعيد عن الجهاز. لا تحفظوه في الجهاز نفسه.</p>
          </div>
          <button className="btn" onClick={() => window.print()}>طباعة المفتاح</button>
        </section>)}

        {step === 3 && (<section>
          <h1>تأكيد حفظ المفتاح</h1>
          <p>للتأكد أنكم حفظتموه، اكتبوا <b>أول مجموعة</b> و<b>آخر مجموعة</b> من المفتاح كما في الورقة.</p>
          <div className="grid2">
            <Field id="k1" label="أول مجموعة"><input id="k1" className="ltr num" maxLength={4} autoComplete="off" value={confirm.first} onChange={(e) => setConfirm({ ...confirm, first: e.target.value })} /></Field>
            <Field id="k2" label="آخر مجموعة"><input id="k2" className="ltr num" maxLength={4} autoComplete="off" value={confirm.last} onChange={(e) => setConfirm({ ...confirm, last: e.target.value })} /></Field>
          </div>
          <button className="btn" onClick={() => setStep(2)}>عرض المفتاح مرة أخرى</button>
          {error && <div className="banner error" role="alert">{error}</div>}
        </section>)}

        {step === 4 && (<section>
          <h1>بيانات الجمعية</h1>
          <Field id="an" label="اسم الجمعية" error={errOf('association.name')}><input id="an" value={assoc.name} onChange={(e) => setAssoc({ ...assoc, name: e.target.value })} /></Field>
          <Field id="ad" label="العنوان (اختياري)" error={errOf('association.address')}><input id="ad" value={assoc.address} onChange={(e) => setAssoc({ ...assoc, address: e.target.value })} /></Field>
          <Field id="ac" label="وسيلة الاتصال (اختياري)" helper="هاتف أو بريد يظهر في المطبوعات." error={errOf('association.contact')}><input id="ac" value={assoc.contact} onChange={(e) => setAssoc({ ...assoc, contact: e.target.value })} /></Field>
          <p className="helper">الشعار يُضاف لاحقاً بعد اعتماد الهوية.</p>
        </section>)}

        {step === 5 && (<section>
          <h1>الفروع</h1>
          <p>سمّوا كل فرع. يمكنكم إضافة فرع أو حذفه، وفرع واحد يكفي.</p>
          {branches.map((b, n) => (
            <div className="branch-row" key={n}>
              <Field id={`b${n}`} label={`الفرع ${n + 1}`} error={errOf(`branches.${n}.name`)}><input id={`b${n}`} value={b.name} onChange={(e) => setBranches(branches.map((x, i) => (i === n ? { name: e.target.value } : x)))} /></Field>
              <button className="btn" disabled={branches.length === 1} onClick={() => setBranches(branches.filter((_, i) => i !== n))}>حذف</button>
            </div>
          ))}
          {touched[5] && issues.find((i) => i.field === 'branches') && <p className="field-error" role="alert">{ISSUE_TEXT[issues.find((i) => i.field === 'branches')!.code]}</p>}
          <button className="btn" disabled={branches.length >= MAX_BRANCHES} onClick={() => setBranches([...branches, { name: '' }])}>إضافة فرع</button>
        </section>)}

        {step === 6 && (<section>
          <h1>السنة الدراسية</h1>
          <Field id="yn" label="اسم السنة" helper="مثال: 2026-2027" error={errOf('year.name')}><input id="yn" className="ltr num" value={year.name} onChange={(e) => setYear({ ...year, name: e.target.value })} /></Field>
          <div className="grid2">
            <Field id="ys" label="تاريخ البداية" error={errOf('year.startDate')}><input id="ys" type="date" className="ltr" value={year.startDate} onChange={(e) => setYear({ ...year, startDate: e.target.value })} /></Field>
            <Field id="ye" label="تاريخ النهاية" error={errOf('year.endDate')}><input id="ye" type="date" className="ltr" value={year.endDate} onChange={(e) => setYear({ ...year, endDate: e.target.value })} /></Field>
          </div>
          {yearMissesToday && (
            <div className="banner warn year-warn" role="alert">
              <b>تاريخ اليوم (<span className="num">{dmy(today)}</span>) ليس داخل هذه السنة الدراسية</b> (من <span className="num">{dmy(year.startDate)}</span> إلى <span className="num">{dmy(year.endDate)}</span>).
              بهذه التواريخ <b>لا يمكن تسجيل حضور اليوم</b>، ولا تُعدَّل تواريخ السنة بعد الإعداد. راجعوا البداية والنهاية.
              <label className="year-ok"><input type="checkbox" checked={yearOk} onChange={(e) => setYearOk(e.target.checked)} /> التواريخ صحيحة وأريد المتابعة بها</label>
            </div>
          )}
          <p className="helper">العطل والإجازات تُضاف لاحقاً من الإعدادات.</p>
        </section>)}

        {step === 7 && (<section>
          <h1>النسخة الاحتياطية الأولى</h1>
          <p>سننشئ الآن نسخة مشفّرة ونتحقق من سلامتها. لا تُفتح إلا بمفتاح الاسترداد.</p>
          <div className="folder-box">
            <div><div className="helper">المجلد</div><div className="num path">{folder ?? defaultFolder}</div></div>
            <button className="btn" onClick={async () => setFolder((await api.pickBackupFolder()).folder)}>اختيار مجلد آخر</button>
          </div>
          <div className="banner info">يُنصح بنسخة ثانية في مكان آخر، كقرص خارجي، لحمايتكم من تلف القرص أو الفيروسات.</div>
          {error && <div className="banner error" role="alert">{error}</div>}
        </section>)}

        <div className="wiz-actions">
          {step > 0 && <button className="btn" onClick={() => { setError(null); setStep(step - 1); }} disabled={busy}>رجوع</button>}
          <span className="sp" />
          {step < STEPS.length - 1 && <button className="btn primary" onClick={next} disabled={step === 3 ? !canLeave() : false}>{step === 0 ? 'ابدؤوا' : 'التالي'}</button>}
          {step === STEPS.length - 1 && <button className="btn primary" onClick={finish} disabled={busy}>{busy ? 'جارٍ الإعداد…' : 'إنهاء الإعداد'}</button>}
        </div>
      </main>
    </div>
  );
}
