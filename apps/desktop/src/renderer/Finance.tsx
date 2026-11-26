import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, money, monthParts, studentsWord, type ArrearsRow, type FinanceSettings, type MonthLine, type MonthSummary, type PaymentRow, type PwResult, type Receipt, type Statement, type StudentRow, type UserView } from './api';

const today = () => new Date().toISOString().slice(0, 10);
const ERR: Record<string, string> = {
  already_paid: 'هذا الشهر مدفوع من قبل.', no_rate: 'لم يُحدَّد مبلغ هذا الشهر. حدّدوه من «الإعدادات».', month_not_billable: 'هذا الشهر غير محسوب (عطلة).', month_outside_year: 'الشهر خارج السنة الدراسية.',
  collector_required: 'اكتبوا اسم من قبض المبلغ.', bad_date: 'تاريخ الدفع غير صحيح.', not_found: 'لم يعد الطالب متاحاً. أعيدوا البحث.', forbidden: 'قسم المال مقفل أو غير مسموح لكم به. افتحوه بكلمة السر.',
  rate_in_use: 'لا يمكن تغيير مبلغ شهر دُفعت عنه وصولات. حدّدوا مبلغاً جديداً يبدأ من شهر لاحق.', month_has_payments: 'لا يمكن إعفاء شهر فيه دفعات. ألغوا الدفعات أولاً بسبب مكتوب.',
  reason_required: 'اكتبوا سبب الإلغاء.', already_cancelled: 'الوصل ملغى من قبل.', invalid: 'القيمة غير صحيحة.', no_active_year: 'لا توجد سنة دراسية نشطة.',
};
const PW_ERR = (r: Extract<PwResult, { ok: false }>): string => {
  if (r.error === 'weak') return 'كلمة السر قصيرة. استخدموا 6 أحرف على الأقل.';
  if (r.error === 'wrong') return r.retryAfterSeconds ? `كلمة السر غير صحيحة. انتظروا ${r.retryAfterSeconds} ثانية ثم أعيدوا المحاولة.` : 'كلمة السر غير صحيحة.';
  if (r.error === 'locked') return `تكرّرت المحاولات الخاطئة. انتظروا ${r.retryAfterSeconds ?? 30} ثانية ثم أعيدوا المحاولة.`;
  if (r.error === 'bad_key') return 'مفتاح الاسترداد غير صحيح. راجعوا الورقة التي حفظتموها.';
  if (r.error === 'already_set') return 'كلمة السر مُنشأة من قبل.';
  return 'تعذّر الإجراء.';
};

function Month({ m }: { m: string }) { const p = monthParts(m); return <span>{p.name} <span className="num">{p.year}</span></span>; }
const Dinar = ({ n }: { n: number }) => <span><span className="num">{money(n)}</span> دج</span>;

// ---------- gate ----------
function Gate({ status, onChange }: { status: { configured: boolean }; onChange: () => void }) {
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false); const [key, setKey] = useState('');
  async function go() {
    setErr(null);
    if (!status.configured && pw !== pw2) { setErr('كلمتا السر غير متطابقتين.'); return; }
    setBusy(true);
    const r = forgot ? await api.financeResetPassword(key, pw) : status.configured ? await api.financeUnlock(pw) : await api.financeSetPassword(pw);
    setBusy(false); if (r.ok) onChange(); else setErr(PW_ERR(r));
  }
  return (
    <div className="gate">
      <h2>{!status.configured ? 'إنشاء كلمة سر لقسم المال' : forgot ? 'إعادة تعيين كلمة سر المال' : 'قسم المال مقفل'}</h2>
      {!status.configured && <p>لا يرى هذا القسم إلا من يعرف كلمة السر. اخترو كلمة يعرفها من يقبض المال فقط. إن نسيتموها يمكن إعادة تعيينها بمفتاح الاسترداد.</p>}
      {status.configured && !forgot && <p>اكتبوا كلمة سر المال لفتح القسم. يُقفل تلقائياً بعد 10 دقائق دون استخدام.</p>}
      {forgot && <p>اكتبوا مفتاح الاسترداد الذي حفظتموه في الإعداد الأول، ثم كلمة السر الجديدة.</p>}
      {err && <div className="banner error" role="alert">{err}</div>}
      <form onSubmit={(e) => { e.preventDefault(); go(); }}>
        {forgot && <div className="field"><label htmlFor="rk">مفتاح الاسترداد</label><input id="rk" className="ltr num" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" /></div>}
        <div className="field"><label htmlFor="fp">{forgot ? 'كلمة السر الجديدة' : 'كلمة سر المال'}</label><input id="fp" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus autoComplete="off" /></div>
        {!status.configured && <div className="field"><label htmlFor="fp2">أعيدوا كتابتها</label><input id="fp2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="off" /></div>}
        <div className="row-actions">
          <button className="btn primary" type="submit" disabled={busy || !pw || (forgot && !key)}>{!status.configured ? 'إنشاء وفتح' : forgot ? 'إعادة التعيين' : 'فتح'}</button>
          {status.configured && <button type="button" className="btn quiet" onClick={() => { setForgot(!forgot); setErr(null); }}>{forgot ? 'رجوع' : 'نسيتُ كلمة السر'}</button>}
        </div>
      </form>
    </div>
  );
}

// ---------- receipt ----------
function ReceiptSheet({ r }: { r: Receipt }) {
  const copy = (who: string) => (
    <section className="receipt">
      <header><div className="rc-top"><h1>{r.association}</h1><span className="rc-no">وصل رقم <b className="num">{r.receiptNo}</b></span></div><p>وصل استلام رقم <b className="num">{r.receiptNo}</b> — السنة الدراسية <span className="num">{r.yearName}</span> — <i>{who}</i></p></header>
      <table><tbody>
        <tr><th>الطالب</th><td>{r.studentName} — <span className="num">{r.studentNo}</span> — {r.branchName}</td></tr>
        <tr><th>عن شهر</th><td><Month m={r.month} /></td></tr>
        <tr><th>المبلغ</th><td><Dinar n={r.amount} /></td></tr>
        <tr><th>تاريخ الدفع</th><td className="num">{r.paidOn}</td></tr>
        <tr><th>القابض</th><td>{r.collectorName}</td></tr>
      </tbody></table>
      <p className="sign">توقيع القابض: ______________________</p>
    </section>
  );
  return <div className="print-sheet" dir="rtl">{copy('نسخة ولي الأمر')}<hr className="cut" />{copy('نسخة الجمعية')}</div>;
}

// ---------- collect ----------
const STATUS_TEXT: Record<MonthLine['status'], string> = { paid: 'مدفوع', due: 'مستحق', upcoming: 'لم يحن بعد', free: 'غير محسوب', no_rate: 'بلا مبلغ' };
const STATUS_CLASS: Record<MonthLine['status'], string> = { paid: 'ok', due: 'bad', upcoming: 'neutral', free: 'neutral', no_rate: 'warn' };

function Collect({ initial, onPrint }: { initial: StudentRow | { id: string; givenName: string; familyName: string; studentNo: string } | null; onPrint: (r: Receipt) => void }) {
  const [search, setSearch] = useState(''); const [results, setResults] = useState<StudentRow[]>([]);
  const [pick, setPick] = useState<string | null>(initial?.id ?? null);
  const [st, setSt] = useState<Statement | null>(null);
  const [collector, setCollector] = useState(''); const [paidOn, setPaidOn] = useState(today());
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [done, setDone] = useState<string | null>(null);
  const q = useRef(0);

  useEffect(() => {
    const t = setTimeout(async () => { if (!search.trim()) { setResults([]); return; } const my = ++q.current; const r = await api.studentsList({ search, limit: 8, archived: 'all' }); if (my === q.current && 'rows' in r) setResults(r.rows); }, 200);
    return () => clearTimeout(t);
  }, [search]);
  const load = useCallback(async (id: string) => { const r = await api.financeStatement(id); setSt(r.statement); }, []);
  useEffect(() => { if (pick) load(pick); }, [pick, load]);

  async function record(l: MonthLine) {
    setErr(null); setDone(null); setBusy(true);
    const r = await api.financeRecord(st!.student.id, l.month, paidOn, collector);
    setBusy(false);
    if (!r.ok) { setErr(ERR[r.error] ?? 'تعذّر تسجيل الدفعة.'); return; }
    await load(st!.student.id);
    const rc = await api.financeReceipt(r.id); if (rc.receipt) { setDone(`سُجّلت الدفعة، وصل رقم ${r.receiptNo}`); onPrint(rc.receipt); }
  }

  return (
    <div className="collect">
      <div className="filters">
        <input className="search" type="search" placeholder="ابحثوا عن الطالب بالاسم أو الرقم" aria-label="بحث عن طالب" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus={!initial} />
        <label className="inline">القابض <input className="narrow" value={collector} onChange={(e) => setCollector(e.target.value)} placeholder="اسم من يقبض المال" aria-label="اسم القابض" /></label>
        <label className="inline">تاريخ الدفع <input type="date" className="ltr" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></label>
      </div>
      {results.length > 0 && !pick && <ul className="picklist">{results.map((r) => <li key={r.id}><button onClick={() => { setPick(r.id); setResults([]); setSearch(''); }}><b>{r.givenName} {r.familyName}</b><span className="num">{r.studentNo}</span><span>{r.branchName}</span></button></li>)}</ul>}
      {results.length > 0 && pick && <ul className="picklist">{results.map((r) => <li key={r.id}><button onClick={() => { setPick(r.id); setResults([]); setSearch(''); }}><b>{r.givenName} {r.familyName}</b><span className="num">{r.studentNo}</span><span>{r.branchName}</span></button></li>)}</ul>}
      {err && <div className="banner error" role="alert">{err}</div>}
      {done && <div className="banner info" role="status">{done}</div>}
      {!st ? <div className="empty small"><p>ابحثوا عن الطالب لعرض كشف الأشهر وتسجيل الدفع.</p></div> : (
        <div className="statement">
          <div className="st-head"><h2>{st.student.name}</h2><span className="helper"><span className="num">{st.student.no}</span> — {st.student.branchName} — السنة <span className="num">{st.year.name}</span></span><span className="sp" />
            <span className={`badge ${st.arrears.total || st.arrears.unpriced ? 'bad' : 'ok'}`}><i aria-hidden="true" />{st.arrears.months.length ? <>المتأخرات <Dinar n={st.arrears.total} /> (<span className="num">{st.arrears.months.length}</span> أشهر)</> : st.arrears.unpriced ? 'أشهر بلا مبلغ محدد' : 'لا متأخرات'}</span></div>
          <table className="grid"><thead><tr><th scope="col">الشهر</th><th scope="col">الحالة</th><th scope="col">المبلغ</th><th scope="col">الوصل</th><th scope="col" /></tr></thead>
            <tbody>{st.lines.map((l) => (
              <tr key={l.month}>
                <td><b><Month m={l.month} /></b></td><td><span className={`badge ${STATUS_CLASS[l.status]}`}><i aria-hidden="true" />{STATUS_TEXT[l.status]}</span></td>
                <td>{l.amount !== null ? <Dinar n={l.amount} /> : '—'}</td><td>{l.receiptNo ? <><span className="num">{l.receiptNo}</span> — <span className="num">{l.paidOn}</span></> : '—'}</td>
                <td>{(l.status === 'due' || l.status === 'upcoming') && <button className="btn" disabled={busy || !collector.trim()} title={!collector.trim() ? 'اكتبوا اسم القابض أولاً' : undefined} onClick={() => record(l)}>تسجيل دفعة</button>}</td>
              </tr>))}</tbody></table>
        </div>
      )}
    </div>
  );
}

// ---------- arrears ----------
function Arrears({ scope, onOpen }: { scope: string; onOpen: (r: ArrearsRow) => void }) {
  const [search, setSearch] = useState(''); const branchId = scope; const [page, setPage] = useState(0);
  const [data, setData] = useState<{ rows: ArrearsRow[]; total: number; totalAmount: number; unpricedMonths: number } | null>(null); const [note, setNote] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(async () => setData(await api.financeArrears({ search: search || undefined, branchId: branchId || undefined, limit: 50, offset: page * 50 })), 200); return () => clearTimeout(t); }, [search, branchId, page]);
  useEffect(() => setPage(0), [search, branchId]);
  async function exportXlsx() { const r = await api.financeExportArrears({ search: search || undefined, branchId: branchId || undefined }); if (r.ok) setNote(`تم حفظ الملف (${r.count} ${studentsWord(r.count ?? 0)})`); }
  return (
    <div>
      <div className="filters">
        <input className="search" type="search" placeholder="ابحثوا بالاسم أو الرقم" aria-label="بحث في المتأخرات" value={search} onChange={(e) => setSearch(e.target.value)} />
                <span className="sp" />
        {data && <span className="total-pill">المجموع <Dinar n={data.totalAmount} /> — <span className="num">{data.total}</span> {studentsWord(data.total)}</span>}
        <button className="btn" onClick={exportXlsx} disabled={!data || data.total === 0}>تصدير Excel</button>
      </div>
      {note && <div className="banner info">{note}</div>}
      {data && data.unpricedMonths > 0 && <div className="banner warn">توجد أشهر بلا مبلغ محدد (<span className="num">{data.unpricedMonths}</span>) لا تدخل في المجموع. حدّدوا المبلغ من «الإعدادات».</div>}
      {data && data.total === 0 ? <div className="empty small"><h2>لا متأخرات</h2><p>كل الطلاب مسدّدون حتى الشهر الحالي.</p></div> : (
        <div className="grid-wrap"><table className="grid" aria-label="المتأخرات"><thead><tr><th scope="col">الرقم</th><th scope="col">الاسم</th><th scope="col">الفرع</th><th scope="col">الأشهر</th><th scope="col">المبلغ المستحق</th></tr></thead>
          <tbody>{(data?.rows ?? []).map((r) => (
            <tr key={r.studentId} tabIndex={0} onClick={() => onOpen(r)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(r); }}>
              <td className="num">{r.studentNo}</td><td><b>{r.name}</b>{r.archived && <span className="badge neutral mini">مؤرشف</span>}</td><td>{r.branchName}</td>
              <td>{r.months.map((m, i) => <span key={m}>{i > 0 && ' ، '}<Month m={m} /></span>)}{r.unpriced > 0 && <span className="helper"> + أشهر بلا مبلغ</span>}</td><td><Dinar n={r.total} /></td>
            </tr>))}</tbody></table>
          <div className="grid-foot"><span>عرض <span className="num">{data && data.total ? page * 50 + 1 : 0}–{data ? Math.min((page + 1) * 50, data.total) : 0}</span> من <span className="num">{data?.total ?? 0}</span></span><span className="sp" />
            <button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>السابق</button><button className="btn" disabled={!data || (page + 1) * 50 >= data.total} onClick={() => setPage(page + 1)}>التالي</button></div></div>
      )}
    </div>
  );
}

// ---------- payments register ----------
function Register({ onPrint }: { onPrint: (r: Receipt) => void }) {
  const [search, setSearch] = useState(''); const [status, setStatus] = useState<'all' | 'live' | 'cancelled'>('all');
  const [data, setData] = useState<{ rows: PaymentRow[]; total: number } | null>(null); const [cancelId, setCancelId] = useState<string | null>(null); const [reason, setReason] = useState(''); const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => setData(await api.financePayments({ search: search || undefined, status, limit: 100 })), [search, status]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  async function cancel() { setErr(null); const r = await api.financeCancel(cancelId!, reason); if (r.ok) { setCancelId(null); setReason(''); load(); } else setErr(ERR[r.error] ?? 'تعذّر الإلغاء.'); }
  async function show(id: string) { const r = await api.financeReceipt(id); if (r.receipt) onPrint(r.receipt); }
  return (
    <div>
      <div className="filters">
        <input className="search" type="search" placeholder="ابحثوا بالاسم أو رقم الطالب أو رقم الوصل" aria-label="بحث في الدفعات" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="الحالة" value={status} onChange={(e) => setStatus(e.target.value as 'all' | 'live' | 'cancelled')}><option value="all">كل الوصولات</option><option value="live">السارية</option><option value="cancelled">الملغاة</option></select>
        <span className="sp" />{data && <span className="helper"><span className="num">{data.total}</span> وصلاً</span>}
      </div>
      {cancelId && <div className="confirm"><p><b>إلغاء الوصل لا يحذفه.</b> يبقى رقمه في السجل مع سبب الإلغاء، ويمكن إدخال دفعة صحيحة بعده.</p>{err && <div className="banner error" role="alert">{err}</div>}
        <div className="field"><label htmlFor="cr">سبب الإلغاء</label><input id="cr" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></div>
        <div className="row-actions"><button className="btn" onClick={() => { setCancelId(null); setErr(null); }}>رجوع</button><button className="btn danger" disabled={!reason.trim()} onClick={cancel}>إلغاء الوصل</button></div></div>}
      {data && data.total === 0 ? <div className="empty small"><p>لا توجد وصولات بعد.</p></div> : (
        <div className="grid-wrap"><table className="grid" aria-label="سجل الدفعات"><thead><tr><th scope="col">الوصل</th><th scope="col">الطالب</th><th scope="col">الشهر</th><th scope="col">المبلغ</th><th scope="col">التاريخ</th><th scope="col">القابض</th><th scope="col" /></tr></thead>
          <tbody>{(data?.rows ?? []).map((p) => (
            <tr key={p.id} className={p.cancelledAt ? 'row-cancelled' : ''}>
              <td className="num">{p.receiptNo}</td><td><b>{p.studentName}</b><div className="helper"><span className="num">{p.studentNo}</span> — {p.branchName}</div></td><td><Month m={p.month} /></td><td><Dinar n={p.amount} /></td>
              <td className="num">{p.paidOn}</td><td>{p.collectorName}{p.cancelledAt && <div className="helper">ملغى: {p.cancelReason}</div>}</td>
              <td><button className="btn" onClick={() => show(p.id)}>الوصل</button>{!p.cancelledAt && <button className="btn quiet" onClick={() => { setCancelId(p.id); setReason(''); }}>إلغاء</button>}</td>
            </tr>))}</tbody></table></div>
      )}
    </div>
  );
}

// ---------- settings ----------
function Settings() {
  const [s, setS] = useState<FinanceSettings | null>(null); const [from, setFrom] = useState(''); const [amount, setAmount] = useState(''); const [msg, setMsg] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [oldPw, setOldPw] = useState(''); const [newPw, setNewPw] = useState('');
  const load = useCallback(async () => { const r = await api.financeSettings(); if ('year' in r) { setS(r); setFrom((f) => f || r.months[0] || ''); } }, []);
  useEffect(() => { load(); }, [load]);
  async function saveRate() { setMsg(null); const n = Number(amount.replace(/[^\d]/g, '')); const r = await api.financeSetRate(from, n); if (r.ok) { setMsg({ tone: 'info', text: 'تم حفظ المبلغ.' }); setAmount(''); load(); } else setMsg({ tone: 'error', text: ERR[r.error] ?? 'تعذّر الحفظ.' }); }
  async function toggle(m: string, free: boolean) { setMsg(null); const r = await api.financeSetFreeMonth(m, free); if (r.ok) load(); else setMsg({ tone: 'error', text: ERR[r.error] ?? 'تعذّر التعديل.' }); }
  async function changePw() { setMsg(null); const r = await api.financeChangePassword(oldPw, newPw); if (r.ok) { setMsg({ tone: 'info', text: 'تم تغيير كلمة السر.' }); setOldPw(''); setNewPw(''); } else setMsg({ tone: 'error', text: PW_ERR(r) }); }
  if (!s) return null;
  if (!s.year) return <div className="banner warn">لا توجد سنة دراسية نشطة. أنشئوها أولاً.</div>;
  return (
    <div className="settings">
      {msg && <div className={`banner ${msg.tone === 'error' ? 'error' : 'info'}`} role="alert">{msg.text}</div>}
      <section className="step-box"><h2>المبلغ الشهري</h2><p className="helper">مبلغ واحد ثابت لكل الطلاب. يسري التغيير على الأشهر القادمة فقط، ولا يمسّ ما دُفع.</p>
        {s.rates.length === 0 ? <div className="banner warn">لم يُحدَّد المبلغ بعد. لا يمكن تسجيل دفعات قبل تحديده.</div> : <ul className="rates">{s.rates.map((r) => <li key={r.effectiveFrom}><span>ابتداءً من <Month m={r.effectiveFrom} /></span><Dinar n={r.amount} /></li>)}</ul>}
        <div className="opts"><label className="field"><span>ابتداءً من شهر</span><select value={from} onChange={(e) => setFrom(e.target.value)}>{s.months.map((m) => <option key={m} value={m}>{monthParts(m).name} {monthParts(m).year}</option>)}</select></label>
          <label className="field"><span>المبلغ بالدينار</span><input className="ltr num" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} /></label></div>
        <button className="btn primary" onClick={saveRate} disabled={!from || !amount.trim()}>حفظ المبلغ</button></section>
      <section className="step-box"><h2>الأشهر غير المحسوبة</h2><p className="helper">اضغطوا على الشهر لإعفائه من الرسوم (عطلة)، وعلى الشهر المعفى لإرجاعه.</p>
        <div className="month-chips">{s.months.map((m) => { const free = s.freeMonths.includes(m); return <button key={m} className={`chip-btn ${free ? 'on' : ''}`} aria-pressed={free} onClick={() => toggle(m, !free)}><Month m={m} />{free && <small>معفى</small>}</button>; })}</div></section>
      <section className="step-box"><h2>كلمة سر المال</h2><div className="opts"><label className="field"><span>الحالية</span><input type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoComplete="off" /></label>
        <label className="field"><span>الجديدة</span><input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="off" /></label></div>
        <button className="btn" onClick={changePw} disabled={!oldPw || !newPw}>تغيير كلمة السر</button></section>
    </div>
  );
}

// ---------- shell of the section ----------
type Tab = 'collect' | 'arrears' | 'register' | 'settings';
const TABS: [Tab, string][] = [['collect', 'التحصيل'], ['arrears', 'المتأخرات'], ['register', 'سجل الدفعات'], ['settings', 'الإعدادات']];

export function Finance({ user, scope }: { user: UserView; scope: string }) {
  const [status, setStatus] = useState<{ canUse: boolean; configured: boolean; unlocked: boolean } | null>(null);
  const [tab, setTab] = useState<Tab>('collect'); const [open, setOpen] = useState<{ id: string; givenName: string; familyName: string; studentNo: string } | null>(null);
  const [summary, setSummary] = useState<MonthSummary | null>(null); const [receipt, setReceipt] = useState<Receipt | null>(null);
  const refresh = useCallback(async () => setStatus(await api.financeStatus()), []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (status?.unlocked) api.financeSummary().then((r) => setSummary(r.summary)).catch(() => undefined); }, [status?.unlocked, tab, receipt]);
  // when the main process relocks (idle), the next call is refused; re-check the state so the lock screen appears
  useEffect(() => { if (!status?.unlocked) return; const t = setInterval(refresh, 30_000); return () => clearInterval(t); }, [status?.unlocked, refresh]);
  useEffect(() => { if (receipt) { const t = setTimeout(() => window.print(), 200); const h = setTimeout(() => setReceipt(null), 8000); return () => { clearTimeout(t); clearTimeout(h); }; } }, [receipt]);

  if (!status) return null;
  if (!status.canUse) return <div className="empty"><div className="niche" aria-hidden="true" /><h2>قسم المال غير متاح</h2><p>ليست لديكم صلاحية الدخول إلى هذا القسم.</p></div>;
  if (!status.unlocked) return <Gate status={status} onChange={refresh} />;

  const mp = summary ? monthParts(summary.month) : null;
  return (
    <div className="finance">
      <div className="fin-head">
        {summary && mp && <div className="ledger compact" aria-label="ملخص الشهر">
          <div className="ledger-cell total"><span className="big num">{summary.paid}</span><span className="lbl">سدّدوا شهر {mp.name}</span></div>
          <div className="ledger-cell"><span className="big num">{summary.unpaid}</span><span className="lbl">لم يسدّدوا</span></div>
          <div className="ledger-cell"><span className="big"><Dinar n={summary.collected} /></span><span className="lbl">محصّل من أصل <Dinar n={summary.expected} /></span></div>
        </div>}
        <span className="sp" /><button className="btn" onClick={async () => { await api.financeLock(); refresh(); }}>قفل القسم</button>
      </div>
      <div className="tabs" role="tablist">{TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>)}</div>
      {tab === 'collect' && <Collect key={open?.id ?? 'none'} initial={open} onPrint={setReceipt} />}
      {tab === 'arrears' && <Arrears scope={scope} onOpen={(r) => { const [g, ...f] = r.name.split(' '); setOpen({ id: r.studentId, givenName: g ?? '', familyName: f.join(' '), studentNo: r.studentNo }); setTab('collect'); }} />}
      {tab === 'register' && <Register onPrint={setReceipt} />}
      {tab === 'settings' && <Settings />}
      {receipt && <><ReceiptSheet r={receipt} /><div className="toast" role="status">وصل رقم {receipt.receiptNo} <button className="btn quiet" onClick={() => setReceipt(null)}>إخفاء</button></div></>}
    </div>
  );
}
void useMemo;
