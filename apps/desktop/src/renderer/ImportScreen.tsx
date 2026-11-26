import { useEffect, useMemo, useRef, useState } from 'react';
import { IMPORT_FIELD_AR, IMPORT_ISSUE_AR, IMPORT_WARNING_AR, STUDENT_STATUSES, type StudentField, type StudentStatus, type ImportIssueCode } from '@mishkat/domain';
import { api, studentsWord, STATUS_LABEL, type ImportFileResult, type ImportMapping, type ImportPreviewResult, type UserView } from './api';

type Loaded = Extract<ImportFileResult, { ok: true }>;
type Preview = Extract<ImportPreviewResult, { ok: true }>;

const FIELD_ORDER: StudentField[] = ['studentNo', 'fullName', 'givenName', 'familyName', 'birthDate', 'phone', 'branch', 'status', 'joinedOn'];
const FIELD_HELP: Partial<Record<StudentField, string>> = {
  fullName: 'اختاروه إن كان الاسم واللقب في عمود واحد.', givenName: 'استخدموه مع عمود اللقب إن كانا منفصلين.', studentNo: 'إن تُرك فارغاً يعطي البرنامج أرقاماً تلقائية.',
  branch: 'إن لم يوجد عمود للفرع فاختاروا فرعاً لكل الصفوف أدناه.', status: 'إن لم يوجد عمود للحالة يُسجَّل الجميع بالحالة المختارة أدناه.',
};
const PROBLEM_TEXT: Record<string, string> = {
  name_columns_missing: 'اختاروا عمود «الاسم الكامل»، أو عمودَي «الاسم» و«اللقب».',
  column_used_twice: 'اخترتم العمود نفسه لحقلين. لكل حقل عمود مختلف.',
  full_name_and_parts: 'اخترتم «الاسم الكامل» مع «الاسم» أو «اللقب». اختاروا أحد الخيارين فقط.',
};
const COMMIT_ERROR: Record<string, string> = {
  has_issues: 'في الملف صفوف بها مشاكل. صحّحوها في Excel، أو اختاروا استيراد الصفوف السليمة فقط.',
  nothing_to_import: 'لا توجد صفوف سليمة لاستيرادها.',
  backup_not_configured: 'لم يُضبط مجلد النسخ الاحتياطية. لن يُستورد شيء قبل نسخة احتياطية. راجعوا قسم النسخ الاحتياطي.',
  backup_failed: 'تعذّر إنشاء النسخة الاحتياطية قبل الاستيراد، لذلك لم يُستورد شيء. تأكدوا أن المجلد متاح ثم أعيدوا المحاولة. بياناتكم الحالية سليمة.',
  no_file: 'انتهت جلسة الملف. اختاروا الملف من جديد.', forbidden: 'الاستيراد غير متاح لحسابكم.', duplicate_number: 'تغيّرت أرقام الطلاب أثناء المراجعة. أعيدوا المراجعة.',
  invalid: 'تغيّرت بيانات الصفوف أثناء المراجعة. أعيدوا المراجعة.', branch_not_found: 'أحد الفروع لم يعد متاحاً.', too_many: 'عدد الصفوف أكبر من المسموح.',
};

function useDebounced<T>(v: T, ms: number): T { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]); return d; }

export function ImportScreen({ user, scope, onDone }: { user: UserView; scope: string; onDone: () => void }) {
  const [file, setFile] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [nameOrder, setNameOrder] = useState<'given-first' | 'family-first'>('given-first');
  const [defaultBranchId, setDefaultBranchId] = useState<string>('');
  const [defaultStatus, setDefaultStatus] = useState<StudentStatus>('active');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const seq = useRef(0);

  const options = useMemo(() => ({ mapping, nameOrder, defaultBranchId: defaultBranchId || null, defaultStatus }), [mapping, nameOrder, defaultBranchId, defaultStatus]);
  const debounced = useDebounced(options, 250);

  useEffect(() => {
    if (!file) return; const my = ++seq.current;
    api.importPreview(debounced).then((r) => {
      if (my !== seq.current) return;
      if (r.ok) { setPreview(r); setProblems([]); } else { setPreview(null); setProblems(r.problems ?? []); }
    });
  }, [file, debounced]);

  async function pick(sheetIndex?: number) {
    setError(null); setNote(null); setResult(null); setBusy(true);
    const r = await api.importPick(sheetIndex); setBusy(false);
    if (!r.ok) { if (r.error !== 'cancelled') setError(r.message ?? 'تعذّر فتح الملف.'); return; }
    setFile(r); setMapping(r.mapping); setPreview(null); setConfirming(false);
    setDefaultBranchId(scope && r.branches.some((b) => b.id === scope) ? scope : r.branches.length === 1 ? r.branches[0]!.id : '');
  }
  const setField = (f: StudentField, v: string) => setMapping((m) => { const n = { ...m }; if (v === '') delete n[f]; else n[f] = Number(v); return n; });

  async function saveErrors() { setNote(null); const r = await api.importSaveErrors(options); if (r.ok) setNote(`تم حفظ ملف الأخطاء (${r.count} صفاً). صحّحوها في Excel ثم اختاروا الملف من جديد.`); }
  async function commit() {
    setBusy(true); setError(null);
    const r = await api.importCommit(options, (preview?.withIssues ?? 0) > 0);
    setBusy(false); setConfirming(false);
    if (r.ok) { setResult({ imported: r.imported, skipped: r.skipped }); setFile(null); setPreview(null); return; }
    setError(COMMIT_ERROR[r.error] ?? 'تعذّر الاستيراد. لم يُحفظ شيء.');
  }

  const branchName = (id: string) => user.branches.find((b) => b.id === id)?.name ?? '';
  const needsOrder = mapping.fullName !== undefined;
  const ready = !!preview && problems.length === 0 && preview.valid > 0;
  const toImport = preview?.valid ?? 0;

  if (result) return (
    <div className="import">
      <div className="empty">
        <div className="niche" aria-hidden="true" />
        <h2>تم استيراد {result.imported} {studentsWord(result.imported)}</h2>
        <p>{result.skipped > 0 ? `تُركت ${result.skipped} صفوف بها مشاكل. ` : ''}أُخذت نسخة احتياطية موثّقة قبل الاستيراد، ويمكنكم الرجوع إليها من قسم النسخ الاحتياطي.</p>
        <button className="btn primary" onClick={onDone}>عرض الطلاب</button>
        <button className="btn" onClick={() => setResult(null)}>استيراد ملف آخر</button>
      </div>
    </div>
  );

  return (
    <div className="import">
      <section className="step-box">
        <h2>١. اختيار الملف</h2>
        <p className="helper">ملف Excel بصيغة xlsx أو CSV فيه قائمة الطلاب. العناوين في أول سطر. لا يُغيَّر الملف الأصلي أبداً.</p>
        {!file ? <button className="btn primary" onClick={() => pick()} disabled={busy}>{busy ? 'جارٍ القراءة…' : 'اختيار ملف'}</button> : (
          <div className="file-line">
            <b>{file.fileName}</b><span className="helper"><span className="num">{file.rowCount}</span> صفاً</span>
            {file.sheetNames.length > 1 && <label className="inline">الورقة <select value={file.sheetName} onChange={(e) => pick(file.sheetNames.indexOf(e.target.value))}>{file.sheetNames.map((n) => <option key={n}>{n}</option>)}</select></label>}
            <button className="btn" onClick={() => pick()} disabled={busy}>ملف آخر</button>
          </div>
        )}
        {error && <div className="banner error" role="alert">{error}</div>}
        {note && <div className="banner info">{note}</div>}
      </section>

      {file && (
        <section className="step-box">
          <h2>٢. ربط الأعمدة</h2>
          <p className="helper">ربط البرنامج الأعمدة تلقائياً من عناوينها. راجعوه وصحّحوا ما يلزم، والنتيجة تظهر أدناه فوراً.</p>
          {problems.length > 0 && <div className="banner warn" role="alert">{problems.map((p) => PROBLEM_TEXT[p] ?? p).join(' ')}</div>}
          <table className="map">
            <thead><tr><th scope="col">الحقل في البرنامج</th><th scope="col">العمود في ملفكم</th><th scope="col">مثال من الملف</th></tr></thead>
            <tbody>
              {FIELD_ORDER.map((f) => (
                <tr key={f}>
                  <th scope="row">{IMPORT_FIELD_AR[f]}{FIELD_HELP[f] && <div className="helper">{FIELD_HELP[f]}</div>}</th>
                  <td><select aria-label={IMPORT_FIELD_AR[f]} value={mapping[f] ?? ''} onChange={(e) => setField(f, e.target.value)}><option value="">— لا يوجد —</option>{file.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}</select></td>
                  <td className="sample">{mapping[f] !== undefined ? file.sample.map((r) => r[mapping[f]!]).filter(Boolean).slice(0, 3).map((v, i) => <span key={i}>{i > 0 && ' ، '}<bdi className="sample-val">{v}</bdi></span>) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="opts">
            {needsOrder && <label className="field"><span>ترتيب الاسم الكامل في ملفكم</span><select value={nameOrder} onChange={(e) => setNameOrder(e.target.value as 'given-first' | 'family-first')}><option value="given-first">الاسم ثم اللقب (أحمد بن عمر)</option><option value="family-first">اللقب ثم الاسم (بن عمر أحمد)</option></select></label>}
            <label className="field"><span>الفرع عند غياب العمود أو فراغ الخلية</span><select value={defaultBranchId} onChange={(e) => setDefaultBranchId(e.target.value)}><option value="">— بلا فرع افتراضي —</option>{file.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
            <label className="field"><span>الحالة عند غياب العمود أو فراغ الخلية</span><select value={defaultStatus} onChange={(e) => setDefaultStatus(e.target.value as StudentStatus)}>{STUDENT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
          </div>
        </section>
      )}

      {file && preview && (
        <section className="step-box">
          <h2>٣. المراجعة قبل الاستيراد</h2>
          <div className="sum" aria-live="polite">
            <span className="badge ok"><i aria-hidden="true" /><span className="num">{preview.valid}</span> سليمة</span>
            <span className={`badge ${preview.withIssues ? 'bad' : 'neutral'}`}><i aria-hidden="true" /><span className="num">{preview.withIssues}</span> بها مشاكل</span>
            {preview.withWarnings > 0 && <span className="badge warn"><i aria-hidden="true" /><span className="num">{preview.withWarnings}</span> تنبيه تكرار محتمل</span>}
            <span className="helper">من أصل <span className="num">{preview.total}</span> صفاً</span>
          </div>
          {preview.withIssues > 0 && <div className="banner warn">الصفوف التي بها مشاكل لن تُستورد، وتظهر أولاً في القائمة. يمكنكم تنزيلها مع أسباب كل خطأ، وتصحيحها، ثم استيراد الملف من جديد.</div>}
          <div className="grid-wrap">
            <table className="grid" aria-label="معاينة الاستيراد">
              <thead><tr><th scope="col">الصف</th><th scope="col">الاسم</th><th scope="col">الرقم</th><th scope="col">الفرع</th><th scope="col">الملاحظات</th></tr></thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.row} className={r.issues.length ? 'row-bad' : ''}>
                    <td className="num">{r.row}</td><td><b>{r.name || '—'}</b></td><td className="num">{r.studentNo}</td><td>{branchName(r.branchId) || '—'}</td>
                    <td>
                      {r.issues.map((i, n) => <div key={n} className="issue">{IMPORT_FIELD_AR[(i.field === 'branchId' ? 'branch' : i.field) as StudentField] ?? i.field}: {IMPORT_ISSUE_AR[i.code as ImportIssueCode] ?? i.code}</div>)}
                      {r.warnings.map((w, n) => <div key={n} className="warnline">{IMPORT_WARNING_AR[w.code as keyof typeof IMPORT_WARNING_AR]}{w.withRow ? ` (الصف ${w.withRow})` : ''}</div>)}
                      {!r.issues.length && !r.warnings.length && <span className="helper">سليم</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="grid-foot"><span>{preview.total > preview.rows.length ? `المعروض ${preview.rows.length} صفاً: المشاكل أولاً ثم عيّنة من السليمة.` : ''}</span></div>
          </div>

          {confirming ? (
            <div className="confirm">
              <p><b>سيأخذ البرنامج نسخة احتياطية موثّقة أولاً</b>، ثم يستورد <span className="num">{toImport}</span> {studentsWord(toImport)}. إن فشل أي شيء فلن يُحفظ منهم أحد. للتراجع بعد الاستيراد تُستعاد النسخة الاحتياطية.</p>
              <div className="row-actions"><button className="btn" onClick={() => setConfirming(false)} disabled={busy}>إلغاء</button><button className="btn primary" onClick={commit} disabled={busy}>{busy ? 'جارٍ الاستيراد…' : `استيراد ${toImport} ${studentsWord(toImport)}`}</button></div>
            </div>
          ) : (
            <div className="row-actions">
              <button className="btn primary" disabled={!ready || busy} onClick={() => setConfirming(true)}>{preview.withIssues ? `استيراد الصفوف السليمة (${toImport})` : `استيراد ${toImport} ${studentsWord(toImport)}`}</button>
              {preview.withIssues > 0 && <button className="btn" onClick={saveErrors}>تنزيل ملف الأخطاء</button>}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
