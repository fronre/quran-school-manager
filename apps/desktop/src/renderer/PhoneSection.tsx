import { useCallback, useEffect, useState } from 'react';

interface Device { id: string; name: string; branchIds: string[]; createdAt: string; lastSeenAt: string | null; revokedAt: string | null }
interface Status { enabled: boolean; running: boolean; port: number; urls: string[]; devices: Device[]; error?: 'no_network' | 'start_failed'; branches: { id: string; name: string }[] }
const call = <T,>(channel: string, payload?: unknown) => window.mishkat.invoke(channel, payload) as Promise<T>;
const stamp = (iso: string | null) => (iso ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) : '—');

/** Settings section: the Wi-Fi phone page. Off by default. */
export function PhoneSection() {
  const [s, setS] = useState<Status | null>(null); const [branch, setBranch] = useState('all'); const [code, setCode] = useState<{ code: string; until: number } | null>(null); const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => setS(await call<Status>('phone.status')), []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  useEffect(() => { if (!code) return; const t = setInterval(() => { const l = Math.max(0, Math.round((code.until - Date.now()) / 1000)); setLeft(l); if (l === 0) { setCode(null); load(); } }, 500); return () => clearInterval(t); }, [code, load]);
  if (!s) return null;
  async function toggle() { setBusy(true); setMsg(null); const r = await call<Status>(s!.running ? 'phone.disable' : 'phone.enable'); setBusy(false); setS(r); setCode(null); if (r.error === 'no_network') setMsg('لا توجد شبكة: اتصلوا بالواي فاي أو بالشبكة المحلية ثم أعيدوا المحاولة.'); else if (r.error === 'start_failed') setMsg('تعذّر تشغيل نسخة الهاتف. قد يمنعها جدار الحماية أو برنامج آخر. أعيدوا المحاولة.'); }
  async function newCode() { setMsg(null); const r = await call<{ ok: true; code: string; expiresAt: string } | { ok: false; error: string }>('phone.newCode', { branchId: branch }); if (r.ok) { setCode({ code: r.code, until: Date.parse(r.expiresAt) }); setLeft(Math.round((Date.parse(r.expiresAt) - Date.now()) / 1000)); } else setMsg(r.error === 'too_many_devices' ? 'بلغتم أقصى عدد من الهواتف (20). ألغوا هاتفاً لا يُستعمل.' : 'تعذّر إنشاء الرمز.'); }
  async function revoke(d: Device) { await call('phone.revoke', { id: d.id }); load(); }
  const names = (ids: string[]) => ids.map((i) => s.branches.find((b) => b.id === i)?.name ?? '').filter(Boolean).join('، ');
  const live = s.devices.filter((d) => !d.revokedAt);
  return (
    <section className="step-box"><h2>نسخة الهاتف</h2>
      <p className="helper">يفتح الأساتذة صفحة على هواتفهم عبر واي فاي الجمعية لتسجيل الحضور والحفظ. البيانات تبقى على هذا الحاسوب وحده، ولا تمرّ بالإنترنت. تعمل ما دام «الشهاب» مفتوحاً على هذا الحاسوب والهاتف على الشبكة نفسها. الصفحة لا تعرض المال ولا أرقام الأولياء ولا الصور، ولا تسمح بالتصحيح أو الحذف. وهي مُطفأة افتراضياً.</p>
      {msg && <div className="banner error" role="alert">{msg}</div>}
      <p><button className={s.running ? 'btn danger' : 'btn primary'} disabled={busy} onClick={toggle}>{s.running ? 'إيقاف نسخة الهاتف' : 'تشغيل نسخة الهاتف'}</button> <span className={s.running ? 'badge ok' : 'badge neutral'}><i aria-hidden="true" />{s.running ? 'تعمل' : 'متوقفة'}</span></p>
      {s.running && (
        <>
          <div className="confirm">
            <p><b>على الهاتف:</b> افتحوا المتصفح واكتبوا أحد هذه العناوين (الهاتف على واي فاي الجمعية):</p>
            <ul className="phone-urls">{s.urls.map((u) => <li key={u} className="num path">{u}</li>)}</ul>
            <p><b>صفحة الأولياء (تجريبية):</b> العنوان نفسه ويُضاف إليه <span className="num path">/g</span> (مثال: <span className="num path">{s.urls[0]}/g</span>). يدخل الولي برقم هاتفه المسجَّل مع رمز تسلّمونه له من ملف الطالب ← «الأولياء» ← «رمز للتطبيق». تعمل داخل شبكة الجمعية فقط.</p>
            <p className="helper">سيقول المتصفح في المرة الأولى إن الاتصال «غير آمن» أو «الشهادة غير موثوقة»: هذا متوقع لأن الشهادة أنشأها البرنامج بنفسه على هذا الحاسوب، والاتصال مشفّر مع ذلك. اختاروا «متابعة / خيارات متقدمة ← المتابعة إلى الموقع». وقد يسألكم ويندوز عن السماح للبرنامج بالشبكة: اختاروا «الشبكات الخاصة» فقط.</p>
          </div>
          <h3>ربط هاتف جديد</h3>
          <div className="grid2">
            <div className="field"><label htmlFor="pb">يرى هذا الهاتف</label><select id="pb" value={branch} onChange={(e) => setBranch(e.target.value)}><option value="all">كل الفروع</option>{s.branches.map((b) => <option key={b.id} value={b.id}>{b.name} فقط</option>)}</select></div>
            <div className="field"><label>&nbsp;</label><button className="btn" onClick={newCode}>رمز ربط جديد</button></div>
          </div>
          {code && <div className="confirm" role="status"><p>اكتبوا هذا الرمز في الهاتف (يصلح مرة واحدة، وينتهي بعد <span className="num">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>):</p><p className="pair-code num">{code.code}</p></div>}
          <h3>الهواتف المربوطة</h3>
          {live.length === 0 ? <p className="helper">لا هواتف مربوطة بعد.</p> : (
            <div className="grid-wrap"><table className="grid" aria-label="الهواتف المربوطة"><thead><tr><th scope="col">الهاتف</th><th scope="col">الفروع</th><th scope="col">رُبط</th><th scope="col">آخر اتصال</th><th scope="col" /></tr></thead>
              <tbody>{live.map((d) => <tr key={d.id}><td><b>{d.name}</b></td><td>{names(d.branchIds)}</td><td className="num">{stamp(d.createdAt)}</td><td className="num">{stamp(d.lastSeenAt)}</td><td><button className="btn quiet" onClick={() => revoke(d)}>إلغاء الربط</button></td></tr>)}</tbody></table></div>
          )}
          <p className="helper">ضاع هاتف أو تغيّر أستاذ؟ اضغطوا «إلغاء الربط»: يتوقف ذلك الهاتف فوراً. كل تسجيل من الهاتف يُكتب في السجل باسم الهاتف.</p>
        </>
      )}
    </section>
  );
}
