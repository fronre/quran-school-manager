import { useEffect, useState } from 'react';
import { CountUp } from './CountUp';
import { api, studentsWord, type UserView } from './api';

interface Counts { total: number; any: number; byBranch: { id: string; name: string; n: number }[]; suspended: number }

export function Home({ user, scope, go }: { user: UserView; scope: string; go: (page: 'students' | 'import' | 'attendance' | 'groups' | 'reports' | 'memo', add?: boolean) => void }) {
  const [today, setToday] = useState<{ date: string; rows: { groupId: string; groupName: string; branchName: string; members: number; recorded: number; state: 'not_recorded' | 'partial' | 'done' | 'cancelled' }[] } | null>(null);
  useEffect(() => { let live = true; (window.mishkat.invoke('home.today') as Promise<typeof today>).then((r) => { if (live) setToday(r); }).catch(() => undefined); return () => { live = false; }; }, [scope]);
  const [c, setC] = useState<Counts | null>(null);
  const canView = user.permissions.includes('student.view');
  const canAdd = user.permissions.includes('student.edit');
  const canImport = user.permissions.includes('import.run');

  useEffect(() => {
    if (!canView) return; let live = true;
    (async () => {
      const all = await api.studentsList({ branchId: scope || undefined, limit: 1 });
      if (!('rows' in all)) return;
      const per = await Promise.all(user.branches.filter((b) => !scope || b.id === scope).map(async (b) => { const r = await api.studentsList({ branchId: b.id, limit: 1 }); return { id: b.id, name: b.name, n: 'rows' in r ? r.total : 0 }; }));
      const susp = await api.studentsList({ branchId: scope || undefined, status: 'suspended', limit: 1 });
      if (live) setC({ total: all.total, any: all.counts.active + all.counts.archived, byBranch: per, suspended: 'rows' in susp ? susp.total : 0 });
    })();
    return () => { live = false; };
  }, [canView, user.branches, scope]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'صباح الخير' : 'مساء الخير';

  if (c && c.any === 0) return (
    <div className="empty">
      <div className="niche" aria-hidden="true" />
      <h2>ابدؤوا بإضافة الطلاب</h2>
      <p>لا يوجد طلاب بعد. أضيفوا الطالب الأول، أو استوردوا القائمة الموجودة عندكم في Excel دفعة واحدة.</p>
      {canAdd && <button className="btn primary" onClick={() => go('students', true)}>إضافة طالب</button>}
      {canImport && <button className="btn" onClick={() => go('import')}>استيراد من Excel</button>}
    </div>
  );

  return (
    <div className="home">
      <div className="home-main">
        <p className="eyebrow-less">{greeting}، {user.displayName}</p>
        <h2 className="home-title">{user.associationName}</h2>
        {canView && (
          <div className="ledger" aria-label="عدد الطلاب">
            <div className="ledger-cell total"><span className="big num">{c ? <CountUp value={c.total} /> : '…'}</span><span className="lbl">{studentsWord(c?.total ?? 0)} حالياً</span></div>
            {!scope && c?.byBranch.map((b) => <div className="ledger-cell" key={b.id}><span className="big num"><CountUp value={b.n} /></span><span className="lbl">{b.name}</span></div>)}
            {!!c?.suspended && <div className="ledger-cell"><span className="big num"><CountUp value={c.suspended} /></span><span className="lbl">حالات إيقاف</span></div>}
          </div>
        )}
        <h3 className="home-sub">ماذا تريدون أن تفعلوا؟</h3>
        <ul className="actions">
          {canView && <li><button onClick={() => go('students')}><b>عرض الطلاب</b><span>بحث وتصفية وتعديل وأرشفة.</span></button></li>}
          {canAdd && <li><button onClick={() => go('students', true)}><b>إضافة طالب</b><span>تسجيل طالب جديد في ثوانٍ.</span></button></li>}
          {canImport && <li><button onClick={() => go('import')}><b>استيراد من Excel</b><span>انقلوا قائمة الطلاب الحالية دفعة واحدة، مع مراجعة قبل الحفظ.</span></button></li>}
          {user.permissions.includes('attendance.view') && <li><button onClick={() => go('attendance')}><b>تسجيل الحضور</b><span>ورقة اليوم لكل فوج.</span></button></li>}
          {user.permissions.includes('memorization.view') && <li><button onClick={() => go('memo')}><b>الحفظ والتقييم</b><span>تسجيل الحفظ والمراجعة ومتابعة التقدم.</span></button></li>}
          {(user.permissions.includes('report.view') || user.permissions.includes('report.view_limited')) && <li><button onClick={() => go('reports')}><b>التقارير</b><span>التسجيل والحضور ونشاط الأفواج، مع تصدير وطباعة.</span></button></li>}
        </ul>
      </div>
      <aside className="home-aside" aria-label="حصص اليوم">
        <h3>اليوم <span className="num">{today?.date ?? ''}</span></h3>
        {!today ? null : today.rows.length === 0 ? <p className="helper">لا أفواج فيها طلاب اليوم. أنشئوا الأفواج وسجّلوا فيها الطلاب لتظهر هنا.</p> : (
          <ul className="today-list">{today.rows.map((r) => (
            <li key={r.groupId}><button onClick={() => go('attendance')}><b>{r.groupName}</b>{!scope && <small>{r.branchName}</small>}
              <span className={`today-${r.state}`}>{r.state === 'done' ? 'سُجّل الحضور' : r.state === 'partial' ? <>ناقص: <span className="num">{r.recorded}</span> من <span className="num">{r.members}</span></> : r.state === 'cancelled' ? 'بلا حصة' : 'لم يُسجَّل بعد'}</span></button></li>))}</ul>
        )}
      </aside>
    </div>
  );
}
