import { YearSection } from './YearSection';
import { MemoSettings } from './MemoSettings';
import { PhoneSection } from './PhoneSection';
import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { api, SETTINGS_ERROR_TEXT, type SettingsData } from './api';

type Msg = { tone: 'info' | 'error'; text: string } | null;

/** The phone and guardian pages are offered for trial (not yet tried on a real phone or router). They stay off until the Director switches them on; localStorage mishkat_show_phone=0 hides the section. */
const SHOW_PHONE = (() => { try { return localStorage.getItem('mishkat_show_phone') !== '0'; } catch { return false; } })();
export function SettingsScreen({ onRenamed }: { onRenamed: () => void }) {
  const [s, setS] = useState<SettingsData | null>(null); const [msg, setMsg] = useState<Msg>(null);
  const [name, setName] = useState(''); const [address, setAddress] = useState(''); const [contact, setContact] = useState('');
  const [edits, setEdits] = useState<Record<string, string>>({}); const [newBranch, setNewBranch] = useState('');
  const [oldPw, setOldPw] = useState(''); const [newPw, setNewPw] = useState(''); const [newPw2, setNewPw2] = useState('');
  const [version, setVersion] = useState(''); const [logo, setLogo] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api.settingsGet(); setS(r); setName(r.association.name); setAddress(r.association.address ?? ''); setContact(r.association.contact ?? ''); setEdits({});
  }, []);
  useEffect(() => { load(); api.info().then((i) => { setVersion(i.version); setLogo(i.logo ?? null); }); }, [load]);
  const fail = (e: string, retry?: number) => setMsg({ tone: 'error', text: e === 'wrong' ? `كلمة المرور الحالية غير صحيحة.${retry ? ` انتظروا ${retry} ثانية.` : ''}` : e === 'locked' ? `تكرّرت المحاولات الخاطئة. انتظروا ${retry ?? 30} ثانية.` : SETTINGS_ERROR_TEXT[e] ?? 'تعذّر الحفظ. أعيدوا المحاولة.' });

  async function sendLogo(v: string | null) { setMsg(null); const r = await api.logoSet(v); if (r.ok) { setLogo(v); setMsg({ tone: 'info', text: v ? 'تم حفظ الشعار.' : 'تمت إزالة الشعار.' }); onRenamed(); } else setMsg({ tone: 'error', text: r.error === 'too_big' ? 'الصورة كبيرة جداً.' : r.error === 'forbidden' ? 'ليست لديكم صلاحية تغيير الشعار.' : 'تعذّر قبول الصورة. استعملوا PNG أو JPG.' }); }
  function pickLogo(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
    if (!/^image\/(png|jpeg)$/.test(f.type) || f.size > 8_000_000) { setMsg({ tone: 'error', text: 'اختاروا صورة PNG أو JPG لا يتجاوز حجمها 8 ميغابايت.' }); return; }
    const fr = new FileReader(); // data: URLs only: the page policy does not allow blob: images
    fr.onerror = () => setMsg({ tone: 'error', text: 'تعذّر قراءة الصورة.' });
    fr.onload = () => { const img = new Image();
    img.onload = () => { // shrink to at most 256 px; keep transparency for PNG, white background for JPG
      const k = Math.min(1, 256 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      const g = c.getContext('2d')!; g.drawImage(img, 0, 0, c.width, c.height);
      let out = c.toDataURL('image/png'); if (out.length > 380_000) { g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); out = c.toDataURL('image/jpeg', 0.88); }
      void sendLogo(out);
    };
    img.onerror = () => setMsg({ tone: 'error', text: 'تعذّر قراءة الصورة.' });
    img.src = String(fr.result); };
    fr.readAsDataURL(f);
  }
  const removeLogo = () => sendLogo(null);
  async function saveAssociation() { setMsg(null); const r = await api.settingsUpdateAssociation(s!.association.version, name, address, contact); if (r.ok) { setMsg({ tone: 'info', text: 'تم حفظ بيانات الجمعية.' }); await load(); onRenamed(); } else fail(r.error); }
  async function rename(id: string, version: number) { setMsg(null); const r = await api.settingsRenameBranch(id, version, edits[id] ?? ''); if (r.ok) { setMsg({ tone: 'info', text: 'تم تغيير اسم الفرع.' }); await load(); onRenamed(); } else fail(r.error); }
  async function add() { setMsg(null); const r = await api.settingsAddBranch(newBranch); if (r.ok) { setNewBranch(''); setMsg({ tone: 'info', text: 'تمت إضافة الفرع.' }); await load(); onRenamed(); } else fail(r.error); }
  async function changePw() {
    setMsg(null); if (newPw !== newPw2) { setMsg({ tone: 'error', text: 'كلمتا المرور الجديدتان غير متطابقتين.' }); return; }
    const r = await api.accountChangePassword(oldPw, newPw); if (r.ok) { setOldPw(''); setNewPw(''); setNewPw2(''); setMsg({ tone: 'info', text: 'تم تغيير كلمة مرور الدخول. استعملوا الجديدة في المرة القادمة.' }); } else fail(r.error, r.retryAfterSeconds);
  }
  if (!s) return null;
  return (
    <div className="settings">
      {msg && <div className={`banner ${msg.tone === 'error' ? 'error' : 'info'}`} role="alert">{msg.text}</div>}

      <section className="step-box"><h2>بيانات الجمعية</h2><p className="helper">تظهر في الشريط الجانبي وفي المطبوعات والملفات المصدَّرة.</p>
        <div className="field"><label htmlFor="an">اسم الجمعية</label><input id="an" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="grid2">
          <div className="field"><label htmlFor="aa">العنوان (اختياري)</label><input id="aa" value={address} onChange={(e) => setAddress(e.target.value)} /></div>
          <div className="field"><label htmlFor="ac">وسيلة الاتصال (اختياري)</label><input id="ac" value={contact} onChange={(e) => setContact(e.target.value)} /></div>
        </div>
        <button className="btn primary" onClick={saveAssociation} disabled={!name.trim()}>حفظ</button></section>

      <section className="step-box"><h2>شعار الجمعية</h2><p className="helper">يظهر في شاشة الدخول وأعلى القائمة الجانبية وفي ترويسة المطبوعات (الوصل، التقارير، كشف الطالب). صورة PNG أو JPG، وتُصغَّر تلقائياً. يُحفظ على هذا الجهاز ويدخل في النسخ الاحتياطية.</p>
        <div className="logo-row">{logo ? <img className="logo-preview" src={logo} alt="الشعار الحالي" /> : <span className="helper">لا يوجد شعار بعد.</span>}
          <label className="btn" htmlFor="lg">{logo ? 'تغيير الشعار' : 'اختيار شعار'}</label><input id="lg" className="visually-hidden" type="file" accept="image/png,image/jpeg" onChange={pickLogo} />
          {logo && <button className="btn" onClick={removeLogo}>إزالة الشعار</button>}</div></section>

      <section className="step-box"><h2>الفروع</h2>
        <div className="grid-wrap"><table className="grid" aria-label="الفروع"><thead><tr><th scope="col">الاسم</th><th scope="col">الطلاب</th><th scope="col">المعلمون</th><th scope="col" /></tr></thead>
          <tbody>{s.branches.map((b) => (
            <tr key={b.id}><td><input aria-label={`اسم ${b.name}`} value={edits[b.id] ?? b.name} onChange={(e) => setEdits({ ...edits, [b.id]: e.target.value })} /></td>
              <td className="num">{b.students}</td><td className="num">{b.teachers}</td>
              <td><button className="btn" disabled={edits[b.id] === undefined || edits[b.id] === b.name || !edits[b.id]!.trim()} onClick={() => rename(b.id, b.version)}>تغيير الاسم</button></td></tr>))}</tbody></table></div>
        <div className="branch-row"><div className="field"><label htmlFor="nb">فرع جديد</label><input id="nb" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} placeholder="اسم الفرع" /></div><button className="btn" onClick={add} disabled={!newBranch.trim()}>إضافة فرع</button></div></section>

      <section className="step-box"><h2>حساب الدخول</h2><p className="helper">حساب واحد يدخل به الجميع. اسم المستخدم: <b className="num">{s.username}</b></p>
        <div className="opts">
          <div className="field"><label htmlFor="op">كلمة المرور الحالية</label><input id="op" type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoComplete="off" /></div>
          <div className="field"><label htmlFor="np">الجديدة</label><input id="np" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="off" /></div>
          <div className="field"><label htmlFor="np2">أعيدوا كتابتها</label><input id="np2" type="password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} autoComplete="off" /></div>
        </div>
        <p className="helper">10 أحرف على الأقل، وتكفي عبارة من عدة كلمات.</p>
        <button className="btn" onClick={changePw} disabled={!oldPw || !newPw || !newPw2}>تغيير كلمة المرور</button></section>

      <YearSection onChanged={onRenamed} />
      <MemoSettings />
      {SHOW_PHONE && <PhoneSection />}

      <section className="step-box"><h2>حول البرنامج</h2><p className="helper">الشهاب — الإصدار <span className="num">{version}</span>. البيانات محفوظة على هذا الجهاز فقط ولا تُرسل إلى أي مكان.</p></section>
    </div>
  );
}
