import { useState } from 'react';
import { suggestMapping, UPDATE_FIELDS, UPDATE_FIELD_AR, type UpdateMapping, type UpdateField } from '@mishkat/domain';

interface Picked { ok: true; fileName: string; headers: string[]; rowCount: number }
interface Prev { ok: true; total: number; toUpdate: number; unchanged: number; withIssues: number; issueCounts: Record<string, number>; issueText: Record<string, string>; rows: { row: number; studentNo: string; name: string; changes: Record<string, string | null>; issues: string[] }[] }
const call = <T,>(channel: string, payload?: unknown) => window.mishkat.invoke(channel, payload) as Promise<T>;
const CH_AR: Record<string, string> = { birthDate: 'تاريخ الميلاد', phone: 'الهاتف', joinedOn: 'تاريخ الانضمام' };

/** Fills in details of students who are already registered (matched by student number). Nothing is created; empty cells never erase anything. */
export function UpdateImport({ onBack }: { onBack: () => void }) {
  const [file, setFile] = useState<Picked | null>(null); const [mapping, setMapping] = useState<UpdateMapping>({}); const [prev, setPrev] = useState<Prev | null>(null); const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [done, setDone] = useState<{ updated: number; skipped: number } | null>(null); const [skip, setSkip] = useState(false);
  async function pick() {
    setBusy(true); setMsg(null); setPrev(null); setDone(null); const r = await call<Picked | { ok: false; error: string; message?: string }>('import.pickFile', {}); setBusy(false);
    if (r.ok) { setFile(r); const g = suggestMapping(r.headers); const m: UpdateMapping = {}; for (const f of UPDATE_FIELDS) if (g[f] !== undefined) m[f] = g[f]; setMapping(m); } else if (r.error !== 'cancelled') setMsg(r.message ?? 'تعذّرت قراءة الملف.');
  }
  async function preview() { setBusy(true); setMsg(null); const r = await call<Prev | { ok: false; problems?: string[] }>('import.updatePreview', { mapping }); setBusy(false); if (r.ok) setPrev(r); else { setPrev(null); setMsg(r.problems?.join(' ') ?? 'تعذّرت المعاينة.'); } }
  async function commit() {
    setBusy(true); setMsg(null); const r = await call<{ ok: true; updated: number; skipped: number } | { ok: false; error: string }>('import.updateCommit', { mapping, skipInvalid: skip }); setBusy(false);
    if (r.ok) { setDone(r); setPrev(null); } else setMsg(r.error === 'invalid' ? 'في الملف صفوف بها مشاكل. صحّحوها أو فعّلوا «تجاهل الصفوف التي بها مشاكل».' : r.error === 'nothing_to_import' ? 'لا يوجد ما يُحدَّث: البيانات مطابقة لما في البرنامج.' : 'تعذّر التحديث. لم يتغير شيء.');
  }
  return (
    <div className="import">
      <button className="btn quiet back" onClick={onBack}>→ الطلاب</button>
      <h2>تحديث بيانات طلاب موجودين من Excel</h2>
      <p className="helper">للطلاب المسجَّلين أصلاً: يُعرَّف الطالب برقمه، ويُحدَّث تاريخ ميلاده أو هاتفه أو تاريخ انضمامه. لا يُنشأ طالب جديد، والخلية الفارغة لا تمحو شيئاً، وكل تغيير يُسجَّل في سجل الطالب.</p>
      {msg && <div className="banner error" role="alert">{msg}</div>}
      {done && <div className="banner info" role="status">تم تحديث <span className="num">{done.updated}</span> طالباً، وتُجوهل <span className="num">{done.skipped}</span> صف.</div>}
      <p><button className="btn primary" onClick={pick} disabled={busy}>{file ? 'اختيار ملف آخر' : 'اختيار ملف Excel'}</button></p>
      {file && !done && (
        <>
          <section className="inline-panel"><h3>الأعمدة ({file.fileName} — <span className="num">{file.rowCount}</span> صف)</h3>
            <div className="grid2">{UPDATE_FIELDS.map((f: UpdateField) => (
              <div className="field" key={f}><label htmlFor={'uf' + f}>{UPDATE_FIELD_AR[f]}</label>
                <select id={'uf' + f} value={mapping[f] ?? ''} onChange={(e) => { const m = { ...mapping }; if (e.target.value === '') delete m[f]; else m[f] = Number(e.target.value); setMapping(m); setPrev(null); }}><option value="">— بلا عمود —</option>{file.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}</select></div>))}</div>
            <div className="row"><button className="btn primary" disabled={busy} onClick={preview}>معاينة</button></div>
          </section>
          {prev && (
            <section className="inline-panel"><h3>المعاينة: سيُحدَّث <span className="num">{prev.toUpdate}</span>، ومطابق أصلاً <span className="num">{prev.unchanged}</span>، وبه مشاكل <span className="num">{prev.withIssues}</span></h3>
              {Object.keys(prev.issueCounts).length > 0 && <ul>{Object.entries(prev.issueCounts).map(([k, n]) => <li key={k}>{prev.issueText[k] ?? k}: <span className="num">{n}</span></li>)}</ul>}
              <div className="grid-wrap"><table className="grid" aria-label="معاينة التحديث"><thead><tr><th scope="col">الصف</th><th scope="col">الرقم</th><th scope="col">الطالب</th><th scope="col">سيتغير</th><th scope="col">مشاكل</th></tr></thead>
                <tbody>{prev.rows.map((r) => <tr key={r.row}><td className="num">{r.row}</td><td className="num">{r.studentNo}</td><td>{r.name || '—'}</td><td>{Object.entries(r.changes).map(([k, v]) => `${CH_AR[k] ?? k}: ${v}`).join('، ')}</td><td>{r.issues.map((i) => prev.issueText[i] ?? i).join('، ')}</td></tr>)}</tbody></table></div>
              {prev.withIssues > 0 && <label className="check"><input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} /> تجاهل الصفوف التي بها مشاكل (<span className="num">{prev.withIssues}</span>) وتحديث الباقي</label>}
              <div className="row"><button className="btn primary" disabled={busy || prev.toUpdate === 0 || (prev.withIssues > 0 && !skip)} onClick={commit}>تحديث الطلاب</button></div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
