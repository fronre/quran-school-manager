// Builds a DEMO database (clearly separate from real data) by calling the real use cases of the product with a back-dated clock.
// Run through scripts/demo.mjs (bundled with esbuild, executed by Electron so that DPAPI and the native modules behave as in the real app).
import { app, safeStorage } from 'electron';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import {
  openDb, migrate, runSetup, generateRecoveryKey, saveRecoveryKey, createBackup, createStudent, createStaff, createGroup, assignTeacher, enrollStudent, addGuardian, archiveStudent, saveSheet, cancelSession, correctRecord,
  recordMemorization, voidMemorization, setFinancePassword, setRate, recordPayment, cancelPayment, getSheet, listGroups, verifyAuditLog, type Ctx, type Protector,
} from '@mishkat/db';
import { SURAHS, type Assignment } from '@mishkat/domain';

const demoRoot = process.env.MISHKAT_DEMO_DIR!; const dist = process.env.MISHKAT_DIST!;
app.setPath('userData', demoRoot);
const PASSWORD = 'sidi-aoun-test-2026-pass';

// ---- deterministic randomness, so every run gives the same demo
let seed = 20261120; const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!;
const weighted = <T,>(items: readonly (readonly [T, number])[]): T => { let r = rnd() * items.reduce((s, i) => s + i[1], 0); for (const [v, w] of items) { r -= w; if (r <= 0) return v; } return items[0]![0]; };

const MALE = ['محمد', 'أحمد', 'يوسف', 'عبد الرحمن', 'إبراهيم', 'إسماعيل', 'عمر', 'بلال', 'حمزة', 'أنس', 'زكرياء', 'ياسين', 'سليمان', 'عبد القادر', 'مصطفى', 'إلياس', 'خالد', 'رضا', 'أيوب', 'نوح', 'عثمان', 'طه', 'سعد', 'أسامة', 'عبد الله', 'معاذ', 'مهدي', 'صلاح', 'ريان', 'وليد'];
const FEMALE = ['فاطمة', 'خديجة', 'عائشة', 'مريم', 'آسية', 'سمية', 'هاجر', 'إيمان', 'سارة', 'أميرة', 'نور الهدى', 'رقية', 'زينب', 'حفصة', 'أسماء', 'ليلى', 'جميلة', 'سلمى', 'ياسمين', 'ملاك', 'رحمة', 'آلاء', 'شيماء', 'نهى', 'دعاء'];
const FAMILY = ['بن علي', 'بوعلام', 'مسعودي', 'قاسمي', 'زيداني', 'حمادي', 'بلقاسم', 'بوزيد', 'شريف', 'عمراني', 'سعدي', 'خليفي', 'بن عمر', 'بوقرة', 'مداني', 'طالبي', 'لعرابي', 'بن شيخ', 'حداد', 'كريم'];
const GUARD_M = ['محمد', 'علي', 'أحمد', 'عبد الحميد', 'الطاهر', 'مبروك', 'بشير', 'رابح', 'لخضر', 'جمال', 'نور الدين', 'مولود'];
const GUARD_F = ['فتيحة', 'نادية', 'سعاد', 'ليلى', 'حورية', 'زهرة', 'وردة', 'كريمة', 'نصيرة', 'سميرة'];
const mobile = () => `0${pick([5, 6, 7])}${String(Math.floor(rnd() * 1e8)).padStart(8, '0')}`;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

app.whenReady().then(async () => {
  mkdirSync(demoRoot, { recursive: true }); // Electron keeps its own files here (the key store for DPAPI), so only our two folders are recreated
  const dataDir = join(demoRoot, 'data'); const backups = join(demoRoot, 'backups'); rmSync(dataDir, { recursive: true, force: true }); rmSync(backups, { recursive: true, force: true }); rmSync(join(demoRoot, 'seed-error.txt'), { force: true }); mkdirSync(dataDir, { recursive: true });
  const protector: Protector = { available: () => safeStorage.isEncryptionAvailable(), encrypt: (b) => safeStorage.encryptString(b.toString('base64')), decrypt: (b) => Buffer.from(safeStorage.decryptString(b), 'base64') };
  const db = openDb(join(dataDir, 'mishkat.db')); migrate(db, join(dist, 'migrations'));
  const rk = generateRecoveryKey();
  const today = ymd(new Date()); const startDay = '2026-10-01';
  const { tenantId } = runSetup(db, { admin: { givenName: 'مستخدم', familyName: 'تجريبي', username: 'demo', password: PASSWORD }, association: { name: 'جمعية علماء المسلمين في سيدي عون (نسخة تجريبية)', address: 'سيدي عون' },
    branches: [{ name: 'فرع الرجال' }, { name: 'فرع النساء' }], year: { name: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30' } }, rk.key);
  saveRecoveryKey(dataDir, protector, rk.key); writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ backupFolder: backups, secondFolder: null }));
  const [men, women] = (db.prepare('SELECT id FROM branch ORDER BY position').all() as { id: string }[]).map((b) => b.id) as [string, string];

  let day = today;
  const ctx = (a: Assignment[]): Ctx => ({ db, tenantId, actorId: 'demo', assignments: a, now: () => day + 'T08:00:00.000Z' });
  const dir = ctx([{ role: 'director', branchId: null }]);
  const must = <R extends { ok: boolean }>(r: R, what: string): Extract<R, { ok: true }> => { if (!r.ok) throw new Error(`${what}: ${JSON.stringify(r)}`); return r as Extract<R, { ok: true }>; };

  // ---- teachers
  const teacher = (b: string, g: string, f: string, kind: 'employee' | 'volunteer' = 'employee') => must(createStaff(dir, { givenName: g, familyName: f, birthDate: null, phone: mobile(), branchId: b, position: 'teacher', kind }), 'teacher').id;
  const tM = [teacher(men, 'عبد الحفيظ', 'بوزيد'), teacher(men, 'مصطفى', 'قاسمي'), teacher(men, 'ياسين', 'حمادي', 'volunteer'), teacher(men, 'عبد الله', 'مداني')];
  const tW = [teacher(women, 'خديجة', 'بلقاسم'), teacher(women, 'آسية', 'طالبي'), teacher(women, 'سمية', 'بن شيخ', 'volunteer')];
  must(createStaff(dir, { givenName: 'الهادي', familyName: 'سعدي', birthDate: null, phone: mobile(), branchId: men, position: 'supervisor', kind: 'employee' }), 'supervisor');

  // ---- groups
  day = '2026-09-20';
  const mk = (b: string, name: string, level: string, cap: number) => must(createGroup(dir, { branchId: b, name, level, capacity: cap }), 'group').id;
  const gM = [mk(men, 'فوج الفجر', 'مبتدئ', 14), mk(men, 'فوج الإخلاص', 'مبتدئ', 14), mk(men, 'فوج التبيان', 'متوسط', 12), mk(men, 'فوج النور', 'متقدم', 10)];
  const gW = [mk(women, 'فوج الفرقان', 'مبتدئ', 14), mk(women, 'فوج الهدى', 'متوسط', 12), mk(women, 'فوج السكينة', 'متقدم', 10)];
  for (const [g, t] of [[gM[0]!, tM[0]!], [gM[1]!, tM[1]!], [gM[2]!, tM[2]!], [gM[3]!, tM[3]!], [gM[0]!, tM[3]!], [gM[2]!, tM[1]!], [gW[0]!, tW[0]!], [gW[1]!, tW[1]!], [gW[2]!, tW[2]!], [gW[1]!, tW[0]!]] as const) must(assignTeacher(dir, g, t), 'assign');

  // ---- students, guardians, enrollments
  interface S { id: string; branch: string; group: string | null; name: string }
  const students: S[] = []; let n = 0;
  const addStudents = (branch: string, groups: string[], sizes: number[], names: readonly string[], withLoose: number) => {
    let lastFamily = ''; let lastGuardian: { name: string; phone: string } | null = null;
    groups.forEach((g, gi) => {
      for (let k = 0; k < sizes[gi]!; k++) {
        const sibling = k > 0 && rnd() < 0.16 && lastGuardian; const family = sibling ? lastFamily : pick(FAMILY); const given = pick(names);
        day = '2026-10-01'; const joined = rnd() < 0.85 ? '2026-09-05' : '2026-09-28';
        const id = must(createStudent(dir, { givenName: given, familyName: family, birthDate: `${2008 + Math.floor(rnd() * 11)}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`, phone: null, branchId: branch, status: 'active', joinedOn: joined, studentNo: String(++n) }, { ignoreDuplicates: true }), 'student').id;
        students.push({ id, branch, group: g, name: `${given} ${family}` });
        day = startDay; must(enrollStudent(dir, g, id), 'enroll');
        if (rnd() < 0.88) {
          const gu = sibling ? lastGuardian! : { name: `${branch === men ? pick(GUARD_M) : pick(GUARD_F)} ${family}`, phone: rnd() < 0.08 ? '0' + String(20 + Math.floor(rnd() * 9)) + String(Math.floor(rnd() * 1e6)).padStart(6, '0') : mobile() };
          day = today; const r = addGuardian(dir, id, { name: gu.name, phone: gu.phone, relation: branch === men ? 'father' : 'mother', isPrimary: true }); if (r.ok) { lastGuardian = gu; lastFamily = family; }
        }
      }
    });
    for (let k = 0; k < withLoose; k++) { // registered but not yet in a group
      day = '2026-10-12'; const family = pick(FAMILY); const given = pick(names);
      const id = must(createStudent(dir, { givenName: given, familyName: family, birthDate: null, phone: null, branchId: branch, status: 'active', joinedOn: '2026-10-12', studentNo: String(++n) }, { ignoreDuplicates: true }), 'loose').id; students.push({ id, branch, group: null, name: `${given} ${family}` });
    }
  };
  addStudents(men, gM, [12, 11, 9, 7], MALE, 4); addStudents(women, gW, [11, 9, 7], FEMALE, 3);
  // a suspended student and an archived one
  day = '2026-10-20';
  const susp = must(createStudent(dir, { givenName: 'نوح', familyName: 'لعرابي', birthDate: '2012-02-02', phone: null, branchId: men, status: 'suspended', joinedOn: '2026-09-05', studentNo: String(++n) }), 'suspended').id; void susp;
  const gone = must(createStudent(dir, { givenName: 'زكرياء', familyName: 'حداد', birthDate: '2011-03-03', phone: null, branchId: men, status: 'active', joinedOn: '2026-09-05', studentNo: String(++n) }), 'gone').id; must(archiveStudent(dir, gone, 'انتقل إلى ولاية أخرى'), 'archive');

  // ---- attendance on Tuesdays and Thursdays since the start (today is left open for some groups)
  const dates: string[] = []; for (let d = new Date('2026-10-06T00:00:00Z'); ymd(d) < today; d = new Date(d.getTime() + 86400000)) if ([2, 4].includes(d.getUTCDay())) dates.push(ymd(d));
  const allGroups = [...gM, ...gW]; const members = new Map<string, S[]>(); for (const s of students) if (s.group) members.set(s.group, [...(members.get(s.group) ?? []), s]);
  const cancelled = dates.length > 5 ? dates[4]! : '';
  let records = 0, firstRecord: { group: string; date: string } | null = null;
  for (const g of allGroups) for (const d of dates) {
    day = d;
    if (d === cancelled) { must(cancelSession(dir, g, d, 'ظرف طارئ'), 'cancel'); continue; }
    const entries = members.get(g)!.map((s) => { const st = weighted([['present', 78], ['late', 8], ['absent', 9], ['excused', 5]] as const); return { studentId: s.id, status: st, lateMinutes: st === 'late' ? 5 + Math.floor(rnd() * 20) : null, note: st === 'excused' ? 'مرض' : null }; });
    must(saveSheet(dir, g, d, { startTime: '16:00', endTime: '17:30' }, entries), 'sheet'); records += entries.length; firstRecord ??= { group: g, date: d };
  }
  day = today;
  // today: one group complete, one partial, the rest still open (so the home page shows all three states)
  const doneToday = members.get(gM[0]!)!; must(saveSheet(dir, gM[0]!, today, { startTime: '16:00', endTime: '17:30' }, doneToday.map((s) => ({ studentId: s.id, status: 'present' as const }))), 'today done');
  const partial = members.get(gW[0]!)!.slice(0, 5); must(saveSheet(dir, gW[0]!, today, { startTime: '16:00', endTime: '17:30' }, partial.map((s) => ({ studentId: s.id, status: 'present' as const }))), 'today partial');
  // two corrections
  if (firstRecord) { const sh = getSheet(dir, firstRecord.group, firstRecord.date)!; for (const r of sh.rows.filter((x) => x.status === 'absent').slice(0, 2)) { day = today; must(correctRecord(dir, r.recordId!, 'excused', null, 'أحضر شهادة طبية'), 'correct'); } }

  // ---- memorization: students move backwards through the short surahs
  let memo = 0, voided = 0;
  for (const s of students.filter((x) => x.group)) {
    let surah = 114 - Math.floor(rnd() * 8); let ayah = 1; const slots = 2 + Math.floor(rnd() * 5); const useDates = dates.filter((_, i) => i % Math.max(1, Math.floor(dates.length / slots)) === 0).slice(0, slots);
    const mine: { surah: number; from: number; to: number }[] = [];
    for (const d of useDates) {
      day = d; const total = SURAHS[surah - 1]!.ayahCount; const to = Math.min(total, ayah + 4 + Math.floor(rnd() * 8));
      const rank = weighted([[1, 8], [2, 18], [3, 30], [4, 26], [5, 18]] as const);
      const r = recordMemorization(dir, { studentId: s.id, date: d, type: 'new', range: { start: { surah, ayah }, end: { surah, ayah: to } }, evalRank: rank, comment: rank === 1 ? 'يحتاج إلى إعادة' : null }); if (r.ok) { memo++; mine.push({ surah, from: ayah, to }); if (rank === 1 && rnd() < 0.3) { day = today; must(voidMemorization(dir, r.id, 'أُدخل على الطالب الخطأ'), 'void'); voided++; } }
      if (to >= total) { surah = Math.max(1, surah - 1); ayah = 1; } else ayah = to + 1;
      if (mine.length > 1 && rnd() < 0.5) { const p = pick(mine); day = d; const rv = recordMemorization(dir, { studentId: s.id, date: d, type: weighted([['revision', 3], ['consolidation', 1]] as const), range: { start: { surah: p.surah, ayah: p.from }, end: { surah: p.surah, ayah: p.to } }, evalRank: rnd() < 0.6 ? pick([3, 4, 5]) : null }); if (rv.ok) memo++; }
    }
  }

  // ---- fees (finance section protected by its own password)
  day = today; must(setFinancePassword({ db, tenantId, actorId: 'demo', now: () => today + 'T08:00:00.000Z' }, PASSWORD) as never, 'finance password');
  day = '2026-09-01'; must(setRate(dir, '2026-09', 1000), 'rate'); let paid = 0, cancelledPay = 0;
  const months: [string, string, number][] = [['2026-09', '2026-09-12', 0.8], ['2026-10', '2026-10-11', 0.65], ['2026-11', '2026-11-10', 0.4]];
  for (const [m, paidOn, share] of months) for (const s of students) {
    if (rnd() > share) continue; day = paidOn < today ? paidOn : today;
    const r = recordPayment(dir, { studentId: s.id, month: m, paidOn: day, collectorName: 'أمين الصندوق' }); if (r.ok) { paid++; if (rnd() < 0.02) { must(cancelPayment(dir, r.id, 'خطأ في الإدخال'), 'cancel pay'); cancelledPay++; } }
  }

  // ---- a first verified backup, as the real app would have after setup
  day = today; const bk = await createBackup(db, { tenantId, destFile: join(backups, 'mishkat-demo-initial.mshkbk'), key: { kind: 'recovery', key: rk.key }, kind: 'manual', actorId: 'demo' });
  const audit = verifyAuditLog(db); const count = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  const summary = {
    demoRoot, username: 'demo', password: PASSWORD, recoveryKeyShownOnce: rk.display,
    students: count('SELECT count(*) c FROM student'), teachers: count("SELECT count(*) c FROM staff_member WHERE position = 'teacher'"), groups: allGroups.length, enrollments: count('SELECT count(*) c FROM enrollment'),
    guardians: count('SELECT count(*) c FROM guardian'), sessions: count('SELECT count(*) c FROM session'), attendanceRecords: count('SELECT count(*) c FROM attendance_record'), attendanceCorrections: count('SELECT count(*) c FROM attendance_correction'),
    memorizationRecords: count('SELECT count(*) c FROM memorization_record'), voidedMemorization: voided, payments: count('SELECT count(*) c FROM payment'), cancelledPayments: cancelledPay, auditEntries: count('SELECT count(*) c FROM audit_log'), auditChain: audit.ok, backupOk: bk.ok, groupsListed: listGroups(dir).length, recordsMade: records, memoMade: memo, paidMade: paid,
  };
  writeFileSync(join(demoRoot, 'seed-summary.json'), JSON.stringify(summary, null, 2)); db.close(); app.exit(0);
}).catch((e) => { writeFileSync(join(demoRoot, 'seed-error.txt'), String(e instanceof Error ? e.stack : e)); app.exit(1); });
