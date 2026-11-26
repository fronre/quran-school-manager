import { useEffect, useState, type ReactNode } from 'react';
import { api, actionLabel, fieldLabel, PHOTO_ERROR_TEXT, type ActivityRow, type PhotoData } from './api';

export const photoSrc = (p: PhotoData): string => `data:${p.mime};base64,${p.base64}`;
const initials = (given: string, family: string) => `${[...given.trim()][0] ?? ''}${[...family.trim()][0] ?? ''}`;

/** A round picture: the stored photo when there is one, otherwise the initials. */
export function Avatar({ given, family, photo, size = 44 }: { given: string; family: string; photo?: PhotoData | null; size?: number }) {
  return photo
    ? <img className="avatar" src={photoSrc(photo)} alt="" width={size} height={size} />
    : <span className="avatar initials" aria-hidden="true">{initials(given, family)}</span>;
}

/** Photo block of a profile. Adding a photo needs a consent statement typed first (BR-022); the file is chosen in a Windows dialog. */
export function PhotoBox({ kind, id, given, family, canEdit, onChanged, consentLabel }: { kind: 'student' | 'staff'; id: string; given: string; family: string; canEdit: boolean; onChanged?: () => void; consentLabel: string }) {
  const [photo, setPhoto] = useState<PhotoData | null | undefined>(undefined);
  const [consent, setConsent] = useState(''); const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; api.photoGet(kind, id).then((r) => { if (live) setPhoto(r.photo); }); return () => { live = false; }; }, [kind, id]);

  async function pick() {
    setErr(null); setBusy(true); const r = await api.photoPick(kind, id, consent); setBusy(false);
    if (r.ok) { setPhoto(r.photo ?? null); setOpen(false); setConsent(''); onChanged?.(); return; }
    if (r.error !== 'cancelled') setErr(PHOTO_ERROR_TEXT[r.error ?? ''] ?? 'تعذّر حفظ الصورة.');
  }
  async function remove() { setBusy(true); const r = await api.photoRemove(kind, id); setBusy(false); if (r.ok) { setPhoto(null); onChanged?.(); } else setErr(PHOTO_ERROR_TEXT[r.error ?? ''] ?? 'تعذّر حذف الصورة.'); }

  return (
    <div className="photo-box">
      <div className="photo-frame">{photo ? <img src={photoSrc(photo)} alt="الصورة الشخصية" /> : <span className="initials big" aria-hidden="true">{initials(given, family)}</span>}</div>
      {canEdit && !open && (
        <div className="photo-actions">
          <button className="btn" onClick={() => setOpen(true)} disabled={busy}>{photo ? 'تغيير الصورة' : 'إضافة صورة'}</button>
          {photo && <button className="btn quiet" onClick={remove} disabled={busy}>حذف الصورة</button>}
        </div>
      )}
      {open && (
        <div className="photo-consent">
          <p className="helper">لا تُحفظ الصورة إلا بموافقة صاحبها. اكتبوا من وافق، ثم اختاروا الصورة.</p>
          <label htmlFor={`pc-${id}`} className="small-label">{consentLabel}</label>
          <input id={`pc-${id}`} value={consent} onChange={(e) => setConsent(e.target.value)} placeholder="مثال: ولي الأمر" autoFocus />
          {err && <p className="field-error" role="alert">{err}</p>}
          <div className="row-actions"><button className="btn" onClick={() => { setOpen(false); setErr(null); }}>إلغاء</button><button className="btn primary" onClick={pick} disabled={busy || !consent.trim()}>اختيار صورة</button></div>
        </div>
      )}
      {!open && err && <p className="field-error" role="alert">{err}</p>}
      {photo && <p className="helper">تُصغَّر الصورة وتُقصّ مربّعة، ولا يُحفظ الملف الأصلي.</p>}
    </div>
  );
}

const fmt = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

/** "What happened to this record": newest first. The login is shared for now, so the person is not named. */
export function Activity({ kind, id, refreshKey }: { kind: 'student' | 'staff'; id: string; refreshKey: number }) {
  const [rows, setRows] = useState<ActivityRow[] | null | undefined>(undefined);
  useEffect(() => { let live = true; api.profileActivity(kind, id).then((r) => { if (live) setRows(r.rows); }); return () => { live = false; }; }, [kind, id, refreshKey]);
  if (rows === undefined) return null;
  if (!rows || rows.length === 0) return <p className="helper">لا يوجد سجل بعد.</p>;
  return (
    <ol className="timeline" aria-label="سجل النشاط">
      {rows.map((r) => (
        <li key={r.seq}>
          <span className="when num">{fmt(r.at)}</span>
          <div><b>{actionLabel(r.action)}</b>
            {r.changes.length > 0 && <div className="helper">تغيّر: {r.changes.map(fieldLabel).join('، ')}</div>}
            {r.reason && <div className="helper">السبب: {r.reason}</div>}</div>
        </li>
      ))}
    </ol>
  );
}

/** Shared frame of a profile page: back link, photo, headline and tabs. */
export function ProfileFrame({ onBack, backLabel, aside, children, tabs, tab, onTab, headline, badges }: {
  onBack: () => void; backLabel: string; aside: ReactNode; children: ReactNode; tabs: [string, string][]; tab: string; onTab: (t: string) => void; headline: ReactNode; badges?: ReactNode;
}) {
  return (
    <div className="profile">
      <button className="btn quiet back" onClick={onBack}>→ {backLabel}</button>
      <div className="profile-grid">
        <aside className="profile-aside">{aside}</aside>
        <section className="profile-main">
          <header className="profile-head"><h2>{headline}</h2>{badges}</header>
          <div className="tabs" role="tablist">{tabs.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => onTab(k)}>{label}</button>)}</div>
          {children}
        </section>
      </div>
    </div>
  );
}
