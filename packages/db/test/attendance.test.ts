import { describe, it, expect, beforeEach } from 'vitest';
import type { Assignment } from '@mishkat/domain';
import {
  openDb, migrate, verifyAuditLog, runSetup, generateRecoveryKey, createStudent, createGroup, enrollStudent, leaveGroup, archiveStudent,
  getSheet, saveSheet, cancelSession, correctRecord, groupHistory, studentAttendance, setGroupStatus, type Ctx,
} from '../src';

const FAST = { memoryKiB: 8, passes: 1, parallelism: 1 };
const ok = <R extends { ok: boolean }>(r: R): Extract<R, { ok: true }> => { if (!r.ok) throw new Error('expected ok: ' + JSON.stringify(r)); return r as Extract<R, { ok: true }>; };
const T = { startTime: '16:00', endTime: '17:00' };

function world() {
  const db = openDb(':memory:'); migrate(db);
  const { tenantId } = runSetup(db, { admin: { givenName: 'مستخدم', familyName: 'البرنامج', username: 'user1', password: 'a-long-test-password' }, association: { name: 'جمعية' },
    branches: [{ name: 'فرع الرجال' }, { name: 'فرع النساء' }], year: { name: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30' } }, generateRecoveryKey().key, { argon2: FAST });
  const [men, women] = (db.prepare('SELECT id FROM branch ORDER BY position').all() as { id: string }[]).map((b) => b.id) as [string, string];
  let day = '2026-11-20';
  const ctx = (a: Assignment[]): Ctx => ({ db, tenantId, actorId: 'u1', assignments: a, now: () => day + 'T09:00:00.000Z' });
  const director = ctx([{ role: 'director', branchId: null }]);
  const stu = (b: string, n: number) => ok(createStudent(director, { givenName: 'طالب' + n, familyName: 'اختبار', birthDate: null, phone: null, branchId: b, status: 'active', joinedOn: '2026-09-05', studentNo: 'S' + n })).id;
  const group = ok(createGroup(director, { branchId: men, name: 'فوج أ', level: null, capacity: 10 })).id;
  return { db, men, women, group, director, supMen: ctx([{ role: 'branch_supervisor', branchId: men }]), regMen: ctx([{ role: 'registrar', branchId: men }]), acadMen: ctx([{ role: 'academic_supervisor', branchId: men }]),
    supWomen: ctx([{ role: 'branch_supervisor', branchId: women }]), stu, setDay: (d: string) => { day = d; } };
}

describe('attendance sheet and recording', () => {
  let w: ReturnType<typeof world>; let a: string, b: string, c3: string;
  beforeEach(() => { w = world(); a = w.stu(w.men, 1); b = w.stu(w.men, 2); c3 = w.stu(w.men, 3); w.setDay('2026-10-01'); for (const s of [a, b, c3]) ok(enrollStudent(w.regMen, w.group, s)); w.setDay('2026-11-20'); });

  it('lists the students enrolled on that date, unrecorded', () => {
    const s = getSheet(w.regMen, w.group, '2026-11-20')!; expect(s.session).toBeNull(); expect(s.rows.map((r) => r.studentNo)).toEqual(['S1', 'S2', 'S3']); expect(s.rows.every((r) => r.status === null)).toBe(true);
    expect(getSheet(w.regMen, w.group, '2026-09-20')!.rows).toEqual([]); // nobody was enrolled yet
  });
  it('records a day: creates the held session once, stores late minutes and notes, audits', () => {
    ok(saveSheet(w.regMen, w.group, '2026-11-20', T, [{ studentId: a, status: 'present' }, { studentId: b, status: 'late', lateMinutes: 10, note: 'مطر' }, { studentId: c3, status: 'absent' }]));
    const s = getSheet(w.regMen, w.group, '2026-11-20')!;
    expect(s.session).toMatchObject({ startTime: '16:00', endTime: '17:00', status: 'held' }); expect(s.rows.map((r) => [r.status, r.lateMinutes, r.note, r.enteredLate])).toEqual([['present', null, null, false], ['late', 10, 'مطر', false], ['absent', null, null, false]]);
    expect(w.db.prepare('SELECT count(*) c FROM session').get()).toEqual({ c: 1 }); expect(verifyAuditLog(w.db)).toEqual({ ok: true });
  });
  it('is all-or-nothing and never records the same student twice for a session', () => {
    ok(saveSheet(w.regMen, w.group, '2026-11-20', T, [{ studentId: a, status: 'present' }]));
    expect(saveSheet(w.regMen, w.group, '2026-11-20', T, [{ studentId: a, status: 'absent' }, { studentId: b, status: 'present' }])).toEqual({ ok: false, error: 'already_recorded' });
    expect(w.db.prepare('SELECT count(*) c FROM attendance_record').get()).toEqual({ c: 1 });
    ok(saveSheet(w.regMen, w.group, '2026-11-20', T, [{ studentId: b, status: 'present' }, { studentId: c3, status: 'present' }])); // the rest can be added the same day
    expect(w.db.prepare('SELECT count(*) c FROM session').get()).toEqual({ c: 1 });
  });
  it('rejects bad input, future dates, dates outside the year, closed groups, and strangers', () => {
    const e = [{ studentId: a, status: 'present' as const }];
    expect(saveSheet(w.regMen, w.group, '2026-11-21', T, e)).toEqual({ ok: false, error: 'future_date' }); expect(saveSheet(w.regMen, w.group, '2026-08-01', T, e)).toEqual({ ok: false, error: 'outside_year' });
    for (const bad of [{ startTime: '17:00', endTime: '16:00' }, { startTime: '25:00', endTime: '26:00' }, { startTime: '16:00', endTime: '16:00' }]) expect(saveSheet(w.regMen, w.group, '2026-11-20', bad, e)).toEqual({ ok: false, error: 'invalid' });
    for (const bad of [[], [{ studentId: a, status: 'x' as never }], [{ studentId: a, status: 'present' as const, lateMinutes: 5 }], [{ studentId: a, status: 'late' as const, lateMinutes: 0 }], [{ studentId: a, status: 'present' as const }, { studentId: a, status: 'absent' as const }]]) expect(saveSheet(w.regMen, w.group, '2026-11-20', T, bad)).toEqual({ ok: false, error: 'invalid' });
    expect(saveSheet(w.regMen, w.group, '2026-11-20', T, [{ studentId: 'nope', status: 'present' }])).toEqual({ ok: false, error: 'not_enrolled' });
    expect(saveSheet(w.supWomen, w.group, '2026-11-20', T, e)).toEqual({ ok: false, error: 'not_found' }); expect(saveSheet(w.acadMen, w.group, '2026-11-20', T, e)).toEqual({ ok: false, error: 'forbidden' });
    expect(getSheet(w.supWomen, w.group, '2026-11-20')).toBeNull(); expect(getSheet(w.acadMen, w.group, '2026-11-20')).not.toBeNull();
    expect(getSheet(w.regMen, w.group, 'not-a-date')).toBeNull(); expect(w.db.prepare('SELECT count(*) c FROM session').get()).toEqual({ c: 0 });
  });
  it('a closed group takes no attendance', () => {
    for (const s of [a, b, c3]) ok(leaveGroup(w.regMen, w.group, s, 'x')); ok(setGroupStatus(w.supMen, w.group, 'closed')); expect(saveSheet(w.regMen, w.group, '2026-11-20', T, [{ studentId: a, status: 'present' }])).toMatchObject({ ok: false });
  });
  it('entering a past day is flagged, and only students enrolled that day appear', () => {
    const d = w.stu(w.men, 4); ok(enrollStudent(w.regMen, w.group, d)); // enrolled 2026-11-20
    ok(saveSheet(w.regMen, w.group, '2026-10-15', T, [{ studentId: a, status: 'present' }]));
    expect(getSheet(w.regMen, w.group, '2026-10-15')!.rows.map((r) => [r.studentNo, r.enteredLate])).toEqual([['S1', true], ['S2', false], ['S3', false]]);
    expect(saveSheet(w.regMen, w.group, '2026-10-15', T, [{ studentId: d, status: 'present' }])).toEqual({ ok: false, error: 'not_enrolled' });
  });
  it('students who left the group or were archived do not appear on new sheets, but recorded history stays', () => {
    ok(saveSheet(w.regMen, w.group, '2026-11-20', T, [{ studentId: a, status: 'present' }])); ok(archiveStudent(w.director, a, 'غادر'));
    w.setDay('2026-11-22'); ok(leaveGroup(w.regMen, w.group, b, 'انتقل'));
    expect(getSheet(w.regMen, w.group, '2026-11-22')!.rows.map((r) => r.studentNo)).toEqual(['S3']); expect(getSheet(w.regMen, w.group, '2026-11-20')!.rows.map((r) => r.studentNo)).toEqual(['S1', 'S2', 'S3'].filter((n) => n !== 'S1' || true));
  });
});

describe('no-class days', () => {
  let w: ReturnType<typeof world>; beforeEach(() => { w = world(); const a = w.stu(w.men, 1); w.setDay('2026-10-01'); ok(enrollStudent(w.regMen, w.group, a)); w.setDay('2026-11-20'); });
  it('cancels a day with a reason and then refuses attendance on it', () => {
    expect(cancelSession(w.regMen, w.group, '2026-11-20', ' ')).toEqual({ ok: false, error: 'reason_required' });
    ok(cancelSession(w.regMen, w.group, '2026-11-20', 'عطلة رسمية')); expect(cancelSession(w.regMen, w.group, '2026-11-20', 'x')).toEqual({ ok: false, error: 'already_cancelled' });
    expect(getSheet(w.regMen, w.group, '2026-11-20')!.session).toMatchObject({ status: 'cancelled', cancelReason: 'عطلة رسمية' });
    const id = (w.db.prepare('SELECT id FROM student').get() as { id: string }).id; expect(saveSheet(w.regMen, w.group, '2026-11-20', T, [{ studentId: id, status: 'present' }])).toEqual({ ok: false, error: 'cancelled' });
  });
  it('a day with records cannot be cancelled', () => {
    const id = (w.db.prepare('SELECT id FROM student').get() as { id: string }).id; ok(saveSheet(w.regMen, w.group, '2026-11-20', T, [{ studentId: id, status: 'present' }]));
    expect(cancelSession(w.regMen, w.group, '2026-11-20', 'عطلة')).toEqual({ ok: false, error: 'has_records' }); expect(cancelSession(w.acadMen, w.group, '2026-11-20', 'عطلة')).toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('corrections (explicit records, never silent edits)', () => {
  let w: ReturnType<typeof world>; let rec: string, sid: string;
  beforeEach(() => { w = world(); sid = w.stu(w.men, 1); w.setDay('2026-10-01'); ok(enrollStudent(w.regMen, w.group, sid)); w.setDay('2026-11-20'); ok(saveSheet(w.regMen, w.group, '2026-11-20', T, [{ studentId: sid, status: 'absent' }])); rec = getSheet(w.regMen, w.group, '2026-11-20')!.rows[0]!.recordId!; });
  it('writes a correction row with old/new/reason and updates the record', () => {
    ok(correctRecord(w.supMen, rec, 'excused', null, 'أحضر شهادة طبية'));
    expect(w.db.prepare('SELECT old_status o, new_status n, reason r FROM attendance_correction').all()).toEqual([{ o: 'absent', n: 'excused', r: 'أحضر شهادة طبية' }]);
    expect(getSheet(w.regMen, w.group, '2026-11-20')!.rows[0]!.status).toBe('excused'); expect(verifyAuditLog(w.db)).toEqual({ ok: true });
  });
  it('needs a reason, a real change, the correct permission, and visibility', () => {
    expect(correctRecord(w.supMen, rec, 'present', null, '  ')).toEqual({ ok: false, error: 'reason_required' }); expect(correctRecord(w.supMen, rec, 'absent', null, 'x')).toEqual({ ok: false, error: 'same_status' });
    expect(correctRecord(w.regMen, rec, 'present', null, 'x')).toEqual({ ok: false, error: 'forbidden' }); expect(correctRecord(w.acadMen, rec, 'present', null, 'x')).toEqual({ ok: false, error: 'forbidden' });
    expect(correctRecord(w.supWomen, rec, 'present', null, 'x')).toEqual({ ok: false, error: 'not_found' }); expect(correctRecord(w.supMen, rec, 'present', 5, 'x')).toEqual({ ok: false, error: 'invalid' });
    expect(w.db.prepare('SELECT count(*) c FROM attendance_correction').get()).toEqual({ c: 0 });
  });
  it('changing only the minutes of a late record updates it without a status-change row', () => {
    ok(correctRecord(w.supMen, rec, 'late', 5, 'وصل متأخراً')); ok(correctRecord(w.supMen, rec, 'late', 15, 'صحّحنا المدة'));
    expect(w.db.prepare('SELECT count(*) c FROM attendance_correction').get()).toEqual({ c: 1 }); expect(getSheet(w.regMen, w.group, '2026-11-20')!.rows[0]).toMatchObject({ status: 'late', lateMinutes: 15 });
  });
  it('the database refuses to edit or delete corrections', () => {
    ok(correctRecord(w.supMen, rec, 'present', null, 'خطأ'));
    expect(() => w.db.prepare("UPDATE attendance_correction SET reason='x'").run()).toThrow(/append-only/); expect(() => w.db.prepare('DELETE FROM attendance_correction').run()).toThrow(/append-only/);
  });
});

describe('history and totals', () => {
  it('counts held sessions only, per student, within the range', () => {
    const w = world(); const a = w.stu(w.men, 1), b = w.stu(w.men, 2); w.setDay('2026-10-01'); ok(enrollStudent(w.regMen, w.group, a)); ok(enrollStudent(w.regMen, w.group, b));
    for (const d of ['2026-11-18', '2026-11-19']) { w.setDay(d); ok(saveSheet(w.regMen, w.group, d, T, [{ studentId: a, status: 'present' }, d === '2026-11-18' ? { studentId: b, status: 'absent' as const } : { studentId: b, status: 'late' as const, lateMinutes: 5 }])); }
    w.setDay('2026-11-20'); ok(cancelSession(w.regMen, w.group, '2026-11-20', 'عطلة'));
    const h = groupHistory(w.regMen, w.group, '2026-11-01', '2026-11-30')!;
    expect(h.sessions.map((s) => [s.date, s.status, s.recorded])).toEqual([['2026-11-20', 'cancelled', 0], ['2026-11-19', 'held', 2], ['2026-11-18', 'held', 2]]);
    expect(h.students.map((s) => [s.studentNo, s.present, s.late, s.absent, s.recorded])).toEqual([['S1', 2, 0, 0, 2], ['S2', 0, 1, 1, 2]]);
    expect(studentAttendance(w.regMen, b)).toEqual({ present: 0, late: 1, excused: 0, absent: 1, recorded: 2 }); expect(studentAttendance(w.supWomen, b)).toBeNull(); expect(groupHistory(w.supWomen, w.group, '2026-11-01', '2026-11-30')).toBeNull();
    expect(groupHistory(w.regMen, w.group, '2026-12-01', '2026-11-01')).toBeNull();
  });
});

describe('schema guarantees behind attendance (BR-011, BR-027, BR-028)', () => {
  it('rejects a record whose session date is outside the enrollment range, and a duplicate', () => {
    const w = world(); const a = w.stu(w.men, 1); w.setDay('2026-11-10'); ok(enrollStudent(w.regMen, w.group, a)); w.setDay('2026-11-20');
    ok(saveSheet(w.regMen, w.group, '2026-11-15', T, [{ studentId: a, status: 'present' }]));
    const e = w.db.prepare('SELECT id FROM enrollment').get() as { id: string }; const s = w.db.prepare('SELECT id FROM session').get() as { id: string };
    const dup = () => w.db.prepare("INSERT INTO attendance_record(id,tenant_id,created_at,updated_at,created_by,updated_by,session_id,student_id,group_id,branch_id,enrollment_id,status,recorded_by) SELECT '00000000-0000-7000-8000-0000000000aa',tenant_id,created_at,updated_at,'u','u',session_id,student_id,group_id,branch_id,enrollment_id,'absent','u' FROM attendance_record").run();
    expect(dup).toThrow(/UNIQUE/); void e; void s;
    w.db.prepare("UPDATE enrollment SET start_date='2026-11-16', version=version+1").run();
    w.db.prepare("INSERT INTO session(id,tenant_id,created_at,updated_at,created_by,updated_by,group_id,branch_id,session_date,start_time,end_time) SELECT '00000000-0000-7000-8000-0000000000bb',tenant_id,created_at,updated_at,'u','u',group_id,branch_id,'2026-11-12','16:00','17:00' FROM session").run();
    expect(() => w.db.prepare("INSERT INTO attendance_record(id,tenant_id,created_at,updated_at,created_by,updated_by,session_id,student_id,group_id,branch_id,enrollment_id,status,recorded_by) SELECT '00000000-0000-7000-8000-0000000000cc',tenant_id,created_at,updated_at,'u','u','00000000-0000-7000-8000-0000000000bb',student_id,group_id,branch_id,id,'absent','u' FROM enrollment").run()).toThrow(/outside the enrollment range/);
  });
});

describe('home overview of today', () => {
  it('shows each group with its attendance state for the day, scoped by branch', async () => {
    const { todayOverview } = await import('../src');
    const w = world(); const a = w.stu(w.men, 1), b = w.stu(w.men, 2); w.setDay('2026-10-01'); ok(enrollStudent(w.regMen, w.group, a)); ok(enrollStudent(w.regMen, w.group, b)); w.setDay('2026-11-20');
    expect(todayOverview(w.acadMen, '2026-11-20').map((r) => [r.groupName, r.members, r.recorded, r.state])).toEqual([['فوج أ', 2, 0, 'not_recorded']]);
    ok(saveSheet(w.regMen, w.group, '2026-11-20', T, [{ studentId: a, status: 'present' }])); expect(todayOverview(w.acadMen, '2026-11-20')[0]!.state).toBe('partial');
    ok(saveSheet(w.regMen, w.group, '2026-11-20', T, [{ studentId: b, status: 'absent' }])); expect(todayOverview(w.acadMen, '2026-11-20')[0]!.state).toBe('done');
    expect(todayOverview(w.supWomen, '2026-11-20')).toEqual([]); expect(todayOverview(w.regMen, 'x')).toEqual([]); expect(todayOverview(w.regMen, '2028-01-01')).toEqual([]); // outside the active year
    ok(cancelSession(w.regMen, w.group, '2026-11-21'.replace('21', '19'), 'عطلة')); expect(todayOverview(w.acadMen, '2026-11-19')[0]!.state).toBe('cancelled');
  });
});
