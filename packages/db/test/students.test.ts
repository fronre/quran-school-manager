import { describe, it, expect, beforeEach } from 'vitest';
import type { Assignment, StudentInput } from '@mishkat/domain';
import { openDb, migrate, newId, verifyAuditLog, listStudents, getStudent, createStudent, updateStudent, archiveStudent, unarchiveStudent, findDuplicates, nextStudentNo, studentCounts, type Ctx, type Db } from '../src';

const NOW = '2026-11-20T09:00:00.000Z';
const T = newId();

function world() {
  const db = openDb(':memory:'); migrate(db);
  db.prepare('INSERT INTO association(id,tenant_id,created_at,updated_at,created_by,updated_by,name) VALUES (?,?,?,?,?,?,?)').run(T, T, NOW, NOW, 's', 's', 'جمعية');
  const branch = (n: string, pos: number) => { const id = newId(); db.prepare('INSERT INTO branch(id,tenant_id,created_at,updated_at,created_by,updated_by,name,position) VALUES (?,?,?,?,?,?,?,?)').run(id, T, NOW, NOW, 's', 's', n, pos); return id; };
  const men = branch('فرع الرجال', 1), women = branch('فرع النساء', 2);
  const ctx = (assignments: Assignment[], actorId = 'u1'): Ctx => ({ db, tenantId: T, actorId, assignments, now: () => NOW });
  return { db, men, women, director: ctx([{ role: 'director', branchId: null }]), supMen: ctx([{ role: 'branch_supervisor', branchId: men }]), regWomen: ctx([{ role: 'registrar', branchId: women }]), acadMen: ctx([{ role: 'academic_supervisor', branchId: men }]), ctx };
}
const si = (branchId: string, over: Partial<StudentInput> = {}): StudentInput => ({ givenName: 'أحمد', familyName: 'بن عمر', birthDate: '2015-03-10', phone: null, branchId, status: 'active', joinedOn: '2026-09-01', studentNo: '0001', ...over });
const ok = <R extends { ok: boolean }>(r: R): Extract<R, { ok: true }> => { if (!r.ok) throw new Error('expected ok: ' + JSON.stringify(r)); return r as Extract<R, { ok: true }>; };

describe('createStudent', () => {
  let w: ReturnType<typeof world>; beforeEach(() => { w = world(); });
  it('creates person + student with envelope, normalized search key and an audit entry', () => {
    const { id } = ok(createStudent(w.supMen, si(w.men)));
    const row = getStudent(w.supMen, id)!;
    expect(row).toMatchObject({ givenName: 'أحمد', studentNo: '0001', branchName: 'فرع الرجال', status: 'active', archivedAt: null, version: 1 });
    expect(w.db.prepare('SELECT search_key k FROM person').get()).toEqual({ k: 'احمد بن عمر' });
    expect(w.db.prepare("SELECT action, branch_id b FROM audit_log WHERE action='student.create'").get()).toEqual({ action: 'student.create', b: w.men });
    expect(verifyAuditLog(w.db)).toEqual({ ok: true });
  });
  it('trims input and stores blank optional fields as NULL', () => {
    const { id } = ok(createStudent(w.director, si(w.men, { givenName: '  أحمد ', phone: '  ', birthDate: '', joinedOn: null })));
    expect(getStudent(w.director, id)).toMatchObject({ givenName: 'أحمد', phone: null, birthDate: null, joinedOn: null });
  });
  it('rejects invalid input with issue codes and writes nothing', () => {
    const r = createStudent(w.director, si(w.men, { givenName: '', birthDate: '2099-01-01' }));
    expect(r).toMatchObject({ ok: false, error: 'invalid' }); expect((r as { issues: { field: string }[] }).issues.map((i) => i.field)).toEqual(['givenName', 'birthDate']);
    expect(w.db.prepare('SELECT count(*) c FROM student').get()).toEqual({ c: 0 }); expect(w.db.prepare('SELECT count(*) c FROM person').get()).toEqual({ c: 0 });
  });
  it('enforces branch authorization: a supervisor cannot create in the other branch; reg/acad rules apply', () => {
    expect(createStudent(w.supMen, si(w.women))).toEqual({ ok: false, error: 'forbidden' });
    expect(createStudent(w.acadMen, si(w.men))).toEqual({ ok: false, error: 'forbidden' }); // academic supervisor is read-only on students
    expect(createStudent(w.regWomen, si(w.women))).toMatchObject({ ok: true });
    expect(createStudent(w.ctx([]), si(w.men))).toEqual({ ok: false, error: 'forbidden' });
  });
  it('rejects an unknown or inactive branch and a duplicate student number', () => {
    expect(createStudent(w.director, si('nope'))).toEqual({ ok: false, error: 'branch_not_found' });
    w.db.prepare('UPDATE branch SET active=0, version=version+1 WHERE id=?').run(w.women);
    expect(createStudent(w.director, si(w.women))).toEqual({ ok: false, error: 'branch_not_found' });
    ok(createStudent(w.director, si(w.men)));
    expect(createStudent(w.director, si(w.men, { givenName: 'يوسف', studentNo: '0001' }))).toEqual({ ok: false, error: 'duplicate_number' });
  });
  it('warns on likely duplicates (BR-023) and lets the user proceed knowingly, recording it', () => {
    ok(createStudent(w.director, si(w.men)));
    const second = si(w.men, { givenName: 'احمد', familyName: 'بن عُمَر', studentNo: '0002' });
    const r = createStudent(w.director, second);
    expect(r).toMatchObject({ ok: false, error: 'duplicates' }); expect((r as { duplicates: unknown[] }).duplicates).toHaveLength(1);
    expect(w.db.prepare('SELECT count(*) c FROM student').get()).toEqual({ c: 1 });
    ok(createStudent(w.director, second, { ignoreDuplicates: true }));
    expect(w.db.prepare("SELECT reason FROM audit_log WHERE action='student.create' ORDER BY seq DESC LIMIT 1").get()).toEqual({ reason: 'duplicate warning acknowledged' });
  });
  it('duplicate check never reveals students of branches the caller cannot see', () => {
    ok(createStudent(w.director, si(w.women, { studentNo: '0009' })));
    expect(findDuplicates(w.supMen, { givenName: 'أحمد', familyName: 'بن عمر', birthDate: '2015-03-10' })).toEqual([]);
    expect(findDuplicates(w.director, { givenName: 'أحمد', familyName: 'بن عمر', birthDate: '2015-03-10' })).toHaveLength(1);
    expect(createStudent(w.supMen, si(w.men, { studentNo: '0010' }))).toMatchObject({ ok: true }); // no leak, no warning
  });
});

describe('listStudents: scope, filters, search, paging', () => {
  let w: ReturnType<typeof world>;
  beforeEach(() => {
    w = world();
    const add = (b: string, g: string, f: string, no: string, extra: Partial<StudentInput> = {}) => ok(createStudent(w.director, si(b, { givenName: g, familyName: f, studentNo: no, birthDate: null, ...extra })));
    add(w.men, 'أحمد', 'بن عمر', '0001'); add(w.men, 'مُحَمَّد', 'الجزائري', '0002'); add(w.men, 'إبراهيم', 'بوعلام', '0003', { status: 'suspended' });
    add(w.women, 'فاطمة', 'بلقاسم', '0004'); add(w.women, 'آمنة', 'مسعودي', '0005');
  });
  it('director sees all, a supervisor sees only their branch, no assignment sees nothing', () => {
    expect(listStudents(w.director).total).toBe(5);
    expect(listStudents(w.supMen).rows.map((r) => r.studentNo).sort()).toEqual(['0001', '0002', '0003']);
    expect(listStudents(w.regWomen).total).toBe(2);
    expect(listStudents(w.ctx([])).total).toBe(0);
  });
  it('a branch filter outside the caller scope returns nothing (no leak)', () => {
    expect(listStudents(w.supMen, { branchId: w.women })).toEqual({ rows: [], total: 0 });
    expect(listStudents(w.director, { branchId: w.women }).total).toBe(2);
  });
  it('searches Arabic regardless of tashkeel and hamza forms, any word order, and by number', () => {
    expect(listStudents(w.director, { search: 'محمد' }).rows.map((r) => r.studentNo)).toEqual(['0002']);
    expect(listStudents(w.director, { search: 'احمد' }).rows.map((r) => r.studentNo)).toEqual(['0001']);
    expect(listStudents(w.director, { search: 'ابراهيم' }).total).toBe(1);
    expect(listStudents(w.director, { search: 'عمر احمد' }).total).toBe(1);
    expect(listStudents(w.director, { search: 'امنه' }).total).toBe(1);
    expect(listStudents(w.director, { search: '0004' }).rows[0]!.givenName).toBe('فاطمة');
    expect(listStudents(w.director, { search: 'zzz' }).total).toBe(0);
  });
  it('treats % and _ in the search term literally', () => {
    expect(listStudents(w.director, { search: '%' }).total).toBe(0); expect(listStudents(w.director, { search: '_' }).total).toBe(0);
  });
  it('filters by status, and hides archived students unless asked (BR-019)', () => {
    expect(listStudents(w.director, { status: 'suspended' }).total).toBe(1);
    const id = listStudents(w.director, { search: '0001' }).rows[0]!.id; ok(archiveStudent(w.director, id, 'انتقل'));
    expect(listStudents(w.director).total).toBe(4);
    expect(listStudents(w.director, { archived: 'archived' }).rows.map((r) => r.studentNo)).toEqual(['0001']);
    expect(listStudents(w.director, { archived: 'all' }).total).toBe(5);
    expect(studentCounts(w.director, w.men)).toEqual({ active: 2, archived: 1 }); expect(studentCounts(w.director, w.women)).toEqual({ active: 2, archived: 0 }); expect(studentCounts(w.supMen, w.women)).toEqual({ active: 0, archived: 0 });
    expect(studentCounts(w.director)).toEqual({ active: 4, archived: 1 }); expect(studentCounts(w.supMen)).toEqual({ active: 2, archived: 1 }); expect(studentCounts(w.ctx([]))).toEqual({ active: 0, archived: 0 });
  });
  it('pages deterministically and caps the page size', () => {
    const p1 = listStudents(w.director, { limit: 2, offset: 0 }), p2 = listStudents(w.director, { limit: 2, offset: 2 }), p3 = listStudents(w.director, { limit: 2, offset: 4 });
    expect([p1.rows.length, p2.rows.length, p3.rows.length, p1.total]).toEqual([2, 2, 1, 5]);
    expect(new Set([...p1.rows, ...p2.rows, ...p3.rows].map((r) => r.id)).size).toBe(5);
    expect(listStudents(w.director, { limit: 100000 }).rows.length).toBe(5);
  });
  it('lists 2,000 students quickly (NFR budget)', () => {
    const t0 = performance.now();
    w.db.transaction(() => { for (let i = 0; i < 2000; i++) ok(createStudent(w.director, si(i % 2 ? w.men : w.women, { givenName: 'طالب' + i, familyName: 'اختبار', studentNo: `T${i}`, birthDate: null }))); })();
    const created = performance.now() - t0; const t1 = performance.now();
    const r = listStudents(w.director, { search: 'طالب1999' });
    const list = listStudents(w.director, { limit: 50 }); const took = performance.now() - t1;
    expect(r.total).toBe(1); expect(list.total).toBe(2005);
    expect(took).toBeLessThan(250); expect(created).toBeLessThan(15000);
  });
});

describe('updateStudent', () => {
  let w: ReturnType<typeof world>; let id: string; let v: number;
  beforeEach(() => { w = world(); id = ok(createStudent(w.supMen, si(w.men))).id; v = getStudent(w.supMen, id)!.version; });
  it('updates both records, bumps the version and audits before/after', () => {
    ok(updateStudent(w.supMen, id, v, si(w.men, { givenName: 'عبد الله', status: 'suspended' })));
    expect(getStudent(w.supMen, id)).toMatchObject({ givenName: 'عبد الله', status: 'suspended', version: v + 1 });
    expect(w.db.prepare('SELECT search_key k FROM person').get()).toEqual({ k: 'عبد الله بن عمر' });
    const a = w.db.prepare("SELECT before_json b, after_json a FROM audit_log WHERE action='student.update'").get() as { b: string; a: string };
    expect(JSON.parse(a.b).givenName).toBe('أحمد'); expect(JSON.parse(a.a).givenName).toBe('عبد الله');
    expect(verifyAuditLog(w.db)).toEqual({ ok: true });
  });
  it('detects a concurrent edit through the version (optimistic concurrency)', () => {
    ok(updateStudent(w.supMen, id, v, si(w.men, { phone: '0550 12 34 56' })));
    expect(updateStudent(w.supMen, id, v, si(w.men, { phone: '0661 00 00 00' }))).toEqual({ ok: false, error: 'conflict' });
    expect(getStudent(w.supMen, id)!.phone).toBe('0550 12 34 56');
  });
  it('other-branch and out-of-scope records look non-existent; read-only roles cannot edit', () => {
    expect(updateStudent(w.regWomen, id, v, si(w.women))).toEqual({ ok: false, error: 'not_found' });
    expect(getStudent(w.regWomen, id)).toBeNull();
    expect(updateStudent(w.acadMen, id, v, si(w.men))).toEqual({ ok: false, error: 'forbidden' });
    expect(updateStudent(w.supMen, 'missing', 1, si(w.men))).toEqual({ ok: false, error: 'not_found' });
  });
  it('lets the student number stay the same but rejects taking another student\'s number', () => {
    ok(createStudent(w.supMen, si(w.men, { givenName: 'يوسف', studentNo: '0002', birthDate: null })));
    expect(updateStudent(w.supMen, id, v, si(w.men, { studentNo: '0002' }))).toEqual({ ok: false, error: 'duplicate_number' });
    expect(updateStudent(w.supMen, id, v, si(w.men))).toMatchObject({ ok: true });
  });
  it('does not warn about the student itself as a duplicate', () => { expect(updateStudent(w.supMen, id, v, si(w.men, { phone: '0550 12 34 56' }))).toMatchObject({ ok: true }); });
  it('moving to another branch is a cross-branch transfer: Director only, blocked once enrolled', () => {
    expect(updateStudent(w.supMen, id, v, si(w.women))).toEqual({ ok: false, error: 'forbidden' });
    ok(updateStudent(w.director, id, v, si(w.women)));
    expect(getStudent(w.director, id)!.branchName).toBe('فرع النساء');
    // with an enrollment the move is refused
    const year = newId(); w.db.prepare("INSERT INTO academic_year(id,tenant_id,created_at,updated_at,created_by,updated_by,name,start_date,end_date,status) VALUES (?,?,?,?,?,?,?,?,?,'active')").run(year, T, NOW, NOW, 's', 's', 'y', '2026-09-01', '2027-06-30');
    const g = newId(); w.db.prepare('INSERT INTO study_group(id,tenant_id,created_at,updated_at,created_by,updated_by,branch_id,academic_year_id,name,capacity) VALUES (?,?,?,?,?,?,?,?,?,?)').run(g, T, NOW, NOW, 's', 's', w.women, year, 'g', 10);
    w.db.prepare('INSERT INTO enrollment(id,tenant_id,created_at,updated_at,created_by,updated_by,student_id,group_id,branch_id,academic_year_id,start_date) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(newId(), T, NOW, NOW, 's', 's', id, g, w.women, year, '2026-09-01');
    const v2 = getStudent(w.director, id)!.version;
    expect(updateStudent(w.director, id, v2, si(w.men))).toEqual({ ok: false, error: 'has_enrollments' });
  });
  it('rejects invalid data and editing an archived student', () => {
    expect(updateStudent(w.supMen, id, v, si(w.men, { familyName: '' }))).toMatchObject({ ok: false, error: 'invalid' });
    ok(archiveStudent(w.supMen, id, 'انتهى'));
    expect(updateStudent(w.supMen, id, getStudent(w.supMen, id)!.version, si(w.men))).toEqual({ ok: false, error: 'archived' });
  });
});

describe('archive / unarchive (BR-019)', () => {
  let w: ReturnType<typeof world>; let id: string;
  beforeEach(() => { w = world(); id = ok(createStudent(w.supMen, si(w.men))).id; });
  it('requires a reason, keeps all data, and is audited with the reason', () => {
    expect(archiveStudent(w.supMen, id, '  ')).toEqual({ ok: false, error: 'reason_required' });
    expect(archiveStudent(w.supMen, id, 'x'.repeat(301))).toEqual({ ok: false, error: 'reason_required' });
    ok(archiveStudent(w.supMen, id, 'انتقل إلى مدينة أخرى'));
    expect(getStudent(w.supMen, id)).toMatchObject({ archiveReason: 'انتقل إلى مدينة أخرى', givenName: 'أحمد' });
    expect(w.db.prepare("SELECT reason FROM audit_log WHERE action='student.archive'").get()).toEqual({ reason: 'انتقل إلى مدينة أخرى' });
    expect(archiveStudent(w.supMen, id, 'again')).toEqual({ ok: false, error: 'already_archived' });
  });
  it('restores a student, clearing the reason', () => {
    expect(unarchiveStudent(w.supMen, id)).toEqual({ ok: false, error: 'not_archived' });
    ok(archiveStudent(w.supMen, id, 'غياب طويل')); ok(unarchiveStudent(w.supMen, id));
    expect(getStudent(w.supMen, id)).toMatchObject({ archivedAt: null, archiveReason: null });
    expect(verifyAuditLog(w.db)).toEqual({ ok: true });
  });
  it('is branch-scoped and permission-checked; there is no delete function', async () => {
    expect(archiveStudent(w.regWomen, id, 'x')).toEqual({ ok: false, error: 'not_found' });
    expect(archiveStudent(w.acadMen, id, 'x')).toEqual({ ok: false, error: 'forbidden' });
    expect(Object.keys(await import('../src/students'))).not.toContain('deleteStudent');
    expect(() => w.db.prepare('DELETE FROM student').run()).toThrow(/physical delete/);
  });
});

describe('nextStudentNo', () => {
  it('suggests the next numeric number and ignores non-numeric ones', () => {
    const w = world(); expect(nextStudentNo(w.director)).toBe('0001');
    ok(createStudent(w.director, si(w.men, { studentNo: '0007' }))); ok(createStudent(w.director, si(w.men, { givenName: 'ب', studentNo: 'M-99', birthDate: null })));
    expect(nextStudentNo(w.director)).toBe('0008');
  });
});
void (undefined as unknown as Db);
