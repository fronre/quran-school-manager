import { useCallback, useEffect, useState } from 'react';

interface Data { passRank: number; version: number; scale: { rank: number; label: string }[]; canEdit: boolean }
type Res = { ok: true } | { ok: false; error: string };
const call = <T,>(channel: string, payload?: unknown) => window.mishkat.invoke(channel, payload) as Promise<T>;
const ERR: Record<string, string> = { forbidden: 'لا تملكون صلاحية تعديل الإعدادات.', invalid: 'كل تقدير يحتاج اسماً (حتى 30 حرفاً).', duplicate_labels: 'لا يجوز أن يتكرر اسم تقدير.', conflict: 'عُدِّلت الإعدادات من مكان آخر. أعيدوا فتح الصفحة.' };

/** Settings section: the names of the five evaluation levels and the pass mark that decides what counts as memorized. */
export function MemoSettings() {
  const [d, setD] = useState<Data | null>(null); const [labels, setLabels] = useState<Record<string, string>>({}); const [pass, setPass] = useState(2); const [msg, setMsg] = useState<{ tone: 'info' | 'error'; text: string } | null>(null); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await call<Data>('memo.settingsGet'); setD(r); setLabels(Object.fromEntries(r.scale.map((x) => [String(x.rank), x.label]))); setPass(r.passRank); }, []);
  useEffect(() => { load(); }, [load]);
  if (!d) return null;
  const dirty = d.scale.some((x) => labels[String(x.rank)] !== x.label) || pass !== d.passRank;
  async function save() {
    setBusy(true); setMsg(null); const r = await call<Res>('memo.settingsSet', { passRank: pass, expectedVersion: d!.version, labels }); setBusy(false);
    if (r.ok) { setMsg({ tone: 'info', text: 'تم حفظ التقديرات. السجلات القديمة تحتفظ بتقديرها كما أُدخل.' }); await load(); } else setMsg({ tone: 'error', text: ERR[r.error] ?? 'تعذّر الحفظ.' });
  }
  return (
    <section className="step-box"><h2>تقديرات الحفظ</h2>
      <p className="helper">أسماء مستويات التقدير الخمسة، ودرجة النجاح: الحفظ الجديد الذي يبلغ هذا المستوى فأعلى يُحسب محفوظاً. تغيير الأسماء لا يغيّر السجلات القديمة. تغيير درجة النجاح يغيّر ما يُحسب محفوظاً من الآن.</p>
      {msg && <div className={`banner ${msg.tone === 'error' ? 'error' : 'info'}`} role="alert">{msg.text}</div>}
      <div className="grid2">{d.scale.map((x) => <div className="field" key={x.rank}><label htmlFor={'ml' + x.rank}>المستوى <span className="num">{x.rank}</span>{x.rank === 5 ? ' (الأعلى)' : x.rank === 1 ? ' (الأدنى)' : ''}</label><input id={'ml' + x.rank} maxLength={30} disabled={!d.canEdit} value={labels[String(x.rank)] ?? ''} onChange={(e) => setLabels({ ...labels, [String(x.rank)]: e.target.value })} /></div>)}</div>
      <div className="field"><label htmlFor="mp">درجة النجاح (يُحسب محفوظاً من هذا المستوى فأعلى)</label>
        <select id="mp" disabled={!d.canEdit} value={pass} onChange={(e) => setPass(Number(e.target.value))}>{d.scale.map((x) => <option key={x.rank} value={x.rank}>{labels[String(x.rank)] || x.label}</option>)}</select></div>
      {d.canEdit && <button className="btn primary" disabled={busy || !dirty} onClick={save}>حفظ التقديرات</button>}
    </section>
  );
}
