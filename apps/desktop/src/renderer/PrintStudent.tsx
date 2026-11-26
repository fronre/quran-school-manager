import { PrintHead, PrintSurahMap } from './PrintKit';
import { useEffect, useState } from 'react';
import { RELATION_AR, prettyPhone, MEMO_TYPE_AR } from '@mishkat/domain';
import { STATUS_LABEL, type StudentRow } from './api';

const call = <T,>(channel: string, payload?: unknown) => window.mishkat.invoke(channel, payload) as Promise<T>;
interface Data {
  group: { name: string; since: string } | null; guardians: { name: string; phone: string; relation: keyof typeof RELATION_AR; isPrimary: boolean }[]; att: { present: number; late: number; excused: number; absent: number; recorded: number } | null;
  memo: { summary: { memorizedAyat: number; totalAyat: number; wholeSurahs: number; pieces: { surah: number; name: string; from: number; to: number; whole: boolean }[]; counts: { new: number; revision: number; consolidation: number } }; records: { date: string; type: 'new' | 'revision' | 'consolidation'; rangeText: string; evalLabel: string | null; voided: boolean }[] } | null;
}

/** One-page printed summary of a student for the guardian: details, group, attendance and memorization. Fees are not included: the finance section has its own password. */
export function PrintStudentButton({ row, association }: { row: StudentRow; association: string }) {
  const [data, setData] = useState<Data | null>(null); const [busy, setBusy] = useState(false);
  async function start() {
    setBusy(true);
    const [g, gu, at, me] = await Promise.all([call<{ info: { current: { name: string; since: string } | null } | null }>('groups.ofStudent', { studentId: row.id }), call<{ rows: Data['guardians'] | null }>('guardians.list', { studentId: row.id }),
      call<{ totals: Data['att'] }>('attendance.ofStudent', { studentId: row.id }), call<{ progress: Data['memo'] }>('memo.progress', { studentId: row.id })]).catch(() => [null, null, null, null] as const);
    setBusy(false); setData({ group: g?.info?.current ?? null, guardians: gu?.rows ?? [], att: at?.totals ?? null, memo: me?.progress ?? null });
  }
  useEffect(() => { if (data) { const t = setTimeout(() => { window.print(); setData(null); }, 200); return () => clearTimeout(t); } }, [data]);
  return (
    <>
      <button className="btn" onClick={start} disabled={busy}>{busy ? 'جارٍ التحضير…' : 'طباعة كشف الطالب'}</button>
      {data && (
        <div className="print-sheet" dir="rtl">
          <PrintHead assoc={association} title="كشف الطالب" sub={`${row.givenName} ${row.familyName}`} />
          <table><tbody>
            <tr><th>الاسم</th><td>{row.givenName} {row.familyName}</td><th>رقم الطالب</th><td className="num">{row.studentNo}</td></tr>
            <tr><th>الفرع</th><td>{row.branchName}</td><th>الحالة</th><td>{STATUS_LABEL[row.status]}</td></tr>
            <tr><th>الفوج</th><td>{data.group ? data.group.name : 'غير مسجّل في فوج'}</td><th>تاريخ الميلاد</th><td className="num">{row.birthDate ?? '—'}</td></tr>
            {data.guardians.length > 0 && <tr><th>الأولياء</th><td colSpan={3}>{data.guardians.map((g, i) => <span key={i}>{i > 0 ? ' — ' : ''}{g.name} ({RELATION_AR[g.relation]}) <span className="num">{prettyPhone(g.phone)}</span></span>)}</td></tr>}
          </tbody></table>
          {data.att && data.att.recorded > 0 && <><h2>الحضور هذا العام</h2><p>حضور <span className="num">{data.att.present}</span> · تأخر <span className="num">{data.att.late}</span> · غياب <span className="num">{data.att.absent}</span> · غياب بعذر <span className="num">{data.att.excused}</span> من <span className="num">{data.att.recorded}</span> يوماً مسجَّلاً.</p></>}
          {data.memo && (
            <><h2>الحفظ</h2><p>الآيات المحفوظة: <span className="num">{data.memo.summary.memorizedAyat}</span> من <span className="num">{data.memo.summary.totalAyat}</span> — سور كاملة: <span className="num">{data.memo.summary.wholeSurahs}</span>.
              {data.memo.summary.pieces.length > 0 && <> المحفوظ: {data.memo.summary.pieces.map((p) => `${p.name} ${p.whole ? '(كاملة)' : `${p.from}–${p.to}`}`).join('، ')}.</>}</p>
              <PrintSurahMap pieces={data.memo.summary.pieces} />
              {data.memo.records.filter((r) => !r.voided).length > 0 && <table><thead><tr><th>التاريخ</th><th>النوع</th><th>المدى</th><th>التقدير</th></tr></thead>
                <tbody>{data.memo.records.filter((r) => !r.voided).slice(0, 12).map((r, i) => <tr key={i}><td className="num">{r.date}</td><td>{MEMO_TYPE_AR[r.type]}</td><td>{r.rangeText}</td><td>{r.evalLabel ?? '—'}</td></tr>)}</tbody></table>}</>
          )}
          <p style={{ marginTop: '18mm' }}>توقيع الإدارة: ................................</p>
        </div>
      )}
    </>
  );
}
