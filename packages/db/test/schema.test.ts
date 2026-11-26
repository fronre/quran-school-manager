import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, migrate, newId, appendAudit, verifyAuditLog, type Db } from '../src';

const T = newId();
const NOW = '2026-09-01T08:00:00.000Z';
const env = (id = newId()) => ({ id, tenant_id: T, created_at: NOW, updated_at: NOW, created_by: 'u1', updated_by: 'u1' });

function insert(db: Db, table: string, row: Record<string, unknown>) {
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO ${table}(${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`).run(row);
  return row.id as string;
}

interface World { db: Db; branchM: string; branchW: string; year: string; groupM: string; groupW: string; mk: ReturnType<typeof makers> }
function makers(db: Db) {
  return {
    student(branch: string, no: string) {
      const p = insert(db, 'person', { ...env(), given_name: 'مُحَمَّد', family_name: 'بن عمر' });
      return insert(db, 'student', { ...env(), person_id: p, student_no: no, branch_id: branch });
    },
    enrol(student: string, group: string, branch: string, year: string, start: string, end: string | null = null) {
      return insert(db, 'enrollment', { ...env(), student_id: student, group_id: group, branch_id: branch, academic_year_id: year, start_date: start, end_date: end });
    },
    session(group: string, branch: string, date: string, start = '16:00') {
      return insert(db, 'session', { ...env(), group_id: group, branch_id: branch, session_date: date, start_time: start, end_time: '17:30' });
    },
    attendance(o: { session: string; student: string; group: string; branch: string; enrollment: string; status?: string }) {
      return insert(db, 'attendance_record', { ...env(), session_id: o.session, student_id: o.student, group_id: o.group, branch_id: o.branch, enrollment_id: o.enrollment, status: o.status ?? 'present', recorded_by: 'u1' });
    },
  };
}

function world(): World {
  const db = openDb(':memory:'); migrate(db);
  insert(db, 'association', { ...env(T), name: 'جمعية تجريبية' });
  const branchM = insert(db, 'branch', { ...env(), name: 'فرع الرجال' });
  const branchW = insert(db, 'branch', { ...env(), name: 'فرع النساء' });
  const year = insert(db, 'academic_year', { ...env(), name: '2026-2027', start_date: '2026-09-01', end_date: '2027-06-30', status: 'active' });
  const groupM = insert(db, 'study_group', { ...env(), branch_id: branchM, academic_year_id: year, name: 'حلقة 1', capacity: 15 });
  const groupW = insert(db, 'study_group', { ...env(), branch_id: branchW, academic_year_id: year, name: 'حلقة 1', capacity: 15 });
  return { db, branchM, branchW, year, groupM, groupW, mk: makers(db) };
}

describe('migrations', () => {
  it('apply once, are idempotent, and report versions', () => {
    const db = openDb(':memory:');
    expect(migrate(db)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(migrate(db)).toEqual([]);
    expect(db.prepare('SELECT count(*) c FROM schema_migration').get()).toEqual({ c: 12 });
  });
  it('refuse to run if an applied migration file was edited', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-'));
    cpSync(join(__dirname, '../migrations/001_init.sql'), join(dir, '001_init.sql'));
    const db = openDb(':memory:'); migrate(db, dir);
    writeFileSync(join(dir, '001_init.sql'), '-- tampered\n', { flag: 'a' });
    expect(() => migrate(db, dir)).toThrow(/modified after being applied/);
  });
  it('create all tables as STRICT with foreign keys on', () => {
    const db = openDb(':memory:'); migrate(db);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    const nonStrict = db.prepare("SELECT name FROM pragma_table_list WHERE schema='main' AND type='table' AND strict=0 AND name NOT LIKE 'sqlite_%'").all();
    expect(nonStrict).toEqual([]);
  });
});

describe('BR-001/002 enrollment', () => {
  let w: World; beforeEach(() => { w = world(); });
  it('allows one open enrollment per student per year', () => {
    const s = w.mk.student(w.branchM, 'M-001');
    w.mk.enrol(s, w.groupM, w.branchM, w.year, '2026-09-01');
    expect(() => w.mk.enrol(s, w.groupM, w.branchM, w.year, '2026-10-01')).toThrow();
  });
  it('allows a transfer: close the old enrollment, open the next (history kept)', () => {
    const s = w.mk.student(w.branchM, 'M-002');
    const g2 = insert(w.db, 'study_group', { ...env(), branch_id: w.branchM, academic_year_id: w.year, name: 'حلقة 2', capacity: 10 });
    const e1 = w.mk.enrol(s, w.groupM, w.branchM, w.year, '2026-09-01');
    w.db.prepare("UPDATE enrollment SET end_date='2026-10-31', end_reason='transfer', version=version+1 WHERE id=?").run(e1);
    w.mk.enrol(s, g2, w.branchM, w.year, '2026-11-01');
    expect(w.db.prepare('SELECT count(*) c FROM enrollment WHERE student_id=?').get(s)).toEqual({ c: 2 });
  });
  it('rejects overlapping ranges even when both are closed', () => {
    const s = w.mk.student(w.branchM, 'M-003');
    w.mk.enrol(s, w.groupM, w.branchM, w.year, '2026-09-01', '2026-10-31');
    expect(() => w.mk.enrol(s, w.groupM, w.branchM, w.year, '2026-10-15', '2026-12-01')).toThrow(/overlaps/);
  });
  it('rejects end before start', () => {
    const s = w.mk.student(w.branchM, 'M-004');
    expect(() => w.mk.enrol(s, w.groupM, w.branchM, w.year, '2026-10-01', '2026-09-01')).toThrow();
  });
  it('rejects a student enrolled in a group of another branch', () => {
    const s = w.mk.student(w.branchM, 'M-005');
    expect(() => w.mk.enrol(s, w.groupW, w.branchW, w.year, '2026-09-01')).toThrow(/FOREIGN KEY/);
  });
  it('rejects an enrollment whose academic year differs from the group year', () => {
    const y2 = insert(w.db, 'academic_year', { ...env(), name: '2027-2028', start_date: '2027-09-01', end_date: '2028-06-30' });
    const s = w.mk.student(w.branchM, 'M-006');
    expect(() => w.mk.enrol(s, w.groupM, w.branchM, y2, '2027-09-01')).toThrow(/FOREIGN KEY/);
  });
});

describe('BR-011/027/028 attendance', () => {
  let w: World; beforeEach(() => { w = world(); });
  function ready() {
    const s = w.mk.student(w.branchM, 'M-100');
    const e = w.mk.enrol(s, w.groupM, w.branchM, w.year, '2026-09-01');
    const ses = w.mk.session(w.groupM, w.branchM, '2026-09-10');
    return { s, e, ses };
  }
  it('records a valid attendance', () => {
    const { s, e, ses } = ready();
    expect(() => w.mk.attendance({ session: ses, student: s, group: w.groupM, branch: w.branchM, enrollment: e })).not.toThrow();
  });
  it('rejects a second record for the same student and session', () => {
    const { s, e, ses } = ready();
    w.mk.attendance({ session: ses, student: s, group: w.groupM, branch: w.branchM, enrollment: e });
    expect(() => w.mk.attendance({ session: ses, student: s, group: w.groupM, branch: w.branchM, enrollment: e, status: 'absent' })).toThrow(/UNIQUE/);
  });
  it('rejects attendance for a student not enrolled in the session group', () => {
    const { ses } = ready();
    const other = w.mk.student(w.branchM, 'M-101');
    const g2 = insert(w.db, 'study_group', { ...env(), branch_id: w.branchM, academic_year_id: w.year, name: 'حلقة 2', capacity: 10 });
    const e2 = w.mk.enrol(other, g2, w.branchM, w.year, '2026-09-01');
    expect(() => w.mk.attendance({ session: ses, student: other, group: w.groupM, branch: w.branchM, enrollment: e2 })).toThrow(/FOREIGN KEY/);
  });
  it("rejects another student's enrollment id", () => {
    const { s, ses } = ready();
    const other = w.mk.student(w.branchM, 'M-102');
    const eo = w.mk.enrol(other, w.groupM, w.branchM, w.year, '2026-09-01');
    expect(() => w.mk.attendance({ session: ses, student: s, group: w.groupM, branch: w.branchM, enrollment: eo })).toThrow(/FOREIGN KEY/);
  });
  it('rejects a session date outside the enrollment range', () => {
    const s = w.mk.student(w.branchM, 'M-103');
    const e = w.mk.enrol(s, w.groupM, w.branchM, w.year, '2026-10-01', '2026-10-31');
    const early = w.mk.session(w.groupM, w.branchM, '2026-09-20');
    expect(() => w.mk.attendance({ session: early, student: s, group: w.groupM, branch: w.branchM, enrollment: e })).toThrow(/outside the enrollment range/);
  });
  it('rejects a session of another group and a wrong branch on the record', () => {
    const { s, e } = ready();
    const g2 = insert(w.db, 'study_group', { ...env(), branch_id: w.branchM, academic_year_id: w.year, name: 'حلقة 3', capacity: 10 });
    const ses2 = w.mk.session(g2, w.branchM, '2026-09-10');
    expect(() => w.mk.attendance({ session: ses2, student: s, group: w.groupM, branch: w.branchM, enrollment: e })).toThrow(/FOREIGN KEY/);
    const ses3 = w.mk.session(w.groupM, w.branchM, '2026-09-11');
    expect(() => w.mk.attendance({ session: ses3, student: s, group: w.groupM, branch: w.branchW, enrollment: e })).toThrow(/FOREIGN KEY/);
  });
  it('requires a reason for a correction and keeps corrections append-only', () => {
    const { s, e, ses } = ready();
    const a = w.mk.attendance({ session: ses, student: s, group: w.groupM, branch: w.branchM, enrollment: e });
    const base = { id: newId(), tenant_id: T, attendance_id: a, old_status: 'present', new_status: 'absent', corrected_by: 'u1', corrected_at: NOW };
    expect(() => insert(w.db, 'attendance_correction', { ...base, reason: '  ' })).toThrow();
    insert(w.db, 'attendance_correction', { ...base, reason: 'خطأ في التسجيل' });
    expect(() => w.db.prepare('UPDATE attendance_correction SET reason=?').run('x')).toThrow(/append-only/);
    expect(() => w.db.prepare('DELETE FROM attendance_correction').run()).toThrow(/append-only/);
  });
});

describe('BR-016 academic year', () => {
  let w: World; beforeEach(() => { w = world(); });
  it('allows only one active year', () => {
    expect(() => insert(w.db, 'academic_year', { ...env(), name: 'y2', start_date: '2027-09-01', end_date: '2028-06-30', status: 'active' })).toThrow(/UNIQUE/);
  });
  it('rejects overlapping years, accepts adjacent ones', () => {
    expect(() => insert(w.db, 'academic_year', { ...env(), name: 'overlap', start_date: '2027-06-30', end_date: '2027-09-01' })).toThrow(/overlaps/);
    expect(() => insert(w.db, 'academic_year', { ...env(), name: 'next', start_date: '2027-07-01', end_date: '2028-06-30' })).not.toThrow();
  });
  it('rejects start >= end', () => {
    expect(() => insert(w.db, 'academic_year', { ...env(), name: 'bad', start_date: '2030-01-01', end_date: '2030-01-01' })).toThrow();
  });
});

describe('row envelope (BR-046)', () => {
  let w: World; beforeEach(() => { w = world(); });
  it('blocks physical deletes (tombstones only)', () => {
    expect(() => w.db.prepare('DELETE FROM branch').run()).toThrow(/physical delete/);
  });
  it('allows a tombstone update with version + 1 and frees the unique name', () => {
    const id = w.db.prepare("SELECT id FROM branch WHERE name='فرع النساء'").get() as { id: string };
    w.db.prepare("UPDATE branch SET deleted_at=?, deleted_by='u1', version=version+1 WHERE id=?").run(NOW, id.id);
    expect(() => insert(w.db, 'branch', { ...env(), name: 'فرع النساء' })).not.toThrow();
  });
  it('rejects an update that does not bump the version, or changes tenant/created_*', () => {
    expect(() => w.db.prepare("UPDATE branch SET label='x'").run()).toThrow(/envelope violation/);
    expect(() => w.db.prepare("UPDATE branch SET label='x', version=version+1, tenant_id='other'").run()).toThrow(/envelope violation/);
    expect(() => w.db.prepare("UPDATE branch SET label='x', version=version+1, created_by='evil'").run()).toThrow(/envelope violation/);
  });
  it('rejects malformed ids, timestamps and dates', () => {
    expect(() => insert(w.db, 'branch', { ...env('NOT-A-UUID'), name: 'z' })).toThrow();
    expect(() => insert(w.db, 'branch', { ...env(), created_at: '2026-09-01 08:00', name: 'z2' })).toThrow();
    expect(() => insert(w.db, 'academic_year', { ...env(), name: 'q', start_date: '1/9/2030', end_date: '2031-01-01' })).toThrow();
  });
  it('rejects a deleted_at without deleted_by', () => {
    expect(() => insert(w.db, 'branch', { ...env(), name: 'k', deleted_at: NOW })).toThrow();
  });
});

describe('BR-047 audit log', () => {
  const entry = (n: number) => ({ tenant_id: T, actor_id: 'u1', actor_role: 'director', branch_id: null, action: 'student.update', entity_type: 'student', entity_id: `s${n}`, before_json: null, after_json: `{"n":${n}}`, reason: null });
  it('chains entries and verifies clean', () => {
    const db = openDb(':memory:'); migrate(db);
    for (let i = 1; i <= 5; i++) appendAudit(db, entry(i));
    expect(verifyAuditLog(db)).toEqual({ ok: true });
  });
  it('cannot be edited or deleted through SQL', () => {
    const db = openDb(':memory:'); migrate(db); appendAudit(db, entry(1));
    expect(() => db.prepare("UPDATE audit_log SET action='x'").run()).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM audit_log').run()).toThrow(/append-only/);
  });
  it('detects tampering made by bypassing the triggers (file-level attacker)', () => {
    const db = openDb(':memory:'); migrate(db);
    for (let i = 1; i <= 4; i++) appendAudit(db, entry(i));
    db.exec('DROP TRIGGER trg_audit_no_update');
    db.prepare("UPDATE audit_log SET after_json='{\"n\":999}' WHERE seq=2").run();
    expect(verifyAuditLog(db)).toEqual({ ok: false, seq: 2, problem: 'hash_mismatch' });
  });
  it('detects a deleted middle row', () => {
    const db = openDb(':memory:'); migrate(db);
    for (let i = 1; i <= 4; i++) appendAudit(db, entry(i));
    db.exec('DROP TRIGGER trg_audit_no_delete'); db.prepare('DELETE FROM audit_log WHERE seq=2').run();
    expect(verifyAuditLog(db)).toMatchObject({ ok: false, problem: 'seq_gap' });
  });
});
