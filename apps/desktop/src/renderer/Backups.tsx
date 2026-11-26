import { useCallback, useEffect, useState } from 'react';
import { api, BACKUP_KIND_AR, fileSize, stamp, type BackupList } from './api';

const RESTORE_ERROR: Record<string, string> = {
  wrong_password: 'كلمة المرور غير صحيحة.', locked: 'تكرّرت المحاولات الخاطئة. انتظروا قليلاً ثم أعيدوا المحاولة.', bad_key: 'مفتاح الاسترداد غير صحيح. راجعوا الورقة التي حفظتموها.',
  key_needed: 'لا يوجد مفتاح محفوظ على هذا الجهاز. اكتبوا مفتاح الاسترداد من الورقة.', wrong_key_or_tampered: 'تعذّر فتح النسخة بهذا المفتاح، أو أنها تالفة. بياناتكم الحالية سليمة.',
  wrong_tenant: 'هذه النسخة تخص جمعية أخرى. لم يتغير شيء.', newer_schema: 'هذه النسخة أحدث من البرنامج المثبَّت. حدّثوا البرنامج أولاً.', bad_format: 'الملف ليس نسخة احتياطية سليمة.',
  integrity_failed: 'النسخة تالفة ولا يمكن استعادتها. بياناتكم الحالية سليمة.', audit_chain_broken: 'سجل التدقيق في النسخة غير سليم. لم تُستعد. بياناتكم الحالية سليمة.',
  restore_interrupted: 'انقطعت الاستعادة في منتصفها. سيُعاد تشغيل البرنامج الآن ليعود إلى حالة سليمة. إن ظهرت بياناتكم ناقصة فاستعيدوا نسخة من «before-restore».',
  pre_restore_backup_failed: 'تعذّر حفظ نسخة من الحالة الحالية قبل الاستعادة، فلم تبدأ. تأكدوا أن المجلد متاح.', file_not_found: 'الملف غير موجود في مجلد النسخ.',
};

export function Backups() {
  const [data, setData] = useState<BackupList | null>(null); const [busy, setBusy] = useState(false); const [note, setNote] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [restoreFile, setRestoreFile] = useState<string | null>(null); const [password, setPassword] = useState(''); const [key, setKey] = useState(''); const [word, setWord] = useState(''); const [showKey, setShowKey] = useState(false);
  const [restarting, setRestarting] = useState(false); const [showHistory, setShowHistory] = useState(false);
  const load = useCallback(async () => setData(await api.backupList()), []);
  useEffect(() => { load(); }, [load]);

  async function now() { setBusy(true); setNote(null); const r = await api.backupNow(); setBusy(false); if (r.ok) { setNote({ tone: 'info', text: 'تم إنشاء نسخة احتياطية موثّقة.' }); load(); } else setNote({ tone: 'error', text: r.error === 'not_configured' ? 'لم يُضبط مجلد النسخ الاحتياطية. اختاروه أولاً.' : 'تعذّر إنشاء النسخة. تأكدوا أن المجلد متاح. بياناتكم الحالية سليمة.' }); }
  async function useSuggestion(id: string) { setBusy(true); const r = await api.backupUseSuggestion(id); setBusy(false); setNote(r.ok ? { tone: 'info', text: 'تم تغيير مجلد النسخ الاحتياطية. تؤخذ النسخ القادمة فيه.' } : { tone: 'error', text: 'تعذّر استعمال هذا المكان. اختاروا مجلداً آخر.' }); load(); }
  async function second() { const r = await api.backupSetSecondFolder(); if (r.ok) { setNote({ tone: 'info', text: 'ستُنسخ كل نسخة تلقائية جديدة إلى هذا المجلد أيضاً.' }); load(); } else if (r.error === 'same_folder') setNote({ tone: 'error', text: 'اختاروا مجلداً مختلفاً عن المجلد الأساسي.' }); }
  async function clearSecond() { await api.backupClearSecondFolder(); load(); }
  async function folder() { const r = await api.backupSetFolder(); if (r.ok) { setNote({ tone: 'info', text: 'تم تغيير مجلد النسخ الاحتياطية. تؤخذ النسخ القادمة فيه.' }); load(); } }
  async function restore() {
    setBusy(true); setNote(null); const r = await api.backupRestore(restoreFile!, password, key); setBusy(false);
    if (r.ok) { setRestarting(true); return; }
    setNote({ tone: 'error', text: r.error === 'key_needed' || r.error === 'bad_key' || r.error === 'wrong_key_or_tampered' ? (setShowKey(true), RESTORE_ERROR[r.error]!) : RESTORE_ERROR[r.error ?? ''] ?? 'تعذّرت الاستعادة. بياناتكم الحالية سليمة.' });
  }

  if (restarting) return <div className="empty"><div className="niche" aria-hidden="true" /><h2>تمت الاستعادة</h2><p>يعيد البرنامج التشغيل الآن. سجّلوا الدخول من جديد.</p></div>;
  if (!data) return null;
  const last = data.lastBackupAt;
  return (
    <div className="backups">
      {note && !restoreFile && <div className={`banner ${note.tone === 'error' ? 'error' : 'info'}`} role="alert">{note.text}</div>}
      <section className="step-box">
        <h2>حالة النسخ الاحتياطي</h2>
        <p>{last ? <>آخر نسخة موثّقة: <span className="num">{stamp(last)}</span></> : <b className="warn-text">لا توجد نسخة موثّقة بعد.</b>} — كل تغيير يُحفظ في قاعدة البيانات لحظة إدخاله، حتى لو انطفأت الكهرباء. وفوق ذلك يأخذ البرنامج نسخة احتياطية تلقائية كل 10 دقائق إذا تغيّر شيء، وعند تسجيل الخروج أو إغلاق البرنامج، وقبل كل استيراد وكل تحديث للبيانات.</p>
        <div className="folder-box"><div><div className="helper">المجلد الأساسي</div><div className="num path">{data.folder ?? 'لم يُحدَّد'}</div></div><button className="btn" onClick={folder}>اختيار مجلد آخر</button></div>
        <div className="suggest-row" role="group" aria-label="أماكن مقترحة">{data.suggestions.map((s) => <button key={s.id} className="btn" disabled={busy || s.path === data.folder} onClick={() => useSuggestion(s.id)}>{s.kind === 'drive' ? '☁ ' : ''}{s.label}</button>)}</div>
        {!data.suggestions.some((s) => s.kind === 'drive') && <p className="helper">للحفظ على Google Drive: ثبّتوا «Google Drive لسطح المكتب» وسجّلوا الدخول فيه، ثم اختاروا مجلداً داخل Drive بزر «اختيار مجلد آخر»، أو ارجعوا إلى هذه الصفحة فيظهر Drive بين الأماكن المقترحة. البرنامج لا يتصل بـ Google مباشرة: يضع الملفات المشفّرة في مجلد، و Drive هو الذي يرفعها.</p>}
        <div className="folder-box"><div><div className="helper">مجلد النسخة الثانية (اختياري)</div><div className="num path">{data.secondFolder ?? 'لم يُحدَّد'}</div></div>
          <span className="row-actions"><button className="btn" onClick={second}>{data.secondFolder ? 'تغيير' : 'اختيار مجلد'}</button>{data.secondFolder && <button className="btn quiet" onClick={clearSecond}>إزالة</button>}</span></div>
        {data.auto.lastAt && <p className="helper">آخر حفظ تلقائي في هذه الجلسة: <span className="num">{stamp(data.auto.lastAt)}</span> — {data.auto.ok ? 'نجح' : <b className="warn-text">تعذّر. تأكدوا أن المجلد متاح.</b>}{data.auto.secondOk === false && <b className="warn-text"> · تعذّر نسخ الملف إلى المجلد الثاني.</b>}</p>}
        <div className="row-actions"><button className="btn primary" onClick={now} disabled={busy || !data.folder}>{busy ? 'جارٍ النسخ…' : 'نسخ احتياطي الآن'}</button></div>
        <div className="banner info">النسخ مشفّرة ولا تُفتح إلا بمفتاح الاسترداد. احفظوا <b>نسخة ثانية في مكان آخر</b> (قرص خارجي أو جهاز آخر)، فالحاسوب الواحد قد يتعطل أو يصيبه فيروس.</div>
      </section>

      <section className="step-box">
        <h2>النسخ المحفوظة</h2>
        {!!data.otherFiles && <p className="helper">في هذا المجلد أيضاً <span className="num">{data.otherFiles}</span> {data.otherFiles === 1 ? 'ملف لا يخص' : 'ملفات لا تخص'} بيانات هذا البرنامج (نسخة أخرى مثبّتة، أو نسخة تجريبية، أو ملف تالف)، فلا تظهر هنا ولا يمكن استعادتها. لا تحذفوها: قد تكون نسخ تلك البيانات الأخرى.</p>}
        {data.files.length === 0 ? <p className="helper">لا توجد ملفات نسخ لهذه البيانات في المجلد.</p> : (
          <div className="grid-wrap"><table className="grid" aria-label="النسخ الاحتياطية"><thead><tr><th scope="col">التاريخ</th><th scope="col">الملف</th><th scope="col">الحجم</th><th scope="col" /></tr></thead>
            <tbody>{data.files.map((f) => (
              <tr key={f.name}><td className="num">{stamp(f.modifiedAt)}</td><td className="num path">{f.name}</td><td className="num">{fileSize(f.sizeBytes)}</td>
                <td><button className="btn" onClick={() => { setRestoreFile(f.name); setPassword(''); setKey(''); setWord(''); setShowKey(false); setNote(null); }}>استعادة</button></td></tr>))}</tbody></table></div>
        )}
        {restoreFile && (
          <div className="confirm">
            <p><b>الاستعادة تستبدل كل بيانات البرنامج الحالية بما في هذه النسخة.</b> كل ما أُدخل بعد تاريخها سيختفي. يحفظ البرنامج أولاً نسخة من الحالة الحالية في مجلد «before-restore» لتتراجعوا عند الحاجة، ثم يُعاد تشغيله.</p>
            <p className="num path">{restoreFile}</p>
            {note && <div className={`banner ${note.tone === 'error' ? 'error' : 'info'}`} role="alert">{note.text}</div>}
            <div className="field"><label htmlFor="rp">كلمة مرور الدخول (للتأكيد)</label><input id="rp" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" /></div>
            {showKey ? <div className="field"><label htmlFor="rk2">مفتاح الاسترداد (من الورقة)</label><input id="rk2" className="ltr num" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" /></div>
              : <button className="btn quiet" onClick={() => setShowKey(true)}>النسخة من جهاز آخر؟ أدخلوا مفتاح الاسترداد</button>}
            <div className="field"><label htmlFor="rw">اكتبوا كلمة «استعادة» للمتابعة</label><input id="rw" value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" /></div>
            <div className="row-actions"><button className="btn" onClick={() => setRestoreFile(null)} disabled={busy}>إلغاء</button>
              <button className="btn danger" onClick={restore} disabled={busy || word.trim() !== 'استعادة' || !password}>{busy ? 'جارٍ الاستعادة…' : 'استعادة هذه النسخة'}</button></div>
          </div>
        )}
      </section>

      <section className="step-box">
        <h2>سجل العمليات</h2>
        <button className="btn" onClick={() => setShowHistory(!showHistory)}>{showHistory ? 'إخفاء السجل' : 'عرض السجل'}</button>
        {showHistory && (data.history.length === 0 ? <p className="helper">لا عمليات بعد.</p> : (
          <div className="grid-wrap"><table className="grid" aria-label="سجل النسخ"><thead><tr><th scope="col">الوقت</th><th scope="col">النوع</th><th scope="col">النتيجة</th></tr></thead>
            <tbody>{data.history.map((h) => (
              <tr key={h.id}><td className="num">{h.at ? stamp(h.at) : '—'}</td><td>{BACKUP_KIND_AR[h.kind] ?? h.kind}</td>
                <td><span className={`badge ${h.failed ? 'bad' : h.verified ? 'ok' : 'neutral'}`}><i aria-hidden="true" />{h.failed ? 'فشلت' : h.verified ? 'موثّقة' : 'غير موثّقة'}</span></td></tr>))}</tbody></table></div>))}
      </section>
    </div>
  );
}
