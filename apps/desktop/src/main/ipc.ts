import { z } from 'zod';
import { basename, join } from 'node:path';
import { existsSync, readdirSync, readFileSync, statSync, copyFileSync, renameSync, rmSync, mkdirSync, openSync, readSync, closeSync } from 'node:fs';
import {
  UPDATE_ISSUE_AR, updateMappingProblems, type UpdateMapping, RELATIONS, GUARDIAN_FIELD_AR, GIMPORT_ISSUE_AR, GIMPORT_WARNING_AR, suggestGuardianMapping, guardianMappingProblems, whatsappUrl, WHATSAPP_PREFIX, type GuardianMapping, MEMO_TYPES, authorize, branchFilter, checkPassword, PERMISSIONS, STUDENT_STATUSES, STAFF_POSITIONS, STAFF_KINDS, STUDENT_STATUS_AR, IMPORT_FIELD_AR, IMPORT_ISSUE_AR, suggestMapping, analyzeImport,
  type Assignment, type Permission, type StudentInput, type StaffInput, type StudentStatus, type Mapping, type ImportReport, type ImportRow,
} from '@mishkat/domain';
import { readTable, writeXlsx, toXml, LIMITS, type Table, type ReadError } from '@mishkat/files';
import {
  login, createBackup, runSetup, isSetUp, restoreOnNewComputer, readHeader, decryptBackup, APP_SCHEMA_VERSION, SetupError, generateRecoveryKey, saveRecoveryKey, loadRecoveryKey,
  importStudents, existingForImport, appendAudit, sha256,
  getSettings, readLogo, saveLogo, listAccounts, createAccount, setAccountStatus, setAccountRole, resetAccountPassword, renameAccount, setFirstPassword, accountIsActive, activityLog, loadAssignments, updateAssociation, renameBranch, addBranch, changeLoginPassword, checkUserPassword, restoreBackup, parseRecoveryKey, resetLoginPassword,
  recordMemorization, voidMemorization, studentProgress, groupProgress, nextAyahSuggestion,
  enrollmentReport, attendanceReport, activityReport,
  getSheet, saveSheet, cancelSession, correctRecord, groupHistory, studentAttendance, ATT_STATUSES,
  todayOverview, getMemoSettings, saveMemoSettings, scaleList, previewStudentUpdate, commitStudentUpdate, yearOverview, startNewYear, carryOverPlan, carryOver,
  listGuardians, issueGuardianCode, revokeGuardianCode, guardianHasCode, addGuardian, updateGuardian, removeGuardian, whatsappTarget, logMessage, previewGuardianImport, commitGuardianImport,
  listGroups, getGroup, createGroup, updateGroup, setGroupStatus, assignTeacher, removeTeacher, assignableTeachers, unassignedStudents, enrollStudent, leaveGroup, studentGroups, groupsOfTeacher,
  listStaff, getStaff, createStaff, updateStaff, archiveStaff, unarchiveStaff, setPhoto, getPhoto, removePhoto, profileActivity,
  feeSettings, setRate, setFreeMonth, recordPayment, cancelPayment, getReceipt, listPayments, studentStatement, arrearsReport, monthSummary,
  financePasswordSet, setFinancePassword, verifyFinancePassword, changeFinancePassword, resetFinancePassword, type FinCtx, listStudents, getStudent, createStudent, updateStudent, archiveStudent, unarchiveStudent, nextStudentNo, studentCounts, type Ctx,
  type Db, type AuthOptions, type Protector,
} from '@mishkat/db';
import { CHANNELS, type Channel } from './channels';
import { pruneScheduled, type FolderSuggestion } from './autosave';
import type { PhoneControl } from './phone/control';
export { CHANNELS, type Channel };

/** IPC allow-list (SEC-033): a fixed set of channels, each with a runtime schema. The renderer never supplies
 *  identity: the main process keeps the session and re-checks authorization on every call (SEC-023). */
const dateStr = z.string().max(10);
const text = (max: number) => z.string().max(max);
const studentInput = z.object({
  givenName: text(300), familyName: text(300), birthDate: dateStr.nullable(), phone: text(60).nullable(),
  branchId: text(64), status: z.enum(STUDENT_STATUSES), joinedOn: dateStr.nullable(), studentNo: text(60),
}).strict();
const mappingSchema = z.object({
  fullName: z.number().int().min(0).max(100).optional(), givenName: z.number().int().min(0).max(100).optional(), familyName: z.number().int().min(0).max(100).optional(),
  studentNo: z.number().int().min(0).max(100).optional(), birthDate: z.number().int().min(0).max(100).optional(), phone: z.number().int().min(0).max(100).optional(),
  branch: z.number().int().min(0).max(100).optional(), status: z.number().int().min(0).max(100).optional(), joinedOn: z.number().int().min(0).max(100).optional(),
}).strict();
const importOptions = z.object({
  mapping: mappingSchema, nameOrder: z.enum(['given-first', 'family-first']), defaultBranchId: text(64).nullable(),
  defaultStatus: z.enum(STUDENT_STATUSES), sheetIndex: z.number().int().min(0).max(50).optional(),
}).strict();
const filterSchema = z.object({
  search: text(200).optional(), branchId: text(64).optional(), status: z.enum(STUDENT_STATUSES).optional(), archived: z.enum(['active', 'archived', 'all']).optional(),
}).strict();
const staffInput = z.object({
  givenName: text(300), familyName: text(300), birthDate: dateStr.nullable(), phone: text(60).nullable(), branchId: text(64),
  position: z.enum(STAFF_POSITIONS), kind: z.enum(STAFF_KINDS),
}).strict();
const schemas = {
  'app.info': z.object({}).strict(),
  'auth.login': z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(500) }).strict(),
  'auth.logout': z.object({}).strict(),
  'auth.resetPassword': z.object({ recoveryKey: text(300), newPassword: text(500) }).strict(),
  'session.current': z.object({}).strict(),
  'setup.begin': z.object({}).strict(),
  'setup.checkPassword': z.object({ username: text(100), password: text(500) }).strict(),
  'setup.pickBackupFolder': z.object({}).strict(),
  'setup.commit': z.object({
    admin: z.object({ givenName: text(300), familyName: text(300), username: text(100), password: text(500) }).strict(),
    association: z.object({ name: text(500), address: text(500).optional(), contact: text(500).optional() }).strict(),
    branches: z.array(z.object({ name: text(500), label: text(500).optional() }).strict()).max(50),
    year: z.object({ name: text(300), startDate: dateStr, endDate: dateStr }).strict(),
    keyConfirm: z.object({ first: text(8), last: text(8) }).strict(),
    defaultAccount: z.boolean().optional(),
  }).strict(),
  'setup.restorePick': z.object({}).strict(),
  'setup.restoreCommit': z.object({ recoveryKey: text(200) }).strict(),
  'home.summary': z.object({}).strict(),
  'home.today': z.object({}).strict(),
  'backup.now': z.object({}).strict(),
  'staff.list': z.object({ search: text(200).optional(), branchId: text(64).optional(), position: z.enum([...STAFF_POSITIONS, 'all']).optional(), archived: z.enum(['active', 'archived', 'all']).optional(), limit: z.number().int().min(1).max(500).optional(), offset: z.number().int().min(0).max(1_000_000).optional() }).strict(),
  'staff.get': z.object({ id: text(64) }).strict(),
  'staff.form': z.object({}).strict(),
  'staff.create': z.object({ input: staffInput }).strict(),
  'staff.update': z.object({ id: text(64), expectedVersion: z.number().int().min(1), input: staffInput }).strict(),
  'staff.archive': z.object({ id: text(64), reason: text(500) }).strict(),
  'staff.unarchive': z.object({ id: text(64) }).strict(),
  'photo.get': z.object({ kind: z.enum(['student', 'staff']), id: text(64) }).strict(),
  'photo.pick': z.object({ kind: z.enum(['student', 'staff']), id: text(64), consentGivenBy: text(200) }).strict(),
  'photo.remove': z.object({ kind: z.enum(['student', 'staff']), id: text(64) }).strict(),
  'profile.activity': z.object({ kind: z.enum(['student', 'staff']), id: text(64) }).strict(),
  'settings.get': z.object({}).strict(),
  'settings.updateAssociation': z.object({ expectedVersion: z.number().int().min(1), name: text(500), address: text(500), contact: text(500) }).strict(),
  'settings.renameBranch': z.object({ id: text(64), expectedVersion: z.number().int().min(1), name: text(500) }).strict(),
  'settings.addBranch': z.object({ name: text(500) }).strict(),
  'account.changePassword': z.object({ oldPassword: text(500), newPassword: text(500) }).strict(),
  'backup.list': z.object({}).strict(),
  'backup.setFolder': z.object({}).strict(),
  'backup.useSuggestion': z.object({ id: text(300) }).strict(),
  'backup.setSecondFolder': z.object({}).strict(),
  'backup.clearSecondFolder': z.object({}).strict(),
  'backup.restore': z.object({ file: text(200), password: text(500), recoveryKey: text(200).optional() }).strict(),
  'finance.status': z.object({}).strict(),
  'finance.setPassword': z.object({ password: text(200) }).strict(),
  'finance.unlock': z.object({ password: text(200) }).strict(),
  'finance.lock': z.object({}).strict(),
  'finance.changePassword': z.object({ oldPassword: text(200), newPassword: text(200) }).strict(),
  'finance.resetPassword': z.object({ recoveryKey: text(200), newPassword: text(200) }).strict(),
  'finance.settings': z.object({}).strict(),
  'finance.setRate': z.object({ effectiveFrom: text(7), amount: z.number() }).strict(),
  'finance.setFreeMonth': z.object({ month: text(7), free: z.boolean(), reason: text(300).optional() }).strict(),
  'finance.record': z.object({ studentId: text(64), month: text(7), paidOn: text(10), collectorName: text(300) }).strict(),
  'finance.cancel': z.object({ id: text(64), reason: text(500) }).strict(),
  'finance.receipt': z.object({ id: text(64) }).strict(),
  'finance.payments': z.object({ search: text(200).optional(), month: text(7).optional(), status: z.enum(['live', 'cancelled', 'all']).optional(), limit: z.number().int().min(1).max(500).optional(), offset: z.number().int().min(0).max(1_000_000).optional() }).strict(),
  'finance.statement': z.object({ studentId: text(64) }).strict(),
  'finance.arrears': z.object({ branchId: text(64).optional(), search: text(200).optional(), limit: z.number().int().min(1).max(500).optional(), offset: z.number().int().min(0).max(1_000_000).optional() }).strict(),
  'finance.summary': z.object({}).strict(),
  'finance.exportArrears': z.object({ branchId: text(64).optional(), search: text(200).optional() }).strict(),
  'import.pickFile': z.object({ sheetIndex: z.number().int().min(0).max(50).optional() }).strict(),
  'import.preview': importOptions,
  'import.commit': importOptions.extend({ skipInvalid: z.boolean() }).strict(),
  'import.saveErrors': importOptions,
  'import.updatePreview': z.object({ mapping: z.object({ studentNo: z.number().int().min(0).max(100).optional(), birthDate: z.number().int().min(0).max(100).optional(), phone: z.number().int().min(0).max(100).optional(), joinedOn: z.number().int().min(0).max(100).optional() }).strict() }).strict(),
  'import.updateCommit': z.object({ mapping: z.object({ studentNo: z.number().int().min(0).max(100).optional(), birthDate: z.number().int().min(0).max(100).optional(), phone: z.number().int().min(0).max(100).optional(), joinedOn: z.number().int().min(0).max(100).optional() }).strict(), skipInvalid: z.boolean() }).strict(),
  'export.students': z.object({ format: z.enum(['xlsx', 'xml']), filter: filterSchema }).strict(),
  'groups.list': z.object({ branchId: text(64).optional(), status: z.enum(['active', 'closed', 'all']).optional() }).strict(),
  'groups.get': z.object({ id: text(64) }).strict(),
  'groups.form': z.object({}).strict(),
  'groups.create': z.object({ branchId: text(64), name: text(200), level: text(200).nullable(), capacity: z.number().int().min(1).max(500) }).strict(),
  'groups.update': z.object({ id: text(64), expectedVersion: z.number().int().min(1), name: text(200), level: text(200).nullable(), capacity: z.number().int().min(1).max(500) }).strict(),
  'groups.setStatus': z.object({ id: text(64), status: z.enum(['active', 'closed']) }).strict(),
  'groups.assignTeacher': z.object({ groupId: text(64), staffId: text(64) }).strict(),
  'groups.removeTeacher': z.object({ groupId: text(64), staffId: text(64) }).strict(),
  'groups.assignable': z.object({ groupId: text(64) }).strict(),
  'groups.unassigned': z.object({ branchId: text(64), search: text(200).optional() }).strict(),
  'groups.enroll': z.object({ groupId: text(64), studentId: text(64), mode: z.enum(['enroll', 'transfer']).optional() }).strict(),
  'groups.leave': z.object({ groupId: text(64), studentId: text(64), reason: text(500) }).strict(),
  'groups.ofStudent': z.object({ studentId: text(64) }).strict(),
  'groups.ofTeacher': z.object({ staffId: text(64) }).strict(),
  'attendance.sheet': z.object({ groupId: text(64), date: text(10) }).strict(),
  'attendance.save': z.object({ groupId: text(64), date: text(10), startTime: text(5), endTime: text(5),
    entries: z.array(z.object({ studentId: text(64), status: z.enum(ATT_STATUSES), lateMinutes: z.number().int().min(1).max(600).nullable().optional(), note: text(300).nullable().optional() }).strict()).max(1000) }).strict(),
  'attendance.cancel': z.object({ groupId: text(64), date: text(10), reason: text(500), startTime: text(5).optional(), endTime: text(5).optional() }).strict(),
  'attendance.correct': z.object({ recordId: text(64), status: z.enum(ATT_STATUSES), lateMinutes: z.number().int().min(1).max(600).nullable(), reason: text(500) }).strict(),
  'attendance.history': z.object({ groupId: text(64), from: text(10), to: text(10) }).strict(),
  'attendance.ofStudent': z.object({ studentId: text(64) }).strict(),
  'reports.enrollment': z.object({ branchId: text(64).optional() }).strict(),
  'reports.attendance': z.object({ branchId: text(64).optional(), groupId: text(64).optional(), from: text(10), to: text(10) }).strict(),
  'reports.activity': z.object({ branchId: text(64).optional(), from: text(10), to: text(10) }).strict(),
  'reports.export': z.object({ kind: z.enum(['enrollment', 'attendance', 'activity']), branchId: text(64).optional(), groupId: text(64).optional(), from: text(10).optional(), to: text(10).optional() }).strict(),
  'memo.access': z.object({}).strict(),
  'memo.progress': z.object({ studentId: text(64) }).strict(),
  'memo.record': z.object({ studentId: text(64), date: text(10), type: z.enum(MEMO_TYPES), start: z.object({ surah: z.number().int().min(1).max(114), ayah: z.number().int().min(1).max(300) }).strict(), end: z.object({ surah: z.number().int().min(1).max(114), ayah: z.number().int().min(1).max(300) }).strict(), evalRank: z.number().int().min(1).max(5).nullable(), comment: text(300).nullable().optional() }).strict(),
  'memo.void': z.object({ recordId: text(64), reason: text(500) }).strict(),
  'memo.group': z.object({ groupId: text(64) }).strict(),
  'memo.suggest': z.object({ studentId: text(64) }).strict(),
  'guardians.list': z.object({ studentId: text(64) }).strict(),
  'guardians.add': z.object({ studentId: text(64), name: text(300), phone: text(60), relation: z.enum(RELATIONS), isPrimary: z.boolean() }).strict(),
  'guardians.update': z.object({ linkId: text(64), expectedVersion: z.number().int().min(1), name: text(300), phone: text(60), relation: z.enum(RELATIONS), isPrimary: z.boolean() }).strict(),
  'guardians.remove': z.object({ linkId: text(64) }).strict(),
  'guardians.codeIssue': z.object({ guardianId: text(64) }).strict(),
  'guardians.codeRevoke': z.object({ guardianId: text(64) }).strict(),
  'guardians.whatsapp': z.object({ linkId: text(64), text: text(1000), kind: text(40) }).strict(),
  'guardians.pickFile': z.object({ sheetIndex: z.number().int().min(0).max(50).optional() }).strict(),
  'guardians.preview': z.object({ mapping: z.object({ studentNo: z.number().int().min(0).max(100).optional(), studentName: z.number().int().min(0).max(100).optional(), birthDate: z.number().int().min(0).max(100).optional(), guardianName: z.number().int().min(0).max(100).optional(), phone: z.number().int().min(0).max(100).optional(), relation: z.number().int().min(0).max(100).optional() }).strict() }).strict(),
  'guardians.commit': z.object({ mapping: z.object({ studentNo: z.number().int().min(0).max(100).optional(), studentName: z.number().int().min(0).max(100).optional(), birthDate: z.number().int().min(0).max(100).optional(), guardianName: z.number().int().min(0).max(100).optional(), phone: z.number().int().min(0).max(100).optional(), relation: z.number().int().min(0).max(100).optional() }).strict(), skipInvalid: z.boolean() }).strict(),
  'year.overview': z.object({}).strict(),
  'year.start': z.object({ name: text(300), startDate: dateStr, endDate: dateStr, copyGroups: z.boolean() }).strict(),
  'year.plan': z.object({}).strict(),
  'year.carryOver': z.object({ fromGroupId: text(64), toGroupId: text(64) }).strict(),
  'accounts.list': z.object({}).strict(),
  'accounts.create': z.object({ givenName: text(120), familyName: text(120), username: text(60), role: text(40), branchId: z.string().max(60).nullable() }).strict(),
  'accounts.setStatus': z.object({ id: z.string().max(60), status: z.enum(['active', 'disabled']) }).strict(),
  'accounts.setRole': z.object({ id: z.string().max(60), role: text(40), branchId: z.string().max(60).nullable() }).strict(),
  'accounts.resetPassword': z.object({ id: z.string().max(60) }).strict(),
  'accounts.rename': z.object({ id: z.string().max(60), givenName: text(120), familyName: text(120) }).strict(),
  'account.setFirstPassword': z.object({ newPassword: text(500) }).strict(),
  'audit.list': z.object({ userId: z.string().max(60).optional(), limit: z.number().int().min(1).max(500).optional(), beforeSeq: z.number().int().min(1).optional() }).strict(),
  'settings.logoSet': z.object({ dataUrl: z.string().max(400_000).nullable() }).strict(),
  'memo.settingsGet': z.object({}).strict(),
  'memo.settingsSet': z.object({ passRank: z.number().int().min(1).max(5), expectedVersion: z.number().int().min(1), labels: z.object({ '1': text(60), '2': text(60), '3': text(60), '4': text(60), '5': text(60) }).strict() }).strict(),
  'phone.status': z.object({}).strict(),
  'phone.enable': z.object({}).strict(),
  'phone.disable': z.object({}).strict(),
  'phone.newCode': z.object({ branchId: text(64) }).strict(),
  'phone.revoke': z.object({ id: text(64) }).strict(),
  'students.list': z.object({
    search: text(200).optional(), branchId: text(64).optional(), status: z.enum(STUDENT_STATUSES).optional(),
    archived: z.enum(['active', 'archived', 'all']).optional(), limit: z.number().int().min(1).max(500).optional(), offset: z.number().int().min(0).max(1_000_000).optional(),
  }).strict(),
  'students.get': z.object({ id: text(64) }).strict(),
  'students.form': z.object({}).strict(),
  'students.create': z.object({ input: studentInput, ignoreDuplicates: z.boolean().optional() }).strict(),
  'students.update': z.object({ id: text(64), expectedVersion: z.number().int().min(1), input: studentInput, ignoreDuplicates: z.boolean().optional() }).strict(),
  'students.archive': z.object({ id: text(64), reason: text(500) }).strict(),
  'students.unarchive': z.object({ id: text(64) }).strict(),
} satisfies Record<Channel, z.ZodType>;

export interface SessionUser { userId: string; displayName: string; assignments: Assignment[]; /** the standard admin/admin account must choose a new password before anything else (OD-050) */ mustChange?: boolean }
export interface Settings { get(): { backupFolder: string | null; secondFolder?: string | null; phoneEnabled?: boolean }; set(v: { backupFolder?: string; secondFolder?: string | null; phoneEnabled?: boolean }): void }
export interface Deps {
  db: Db; tenantId: () => string | null; version: string; authOptions?: AuthOptions;
  /** Single in-memory session: one PC, one signed-in person at a time (OD-028). */
  session: { current: SessionUser | null };
  dataDir: string; protector: Protector; settings: Settings;
  pickFolder: () => Promise<string | null>; defaultBackupFolder: string;
  /** First-run wizard state lives in main only; the recovery key is shown once and never persisted in clear. */
  wizard: { key: { key: Buffer; display: string } | null; backupFolder: string | null; restoreFile?: string | null };
  /** Moving to a new computer: picks the association's backup file (main only; the page never sees or supplies a path). */
  pickBackupFile?: () => Promise<string | null>;
  now?: () => string;
  /** File dialogs and disk access stay in main; the renderer never sees a path. */
  pickOpenFile: () => Promise<{ name: string; data: Buffer } | { error: 'too_large' } | null>;
  saveFile: (suggestedName: string, data: Buffer | string, kind: 'xlsx' | 'xml') => Promise<string | null>;
  importJob: { current: { fileName: string; sha256: string; table: Table } | null };
  /** Finance section lock (OD-036 option A): unlocked only after the finance password, relocked after idle time or sign-out. */
  finance: { lastActive: number | null };
  /** Photo handling stays in main: the renderer never gets a file path, and what is stored is a re-encoded, cropped thumbnail. */
  pickImage: () => Promise<{ data: Buffer } | { error: 'too_large' } | null>;
  processImage: (data: Buffer) => { jpeg: Buffer; width: number; height: number } | null;
  nowMs?: () => number; financeIdleMs?: number;
  /** Places proposed for the backup folder (desktop, documents, a detected Google Drive folder). Chosen by id only: the page never supplies a path. */
  suggestions?: () => FolderSuggestion[];
  /** Opens a chat link in the user's own WhatsApp (main only; only https://wa.me/ links are ever opened). */
  openExternal?: (url: string) => Promise<void>;
  /** The Wi-Fi phone page (OD-049). Off by default; only the Director (settings.manage) controls it. */
  phone?: PhoneControl;
  /** Restoring replaces the database file, so the app restarts afterwards. Automatic daily backup on sign-in is off unless enabled (main enables it). */
  dbPath: string; migrationsDir?: string; restart: () => void; autoBackup?: boolean;
}

const MUST_CHANGE_OK: readonly string[] = ['app.info', 'session.current', 'auth.login', 'auth.logout', 'auth.resetPassword', 'account.changePassword', 'account.setFirstPassword'];
export class IpcError extends Error { constructor(public code: 'unknown_channel' | 'invalid_payload' | 'forbidden') { super(code); } }

function displayName(db: Db, userId: string): string {
  const r = db.prepare(`SELECT p.given_name g, p.family_name f FROM user_account u JOIN staff_member s ON s.id=u.staff_member_id JOIN person p ON p.id=s.person_id WHERE u.id=?`).get(userId) as { g: string; f: string } | undefined;
  return r ? `${r.g} ${r.f}` : '';
}

/** Branch names the signed-in user may see, from the same domain rules used everywhere else. */
export function visibleBranches(db: Db, a: Assignment[]): { id: string; name: string }[] {
  const all = db.prepare('SELECT id, name FROM branch WHERE deleted_at IS NULL AND active=1 ORDER BY position, name').all() as { id: string; name: string }[];
  return all.filter((b) => (['student.view', 'attendance.view', 'settings.manage'] as Permission[]).some((p) => authorize(a, p, b.id).allowed));
}

const norm = (s: string) => s.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');

const FIELD_FOR_ISSUE: Record<string, string> = { ...IMPORT_FIELD_AR, branchId: IMPORT_FIELD_AR.branch };
const reasonOf = (r: ImportRow) => r.issues.map((i) => `${FIELD_FOR_ISSUE[i.field] ?? i.field}: ${IMPORT_ISSUE_AR[i.code] ?? i.code}`).join(' ؛ ');

export const READ_ERROR_AR: Record<ReadError | 'cancelled', string> = {
  cancelled: 'لم يُختر ملف.', too_large: 'الملف كبير جداً (الحد 10 ميغابايت). قسّموه إلى ملفات أصغر.', too_many_rows: 'عدد الصفوف أكبر من 20,000. قسّموا الملف.',
  too_many_columns: 'عدد الأعمدة كبير جداً.', unreadable: 'تعذّرت قراءة الملف. تأكدوا أنه Excel بصيغة xlsx أو ملف CSV سليم.', empty: 'الملف فارغ أو لا يحتوي صفوف بيانات تحت العناوين.',
  unsupported_xls: 'هذا ملف Excel قديم (xls). افتحوه في Excel واحفظوه بصيغة xlsx ثم أعيدوا المحاولة.',
};

export function createDispatcher(d: Deps) {
  const need = (): SessionUser => { if (!d.session.current) throw new IpcError('forbidden'); return d.session.current; };
  const notSetUp = () => { if (isSetUp(d.db)) throw new IpcError('forbidden'); };
  const sctx = (s: SessionUser): Ctx => ({ db: d.db, tenantId: d.tenantId() ?? '', actorId: s.userId, assignments: s.assignments, now: d.now });
  const nowMs = () => (d.nowMs ?? Date.now)();
  const resetGuard = { n: 0, until: 0 };
  const idleMs = d.financeIdleMs ?? 10 * 60 * 1000;
  const financeOpen = () => d.finance.lastActive !== null && nowMs() - d.finance.lastActive <= idleMs; // auto-relock after idle time
  const touch = () => { d.finance.lastActive = nowMs(); };
  const backupUser = (): SessionUser => { const s = need(); if (!authorize(s.assignments, 'backup.manage', null).allowed) throw new IpcError('forbidden'); return s; };
  /** Daily automatic backup, taken when someone signs in and the last verified backup is older than 20 hours. Failures never block signing in. */
  async function autoBackupIfDue(userId: string) {
    if (!d.autoBackup) return;
    try {
      const t = d.tenantId(); const key = loadRecoveryKey(d.dataDir, d.protector); const folder = d.settings.get().backupFolder; if (!t || !key || !folder) return;
      const last = d.db.prepare("SELECT finished_at at FROM backup_log WHERE verified=1 AND kind <> 'restore' ORDER BY finished_at DESC LIMIT 1").get() as { at: string } | undefined;
      if (last && Date.parse(clock()) - Date.parse(last.at) < 20 * 3600 * 1000) return;
      await backup(t, key, folder, userId, 'scheduled');
    } catch { /* never block the sign-in */ }
  }
  /** Automatic saving (REQ: nothing is lost if the power goes). Every committed change is already on disk (synchronous=FULL); on top of that an encrypted, verified backup is made
   *  when something changed since the last one: every 10 minutes while someone is signed in (timer in main), at sign-out and when the program closes. A second copy goes to the optional second folder. */
  const auto: { running: Promise<{ ran: boolean }> | null; lastAt: string | null; ok: boolean | null; secondOk: boolean | null } = { running: null, lastAt: null, ok: null, secondOk: null };
  function dirty(): boolean {
    const a = (d.db.prepare("SELECT max(at) a FROM audit_log WHERE action NOT LIKE 'login.%'").get() as { a: string | null }).a; if (!a) return false;
    const b = (d.db.prepare("SELECT max(started_at) s FROM backup_log WHERE verified = 1 AND kind <> 'restore'").get() as { s: string | null }).s;
    return !b || a > b;
  }
  function autoSave(): Promise<{ ran: boolean }> {
    if (!d.autoBackup) return Promise.resolve({ ran: false });
    if (auto.running) return auto.running;
    const job = (async () => {
      try {
        const t = d.tenantId(); const key = loadRecoveryKey(d.dataDir, d.protector); const { backupFolder: folder, secondFolder: second } = d.settings.get(); if (!t || !key || !folder || !dirty()) return { ran: false };
        const r = await backup(t, key, folder, d.session.current?.userId ?? 'system', 'scheduled'); auto.lastAt = clock(); auto.ok = r.ok;
        if (r.ok) {
          auto.secondOk = null;
          if (second && second !== folder) { try { mkdirSync(second, { recursive: true }); const dest = join(second, basename(r.file)); copyFileSync(r.file, dest + '.part'); renameSync(dest + '.part', dest); auto.secondOk = true; } catch { auto.secondOk = false; } }
          try { // keep the folders tidy: only backups the program made by itself are ever removed
            const rows = d.db.prepare("SELECT destination, finished_at AS at FROM backup_log WHERE verified = 1 AND kind = 'scheduled'").all() as { destination: string; at: string }[];
            const old = pruneScheduled(rows.filter((x) => existsSync(x.destination)).map((x) => ({ path: x.destination, atMs: Date.parse(x.at) })), Date.parse(clock()));
            for (const p of old) { rmSync(p, { force: true }); if (second) rmSync(join(second, basename(p)), { force: true }); }
          } catch { /* tidying is best effort */ }
        }
        return { ran: true };
      } catch { auto.ok = false; return { ran: false }; }
    })();
    auto.running = job; void job.finally(() => { if (auto.running === job) auto.running = null; }); // cleared only after the job really finished
    return job;
  }
  const financeUser = (): SessionUser => { const s = need(); if (!authorize(s.assignments, 'finance.manage', null).allowed) throw new IpcError('forbidden'); return s; };
  const fctx = (s: SessionUser): FinCtx => ({ db: d.db, tenantId: d.tenantId() ?? '', actorId: s.userId, now: () => (d.now ?? (() => new Date().toISOString()))(), argon2: d.authOptions?.argon2 });
  /** Every finance data call needs the session, the Director permission AND an unlocked finance section; each use renews the idle timer. */
  const financeCtx = (): Ctx => { const s = financeUser(); if (!financeOpen()) { d.finance.lastActive = null; throw new IpcError('forbidden'); } touch(); return sctx(s); };
  const clock = () => (d.now ?? (() => new Date().toISOString()))();

  async function backup(tenantId: string, key: Buffer, folder: string, actorId: string, kind: 'manual' | 'pre_import' | 'scheduled' = 'manual') {
    const stamp = clock().replace(/[:.]/g, '-');
    return createBackup(d.db, { tenantId, destFile: join(folder, `mishkat-${stamp}.mshkbk`), key: { kind: 'recovery', key }, kind, actorId }, clock);
  }

  async function dispatch(channel: unknown, payload: unknown): Promise<unknown> {
    if (typeof channel !== 'string' || !(CHANNELS as readonly string[]).includes(channel)) throw new IpcError('unknown_channel');
    const ch = channel as Channel;
    // Every call re-reads the account: a person disabled by the Director is signed out at once, and role changes apply immediately (SEC-022).
    if (d.session.current) {
      if (!accountIsActive(d.db, d.session.current.userId)) { d.session.current = null; d.finance.lastActive = null; throw new IpcError('forbidden'); }
      d.session.current.assignments = loadAssignments(d.db, d.session.current.userId);
    }
    // Until the standard account has chosen its own password, nothing else works (OD-050).
    if (d.session.current?.mustChange && !MUST_CHANGE_OK.includes(ch)) throw new IpcError('forbidden');
    const parsed = schemas[ch].safeParse(payload ?? {});
    if (!parsed.success) throw new IpcError('invalid_payload');
    const data = parsed.data as never;
    switch (ch) {
      case 'app.info': {
        return { version: d.version, logo: (() => { const t = d.tenantId(); return t ? readLogo(d.db, t) : null; })(), setupNeeded: !isSetUp(d.db), defaultAccountHint: !!d.db.prepare("SELECT 1 FROM user_account WHERE must_change_password = 1 AND lower(username) = 'admin' AND deleted_at IS NULL").get() };
      }
      case 'auth.login': {
        const t = d.tenantId(); const p = data as { username: string; password: string };
        if (!t) return { ok: false };
        const r = login(d.db, { tenantId: t, username: p.username, password: p.password }, d.authOptions);
        if (!r.ok) return { ok: false }; // one generic answer (SEC-012)
        d.session.current = { userId: r.userId, displayName: displayName(d.db, r.userId), assignments: r.assignments, mustChange: r.mustChangePassword };
        await autoBackupIfDue(r.userId);
        return { ok: true, user: view(d) };
      }
      case 'auth.resetPassword': {
        // Forgotten login password: the recovery key from the paper is the proof. Available without signing in; five wrong keys lock it for 15 minutes.
        if (!isSetUp(d.db)) throw new IpcError('forbidden'); const t = d.tenantId(); if (!t) throw new IpcError('forbidden');
        const now = nowMs(); if (resetGuard.until > now) return { ok: false, error: 'locked', retryAfterSeconds: Math.ceil((resetGuard.until - now) / 1000) };
        const p = data as { recoveryKey: string; newPassword: string }; const r = resetLoginPassword({ db: d.db, tenantId: t, now: clock, argon2: d.authOptions?.argon2 }, p.recoveryKey, p.newPassword);
        if (!r.ok && r.error === 'bad_key') { resetGuard.n++; if (resetGuard.n >= 5) { resetGuard.n = 0; resetGuard.until = now + 15 * 60_000; } return r; }
        if (r.ok) { resetGuard.n = 0; d.session.current = null; d.finance.lastActive = null; } return r;
      }
      case 'auth.logout': { const was = d.session.current; d.session.current = null; d.finance.lastActive = null; if (was) await autoSave(); return { ok: true }; } // finishing work = saving the work
      case 'session.current': return { user: d.session.current ? view(d) : null };

      case 'setup.begin': {
        notSetUp();
        if (!d.wizard.key) d.wizard.key = generateRecoveryKey();
        return { keyDisplay: d.wizard.key.display, defaultBackupFolder: d.defaultBackupFolder };
      }
      case 'setup.checkPassword': {
        notSetUp(); const p = data as { username: string; password: string };
        return { problems: checkPassword(p.password, { username: p.username }) };
      }
      case 'setup.pickBackupFolder': {
        notSetUp(); const folder = await d.pickFolder();
        if (folder) d.wizard.backupFolder = folder;
        return { folder: d.wizard.backupFolder };
      }
      case 'setup.commit': {
        notSetUp(); const p = data as { admin: never; association: never; branches: never; year: never; keyConfirm: { first: string; last: string }; defaultAccount?: boolean };
        const k = d.wizard.key; if (!k) return { ok: false, error: 'no_key' };
        const groups = k.display.split('-');
        if (norm(p.keyConfirm.first) !== norm(groups[0]!) || norm(p.keyConfirm.last) !== norm(groups[groups.length - 1]!)) return { ok: false, error: 'key_mismatch' };
        const folder = d.wizard.backupFolder ?? d.defaultBackupFolder;
        try { saveRecoveryKey(d.dataDir, d.protector, k.key); } catch { return { ok: false, error: 'os_protection_unavailable' }; }
        let res: { tenantId: string; userId: string };
        try { res = runSetup(d.db, { admin: p.admin, association: p.association, branches: p.branches, year: p.year }, k.key, { now: clock(), argon2: d.authOptions?.argon2, defaultAccount: !!p.defaultAccount }); }
        catch (e) {
          if (e instanceof SetupError) return { ok: false, error: e.code, issues: e.issues };
          return { ok: false, error: 'failed' };
        }
        d.settings.set({ backupFolder: folder });
        d.session.current = { userId: res.userId, displayName: displayName(d.db, res.userId), assignments: [{ role: 'director', branchId: null }], mustChange: !!p.defaultAccount };
        const b = await backup(res.tenantId, k.key, folder, res.userId);
        d.wizard.key = null;
        return { ok: true, user: view(d), backup: b.ok ? { ok: true } : { ok: false } };
      }
      case 'setup.restorePick': {
        // Moving to a new computer, step 1: choose the backup file. What is shown here comes from the file's (not yet authenticated) header, for recognition only.
        notSetUp(); const f = d.pickBackupFile ? await d.pickBackupFile() : null; if (!f) return { ok: false, error: 'cancelled' };
        let h; let size = 0;
        try { const buf = readFileSync(f); size = buf.length; h = readHeader(buf); } catch { return { ok: false, error: 'unreadable' }; }
        if (!h) return { ok: false, error: 'bad_format' };
        if (h.schema_version > APP_SCHEMA_VERSION) return { ok: false, error: 'newer_schema' };
        d.wizard.restoreFile = f;
        return { ok: true, name: basename(f), createdAt: h.created_at, sizeBytes: size };
      }
      case 'setup.restoreCommit': {
        // Step 2: the recovery key from the paper opens the file; it is then protected by Windows on THIS computer and the data replaces the empty database.
        notSetUp(); const f = d.wizard.restoreFile; if (!f || !existsSync(f)) return { ok: false, error: 'no_file' };
        const now = nowMs(); if (resetGuard.until > now) return { ok: false, error: 'locked', retryAfterSeconds: Math.ceil((resetGuard.until - now) / 1000) };
        const k = parseRecoveryKey((data as { recoveryKey: string }).recoveryKey);
        const wrong = (error: string) => { resetGuard.n++; if (resetGuard.n >= 5) { resetGuard.n = 0; resetGuard.until = now + 15 * 60_000; } return { ok: false, error }; };
        if (!k.ok) return wrong('bad_key');
        let buf: Buffer; try { buf = readFileSync(f); } catch { return { ok: false, error: 'no_file' }; }
        const dec = decryptBackup(buf, { kind: 'recovery', key: k.key });
        if (!dec.ok) return dec.error === 'bad_format' ? { ok: false, error: 'bad_format' } : wrong('wrong_key_or_tampered');
        resetGuard.n = 0;
        try { saveRecoveryKey(d.dataDir, d.protector, k.key); } catch { return { ok: false, error: 'os_protection_unavailable' }; }
        const forget = () => rmSync(join(d.dataDir, 'recovery.key.bin'), { force: true }); // a failed attempt leaves this installation as it was
        let r;
        try { r = restoreOnNewComputer({ db: d.db, dbPath: d.dbPath, backupFile: f, key: k.key, migrationsDir: d.migrationsDir }, clock); }
        catch (e) { console.error('[ipc] new-computer restore failed midway', e); forget(); d.restart(); return { ok: false, error: 'restore_interrupted' }; }
        if (!r.ok) { forget(); return { ok: false, error: r.error }; }
        if (!d.settings.get().backupFolder) d.settings.set({ backupFolder: d.defaultBackupFolder });
        // First backup ON THIS computer at once (the log still holds the old computer's recent backups, so the daily one would wait a day).
        let first = false;
        try { const stamp = clock().replace(/[:.]/g, '-'); first = (await createBackup(r.db, { tenantId: r.tenantId, destFile: join(d.settings.get().backupFolder!, `mishkat-${stamp}.mshkbk`), key: { kind: 'recovery', key: k.key }, kind: 'manual', actorId: 'setup' }, clock)).ok; } catch { /* reported below, never blocks the move */ }
        r.db.close(); d.wizard.restoreFile = null; d.session.current = null; d.restart(); // the database file was replaced: start again on the restored data
        return { ok: true, restarting: true, backupCreatedAt: r.backupCreatedAt, firstBackup: first };
      }

      case 'home.today': { const s = need(); const day = clock().slice(0, 10); return { date: day, rows: todayOverview(sctx(s), day) }; }
      case 'home.summary': {
        need();
        const row = d.db.prepare("SELECT finished_at at FROM backup_log WHERE verified=1 AND kind <> 'restore' ORDER BY finished_at DESC LIMIT 1").get() as { at: string } | undefined;
        return { lastBackupAt: row?.at ?? null };
      }
      case 'settings.get': { const s = need(); const r = getSettings(sctx(s)); if (!r) throw new IpcError('forbidden'); return r; }
      case 'settings.updateAssociation': { const s = need(); const p = data as { expectedVersion: number; name: string; address: string; contact: string }; return updateAssociation(sctx(s), p.expectedVersion, p); }
      case 'settings.renameBranch': { const s = need(); const p = data as { id: string; expectedVersion: number; name: string }; return renameBranch(sctx(s), p.id, p.expectedVersion, p.name); }
      case 'settings.addBranch': { const s = need(); return addBranch(sctx(s), (data as { name: string }).name); }
      case 'accounts.list': { const s = need(); const r = listAccounts(sctx(s)); if (!r) throw new IpcError('forbidden'); return { ...r, selfId: s.userId }; }
      case 'accounts.create': { const s = need(); return createAccount(sctx(s), data as { givenName: string; familyName: string; username: string; role: string; branchId: string | null }, { argon2: d.authOptions?.argon2, blocked: d.authOptions?.blocked }); }
      case 'accounts.setStatus': { const s = need(); const p = data as { id: string; status: 'active' | 'disabled' }; return setAccountStatus(sctx(s), p.id, p.status); }
      case 'accounts.setRole': { const s = need(); const p = data as { id: string; role: string; branchId: string | null }; return setAccountRole(sctx(s), p.id, p.role, p.branchId); }
      case 'accounts.resetPassword': { const s = need(); return resetAccountPassword(sctx(s), (data as { id: string }).id, { argon2: d.authOptions?.argon2 }); }
      case 'accounts.rename': { const s = need(); const p = data as { id: string; givenName: string; familyName: string }; const r = renameAccount(sctx(s), p.id, p.givenName, p.familyName); if (r.ok && p.id === s.userId) s.displayName = displayName(d.db, s.userId); return r; }
      case 'account.setFirstPassword': {
        const s = need(); const r = setFirstPassword({ db: d.db, tenantId: d.tenantId() ?? '', userId: s.userId, now: clock, argon2: d.authOptions?.argon2, blocked: d.authOptions?.blocked }, (data as { newPassword: string }).newPassword);
        if (r.ok) s.mustChange = false; return r;
      }
      case 'audit.list': { const s = need(); const r = activityLog(sctx(s), data as { userId?: string; limit?: number; beforeSeq?: number }); if (!r) throw new IpcError('forbidden'); return r; }
      case 'account.changePassword': {
        const s = need(); const p = data as { oldPassword: string; newPassword: string };
        const r = changeLoginPassword({ db: d.db, tenantId: d.tenantId() ?? '', userId: s.userId, now: clock, argon2: d.authOptions?.argon2 }, p.oldPassword, p.newPassword);
        if (r.ok) s.mustChange = false; return r;
      }
      case 'backup.list': {
        backupUser(); const folder = d.settings.get().backupFolder;
        const history = (d.db.prepare('SELECT id, kind, destination, finished_at AS at, size_bytes AS sizeBytes, verified, error FROM backup_log ORDER BY started_at DESC LIMIT 50').all() as { id: string; kind: string; destination: string; at: string | null; sizeBytes: number | null; verified: number; error: string | null }[])
          .map((r) => ({ id: r.id, kind: r.kind, file: basename(r.destination), at: r.at, sizeBytes: r.sizeBytes, verified: !!r.verified, failed: !!r.error }));
        let files: { name: string; sizeBytes: number; modifiedAt: string }[] = []; let otherFiles = 0;
        if (folder && existsSync(folder)) {
          // Several installations (e.g. a test copy and the real one) can share the same default folder. Only this association's
          // backups are offered for restore; the others are counted, never shown, so nobody picks a file that will be refused.
          const t = d.tenantId();
          const mine = (f: string): boolean => { // reads only the small unencrypted header at the start of the file
            let fd: number | null = null;
            try { fd = openSync(join(folder, f), 'r'); const buf = Buffer.alloc(12 + 65536 + 16); const n = readSync(fd, buf, 0, buf.length, 0); return readHeader(buf.subarray(0, n))?.tenant_id === t; }
            catch { return false; } finally { if (fd !== null) closeSync(fd); }
          };
          const all = readdirSync(folder).filter((f) => f.endsWith('.mshkbk'));
          const own = t ? all.filter(mine) : all; otherFiles = all.length - own.length;
          files = own.map((f) => { const st = statSync(join(folder, f)); return { name: f, sizeBytes: st.size, modifiedAt: st.mtime.toISOString() }; }).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)).slice(0, 100);
        }
        const last = d.db.prepare("SELECT finished_at at FROM backup_log WHERE verified=1 AND kind <> 'restore' ORDER BY finished_at DESC LIMIT 1").get() as { at: string } | undefined;
        const sug = (d.suggestions?.() ?? []).map((x) => ({ id: x.id, label: x.label, path: x.path, kind: x.kind }));
        return { folder, secondFolder: d.settings.get().secondFolder ?? null, suggestions: sug, auto: { lastAt: auto.lastAt, ok: auto.ok, secondOk: auto.secondOk }, history, files, otherFiles, lastBackupAt: last?.at ?? null };
      }
      case 'backup.setFolder': {
        backupUser(); const f = await d.pickFolder(); if (!f) return { ok: false, error: 'cancelled' };
        d.settings.set({ backupFolder: f }); return { ok: true, folder: f };
      }
      case 'backup.useSuggestion': {
        backupUser(); const p = data as { id: string }; const pick = (d.suggestions?.() ?? []).find((x) => x.id === p.id); if (!pick) return { ok: false, error: 'not_found' };
        try { mkdirSync(pick.path, { recursive: true }); } catch { return { ok: false, error: 'folder_unavailable' }; }
        d.settings.set({ backupFolder: pick.path }); return { ok: true, folder: pick.path };
      }
      case 'backup.setSecondFolder': {
        backupUser(); const f = await d.pickFolder(); if (!f) return { ok: false, error: 'cancelled' };
        if (f === d.settings.get().backupFolder) return { ok: false, error: 'same_folder' };
        d.settings.set({ secondFolder: f }); return { ok: true, folder: f };
      }
      case 'backup.clearSecondFolder': { backupUser(); d.settings.set({ secondFolder: null }); return { ok: true }; }
      case 'backup.restore': {
        const s = backupUser(); const p = data as { file: string; password: string; recoveryKey?: string };
        const folder = d.settings.get().backupFolder; const t = d.tenantId();
        if (!folder || !t || !/^[^\\/:*?"<>|]+\.mshkbk$/.test(p.file) || !existsSync(join(folder, p.file))) return { ok: false, error: 'file_not_found' };
        const who = checkUserPassword({ db: d.db, tenantId: t, userId: s.userId, now: clock, argon2: d.authOptions?.argon2 }, p.password); // re-authentication before a risky action (SEC-015)
        if (!who.ok) return { ok: false, error: who.error === 'locked' ? 'locked' : 'wrong_password', retryAfterSeconds: who.error === 'locked' ? who.retryAfterSeconds : undefined };
        let key = loadRecoveryKey(d.dataDir, d.protector);
        if (p.recoveryKey?.trim()) { const k = parseRecoveryKey(p.recoveryKey); if (!k.ok) return { ok: false, error: 'bad_key' }; key = k.key; }
        if (!key) return { ok: false, error: 'key_needed' };
        let r;
        try { r = await restoreBackup({ db: d.db, dbPath: d.dbPath, backupFile: join(folder, p.file), key: { kind: 'recovery', key }, tenantId: t, preRestoreDir: join(folder, 'before-restore'), actorId: s.userId, migrationsDir: d.migrationsDir }, clock); }
        catch (e) { // the database file may already have been swapped and its handle closed: the only consistent way forward is a restart
          console.error('[ipc] restore failed midway', e); d.session.current = null; d.finance.lastActive = null; d.restart();
          return { ok: false, error: 'restore_interrupted' };
        }
        if (!r.ok) return { ok: false, error: r.error };
        r.db.close(); d.session.current = null; d.finance.lastActive = null; d.restart(); // the file was replaced: start again on the restored data
        return { ok: true, restarting: true };
      }

      case 'staff.list': { const s = need(); return listStaff(sctx(s), data as never); }
      case 'staff.get': { const s = need(); return { staff: getStaff(sctx(s), (data as { id: string }).id) }; }
      case 'staff.form': {
        const s = need();
        const editable = visibleBranches(d.db, s.assignments).filter((b) => authorize(s.assignments, 'staff.edit', b.id).allowed);
        return { branches: editable, canTransfer: authorize(s.assignments, 'enrollment.transfer_cross_branch', null).allowed };
      }
      case 'staff.create': { const s = need(); return createStaff(sctx(s), (data as { input: StaffInput }).input); }
      case 'staff.update': { const s = need(); const p = data as { id: string; expectedVersion: number; input: StaffInput }; return updateStaff(sctx(s), p.id, p.expectedVersion, p.input); }
      case 'staff.archive': { const s = need(); const p = data as { id: string; reason: string }; return archiveStaff(sctx(s), p.id, p.reason); }
      case 'staff.unarchive': { const s = need(); return unarchiveStaff(sctx(s), (data as { id: string }).id); }
      case 'photo.get': { const s = need(); const p = data as { kind: 'student' | 'staff'; id: string }; return { photo: getPhoto(sctx(s), p.kind, p.id) }; }
      case 'photo.pick': {
        const s = need(); const p = data as { kind: 'student' | 'staff'; id: string; consentGivenBy: string };
        if (!p.consentGivenBy.trim()) return { ok: false, error: 'consent_required' }; // asked BEFORE any file is opened
        const f = await d.pickImage(); if (!f) return { ok: false, error: 'cancelled' }; if ('error' in f) return { ok: false, error: f.error };
        const img = d.processImage(f.data); if (!img) return { ok: false, error: 'invalid_image' };
        const r = setPhoto(sctx(s), { kind: p.kind, id: p.id, jpeg: img.jpeg, width: img.width, height: img.height, consentGivenBy: p.consentGivenBy });
        return r.ok ? { ok: true, photo: getPhoto(sctx(s), p.kind, p.id) } : r;
      }
      case 'photo.remove': { const s = need(); const p = data as { kind: 'student' | 'staff'; id: string }; return removePhoto(sctx(s), p.kind, p.id); }
      case 'profile.activity': { const s = need(); const p = data as { kind: 'student' | 'staff'; id: string }; return { rows: profileActivity(sctx(s), p.kind, p.id) }; }

      case 'finance.status': {
        const s = need(); const t = d.tenantId() ?? '';
        const canUse = authorize(s.assignments, 'finance.manage', null).allowed;
        return { canUse, configured: canUse && financePasswordSet(d.db, t), unlocked: canUse && financeOpen() };
      }
      case 'finance.setPassword': {
        const s = financeUser(); const r = setFinancePassword(fctx(s), (data as { password: string }).password);
        if (r.ok) touch(); return r;
      }
      case 'finance.unlock': {
        const s = financeUser(); const r = verifyFinancePassword(fctx(s), (data as { password: string }).password);
        if (r.ok) touch(); return r;
      }
      case 'finance.lock': need(); d.finance.lastActive = null; return { ok: true };
      case 'finance.changePassword': { const s = financeUser(); const p = data as { oldPassword: string; newPassword: string }; return changeFinancePassword(fctx(s), p.oldPassword, p.newPassword); }
      case 'finance.resetPassword': {
        const s = financeUser(); const p = data as { recoveryKey: string; newPassword: string }; const r = resetFinancePassword(fctx(s), p.recoveryKey, p.newPassword);
        if (r.ok) touch(); return r;
      }
      case 'finance.settings': { const c = financeCtx(); return { ok: true, ...feeSettings(c)!, today: clock().slice(0, 10) }; }
      case 'finance.setRate': { const c = financeCtx(); const p = data as { effectiveFrom: string; amount: number }; return setRate(c, p.effectiveFrom, p.amount); }
      case 'finance.setFreeMonth': { const c = financeCtx(); const p = data as { month: string; free: boolean; reason?: string }; return setFreeMonth(c, p.month, p.free, p.reason); }
      case 'finance.record': { const c = financeCtx(); return recordPayment(c, data as { studentId: string; month: string; paidOn: string; collectorName: string }); }
      case 'finance.cancel': { const c = financeCtx(); const p = data as { id: string; reason: string }; return cancelPayment(c, p.id, p.reason); }
      case 'finance.receipt': { const c = financeCtx(); return { receipt: getReceipt(c, (data as { id: string }).id) }; }
      case 'finance.payments': { const c = financeCtx(); return listPayments(c, data as never); }
      case 'finance.statement': { const c = financeCtx(); return { statement: studentStatement(c, (data as { studentId: string }).studentId, clock().slice(0, 10)) }; }
      case 'finance.arrears': { const c = financeCtx(); return arrearsReport(c, { ...(data as object), today: clock().slice(0, 10) }); }
      case 'finance.summary': { const c = financeCtx(); return { summary: monthSummary(c, clock().slice(0, 10)) }; }
      case 'finance.exportArrears': {
        const c = financeCtx(); const stamp = clock().slice(0, 10);
        const r = arrearsReport(c, { ...(data as object), today: stamp, limit: 20000 }); if (!r) throw new IpcError('forbidden');
        const assoc = (d.db.prepare('SELECT name FROM association LIMIT 1').get() as { name: string } | undefined)?.name ?? '';
        const xlsx = await writeXlsx({ name: 'المتأخرات', title: `${assoc} — المتأخرات حتى ${stamp}`, headers: ['رقم الطالب', 'الاسم', 'الفرع', 'عدد الأشهر', 'الأشهر غير المدفوعة', 'المبلغ المستحق (دج)', 'مؤرشف'],
          rows: r.rows.map((x) => [x.studentNo, x.name, x.branchName, x.count, x.months.join(' ، '), x.total, x.archived ? 'نعم' : 'لا']) });
        const saved = await d.saveFile(`المتأخرات-${stamp}.xlsx`, xlsx, 'xlsx'); if (!saved) return { ok: false, error: 'cancelled' };
        appendAudit(d.db, { tenant_id: d.tenantId() ?? '', at: clock(), actor_id: c.actorId, actor_role: 'director', branch_id: null, action: 'export.arrears', entity_type: 'payment', entity_id: c.actorId, before_json: null, after_json: JSON.stringify({ rows: r.rows.length, totalAmount: r.totalAmount }), reason: null });
        return { ok: true, count: r.rows.length };
      }

      case 'import.pickFile': {
        const s = need(); if (!authorize(s.assignments, 'import.run', null).allowed) throw new IpcError('forbidden');
        const f = await d.pickOpenFile();
        if (!f) return { ok: false, error: 'cancelled', message: READ_ERROR_AR.cancelled };
        if ('error' in f) return { ok: false, error: f.error, message: READ_ERROR_AR[f.error] };
        const r = await readTable(f.data, f.name, (data as { sheetIndex?: number }).sheetIndex ?? 0);
        if (!r.ok) return { ok: false, error: r.error, message: READ_ERROR_AR[r.error] };
        d.importJob.current = { fileName: f.name, sha256: sha256(f.data.toString('latin1')), table: r.table };
        const branches = visibleBranches(d.db, s.assignments);
        return { ok: true, fileName: f.name, sheetNames: r.table.sheetNames, sheetName: r.table.sheetName, headers: r.table.headers, rowCount: r.table.rows.length,
          sample: r.table.rows.slice(0, 5).map((row) => row.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : c === null ? '' : String(c)))),
          mapping: suggestMapping(r.table.headers), branches };
      }
      case 'import.updatePreview': case 'import.updateCommit': {
        const s = need(); if (!authorize(s.assignments, 'import.run', null).allowed) throw new IpcError('forbidden');
        const job = d.importJob.current; if (!job) return { ok: false, error: 'no_file' }; const p = data as { mapping: UpdateMapping; skipInvalid?: boolean };
        const problems = updateMappingProblems(p.mapping); if (problems.length) return { ok: false, error: 'mapping', problems };
        const c = sctx(s);
        if (ch === 'import.updatePreview') {
          const rep = previewStudentUpdate(c, job.table.rows, job.table.headerRow + 1, p.mapping); const issueCounts: Record<string, number> = {};
          for (const r of rep.rows) for (const i of r.issues) issueCounts[i] = (issueCounts[i] ?? 0) + 1;
          const bad = rep.rows.filter((r) => r.issues.length); const todo = rep.rows.filter((r) => !r.issues.length && !r.unchanged);
          return { ok: true, total: rep.total, toUpdate: rep.toUpdate, unchanged: rep.unchanged, withIssues: rep.withIssues, issueCounts, issueText: UPDATE_ISSUE_AR, rows: [...bad.slice(0, 200), ...todo.slice(0, 50)].map((r) => ({ row: r.row, studentNo: r.studentNo, name: r.student?.name ?? '', changes: r.changes, issues: r.issues })) };
        }
        const r = commitStudentUpdate(c, job.table.rows, job.table.headerRow + 1, p.mapping, !!p.skipInvalid); if (r.ok) d.importJob.current = null; return r;
      }
      case 'import.preview': case 'import.saveErrors': case 'import.commit': {
        const s = need(); if (!authorize(s.assignments, 'import.run', null).allowed) throw new IpcError('forbidden');
        const job = d.importJob.current; if (!job) return { ok: false, error: 'no_file' };
        const p = data as { mapping: Mapping; nameOrder: 'given-first' | 'family-first'; defaultBranchId: string | null; defaultStatus: StudentStatus; skipInvalid?: boolean };
        const c = sctx(s); const branches = visibleBranches(d.db, s.assignments);
        const report: ImportReport = analyzeImport(job.table.rows, job.table.headerRow + 1, { mapping: p.mapping, nameOrder: p.nameOrder, defaultBranchId: p.defaultBranchId, branches, defaultStatus: p.defaultStatus, today: clock().slice(0, 10) }, existingForImport(c));
        if (report.mappingProblems.length) return { ok: false, error: 'mapping', problems: report.mappingProblems };
        const bad = report.rows.filter((r) => r.issues.length);

        if (ch === 'import.preview') {
          const issueCounts: Record<string, number> = {};
          for (const r of bad) for (const i of r.issues) issueCounts[`${i.field}:${i.code}`] = (issueCounts[`${i.field}:${i.code}`] ?? 0) + 1;
          const shown = [...bad.slice(0, 200), ...report.rows.filter((r) => !r.issues.length).slice(0, 20)];
          return { ok: true, total: report.total, valid: report.ok, withIssues: report.withIssues, withWarnings: report.withWarnings, issueCounts,
            rows: shown.map((r) => ({ row: r.row, cells: r.cells, name: r.input ? `${r.input.givenName} ${r.input.familyName}`.trim() : '', studentNo: r.input?.studentNo ?? '', branchId: r.input?.branchId ?? '', issues: r.issues, warnings: r.warnings })) };
        }
        if (ch === 'import.saveErrors') {
          if (bad.length === 0) return { ok: false, error: 'no_errors' };
          const xlsx = await writeXlsx({ name: 'أخطاء الاستيراد', title: `أخطاء استيراد ${job.fileName}`, headers: ['رقم الصف', ...job.table.headers, 'سبب الخطأ'], rows: bad.map((r) => [r.row, ...r.cells, reasonOf(r)]) });
          const saved = await d.saveFile('أخطاء-الاستيراد.xlsx', xlsx, 'xlsx');
          return saved ? { ok: true, count: bad.length } : { ok: false, error: 'cancelled' };
        }
        // commit
        if (bad.length > 0 && !p.skipInvalid) return { ok: false, error: 'has_issues', withIssues: bad.length };
        const good = report.rows.filter((r) => !r.issues.length).map((r) => r.input!);
        if (good.length === 0) return { ok: false, error: 'nothing_to_import' };
        const t = d.tenantId(); const key = loadRecoveryKey(d.dataDir, d.protector); const folder = d.settings.get().backupFolder;
        if (!t || !key || !folder) return { ok: false, error: 'backup_not_configured' };
        const b = await backup(t, key, folder, s.userId, 'pre_import'); // BR-043: no verified backup, no import
        if (!b.ok) return { ok: false, error: 'backup_failed' };
        const r = importStudents(c, good, { fileName: job.fileName, fileSha256: job.sha256, rowsInFile: report.total });
        if (!r.ok) return { ok: false, error: r.error };
        d.importJob.current = null;
        return { ok: true, imported: r.count, skipped: report.total - r.count };
      }
      case 'export.students': {
        const s = need();
        const canExport = branchFilter(s.assignments, 'report.view').kind !== 'none' || branchFilter(s.assignments, 'report.view_limited').kind !== 'none';
        if (!canExport) throw new IpcError('forbidden');
        const p = data as { format: 'xlsx' | 'xml'; filter: { search?: string; branchId?: string; status?: StudentStatus; archived?: 'active' | 'archived' | 'all' } };
        const c = sctx(s); const rows = []; let offset = 0; let total = 0;
        for (;;) { const page = listStudents(c, { ...p.filter, limit: 500, offset }); total = page.total; rows.push(...page.rows); offset += 500; if (offset >= total) break; }
        const assoc = (d.db.prepare('SELECT name FROM association LIMIT 1').get() as { name: string } | undefined)?.name ?? '';
        const stamp = clock().slice(0, 10);
        let payload: Buffer | string;
        if (p.format === 'xlsx') {
          payload = await writeXlsx({ name: 'الطلاب', title: `${assoc} — قائمة الطلاب (${stamp})`, headers: ['رقم الطالب', 'الاسم', 'اللقب', 'تاريخ الميلاد', 'الهاتف', 'الفرع', 'الحالة', 'تاريخ الانضمام', 'الأرشيف', 'سبب الأرشفة'],
            rows: rows.map((r) => [r.studentNo, r.givenName, r.familyName, r.birthDate, r.phone, r.branchName, STUDENT_STATUS_AR[r.status], r.joinedOn, r.archivedAt ? 'نعم' : 'لا', r.archiveReason]) });
        } else {
          payload = toXml({ root: 'students', item: 'student', attributes: { association: assoc, exportedOn: stamp, count: String(rows.length) },
            records: rows.map((r) => ({ studentNo: r.studentNo, givenName: r.givenName, familyName: r.familyName, birthDate: r.birthDate, phone: r.phone, branch: r.branchName, status: r.status, statusLabel: STUDENT_STATUS_AR[r.status], joinedOn: r.joinedOn, archived: r.archivedAt ? 'true' : 'false', archiveReason: r.archiveReason })) });
        }
        const saved = await d.saveFile(`الطلاب-${stamp}.${p.format}`, payload, p.format);
        if (!saved) return { ok: false, error: 'cancelled' };
        appendAudit(d.db, { tenant_id: d.tenantId() ?? '', at: clock(), actor_id: s.userId, actor_role: s.assignments.map((a) => a.role).join(','), branch_id: null, action: 'export.students', entity_type: 'student', entity_id: s.userId, before_json: null, after_json: JSON.stringify({ format: p.format, count: rows.length, filter: p.filter }), reason: null });
        return { ok: true, count: rows.length, format: p.format };
      }

      case 'groups.list': { const s = need(); return { rows: listGroups(sctx(s), data as never) }; }
      case 'groups.get': { const s = need(); return { found: getGroup(sctx(s), (data as { id: string }).id) }; }
      case 'groups.form': {
        const s = need();
        return { branches: visibleBranches(d.db, s.assignments).filter((b) => authorize(s.assignments, 'group.edit', b.id).allowed), canEnroll: s.assignments.some((a) => authorize(s.assignments, 'enrollment.manage', a.branchId).allowed), canEdit: s.assignments.some((a) => authorize(s.assignments, 'group.edit', a.branchId).allowed) };
      }
      case 'groups.create': { const s = need(); return createGroup(sctx(s), data as never); }
      case 'groups.update': { const s = need(); const p = data as { id: string; expectedVersion: number; name: string; level: string | null; capacity: number }; return updateGroup(sctx(s), p.id, p.expectedVersion, { name: p.name, level: p.level, capacity: p.capacity }); }
      case 'groups.setStatus': { const s = need(); const p = data as { id: string; status: 'active' | 'closed' }; return setGroupStatus(sctx(s), p.id, p.status); }
      case 'groups.assignTeacher': { const s = need(); const p = data as { groupId: string; staffId: string }; return assignTeacher(sctx(s), p.groupId, p.staffId); }
      case 'groups.removeTeacher': { const s = need(); const p = data as { groupId: string; staffId: string }; return removeTeacher(sctx(s), p.groupId, p.staffId); }
      case 'groups.assignable': { const s = need(); return { rows: assignableTeachers(sctx(s), (data as { groupId: string }).groupId) }; }
      case 'groups.unassigned': { const s = need(); const p = data as { branchId: string; search?: string }; return { rows: unassignedStudents(sctx(s), p.branchId, p.search ?? '') }; }
      case 'groups.enroll': { const s = need(); const p = data as { groupId: string; studentId: string; mode?: 'enroll' | 'transfer' }; return enrollStudent(sctx(s), p.groupId, p.studentId, p.mode); }
      case 'groups.leave': { const s = need(); const p = data as { groupId: string; studentId: string; reason: string }; return leaveGroup(sctx(s), p.groupId, p.studentId, p.reason); }
      case 'groups.ofStudent': { const s = need(); return { info: studentGroups(sctx(s), (data as { studentId: string }).studentId) }; }
      case 'groups.ofTeacher': { const s = need(); return { rows: groupsOfTeacher(sctx(s), (data as { staffId: string }).staffId) }; }
      case 'attendance.sheet': { const s = need(); const p = data as { groupId: string; date: string }; return { sheet: getSheet(sctx(s), p.groupId, p.date) }; }
      case 'attendance.save': { const s = need(); const p = data as { groupId: string; date: string; startTime: string; endTime: string; entries: never[] }; return saveSheet(sctx(s), p.groupId, p.date, { startTime: p.startTime, endTime: p.endTime }, p.entries); }
      case 'attendance.cancel': { const s = need(); const p = data as { groupId: string; date: string; reason: string; startTime?: string; endTime?: string }; return cancelSession(sctx(s), p.groupId, p.date, p.reason, p.startTime && p.endTime ? { startTime: p.startTime, endTime: p.endTime } : undefined); }
      case 'attendance.correct': { const s = need(); const p = data as { recordId: string; status: (typeof ATT_STATUSES)[number]; lateMinutes: number | null; reason: string }; return correctRecord(sctx(s), p.recordId, p.status, p.lateMinutes, p.reason); }
      case 'attendance.history': { const s = need(); const p = data as { groupId: string; from: string; to: string }; return { history: groupHistory(sctx(s), p.groupId, p.from, p.to) }; }
      case 'attendance.ofStudent': { const s = need(); return { totals: studentAttendance(sctx(s), (data as { studentId: string }).studentId) }; }
      case 'reports.enrollment': { const s = need(); return enrollmentReport(sctx(s), data as never); }
      case 'reports.attendance': { const s = need(); return attendanceReport(sctx(s), data as never); }
      case 'reports.activity': { const s = need(); return activityReport(sctx(s), data as never); }
      case 'reports.export': {
        const s = need(); const c = sctx(s); const p = data as { kind: 'enrollment' | 'attendance' | 'activity'; branchId?: string; groupId?: string; from?: string; to?: string };
        const assoc = (d.db.prepare('SELECT name FROM association LIMIT 1').get() as { name: string } | undefined)?.name ?? ''; const stamp = clock().slice(0, 10);
        let spec: Parameters<typeof writeXlsx>[0]; let count = 0; let file = '';
        if (p.kind === 'enrollment') {
          const r = enrollmentReport(c, { branchId: p.branchId }); if (!r.ok) throw new IpcError('forbidden');
          spec = { name: 'التسجيل', title: `${assoc} — تقرير التسجيل (${stamp})`, headers: ['الفوج', 'الفرع', 'المستوى', 'المعلمون', 'عدد الطلاب', 'السعة'], rows: r.report.groups.map((g) => [g.groupName, g.branchName, g.level, g.teachers, g.students, g.capacity]) };
          count = r.report.groups.length; file = `تقرير-التسجيل-${stamp}.xlsx`;
        } else {
          if (!p.from || !p.to) throw new IpcError('invalid_payload');
          if (p.kind === 'attendance') {
            const r = attendanceReport(c, { branchId: p.branchId, groupId: p.groupId, from: p.from, to: p.to }); if (!r.ok) return { ok: false, error: r.error };
            spec = { name: 'الحضور', title: `${assoc} — تقرير الحضور من ${p.from} إلى ${p.to}`, headers: ['رقم الطالب', 'الاسم', 'الفوج', 'الفرع', 'حاضر', 'متأخر', 'غائب', 'بعذر', 'أيام مسجَّلة', 'نسبة الحضور %'],
              rows: r.rows.map((x) => [x.studentNo, x.name, x.groupName, x.branchName, x.present, x.late, x.absent, x.excused, x.recorded, x.ratePct]) };
            count = r.rows.length; file = `تقرير-الحضور-${p.from}-${p.to}.xlsx`;
          } else {
            const r = activityReport(c, { branchId: p.branchId, from: p.from, to: p.to }); if (!r.ok) return { ok: false, error: r.error };
            spec = { name: 'النشاط', title: `${assoc} — نشاط الأفواج من ${p.from} إلى ${p.to}`, headers: ['الفوج', 'الفرع', 'المعلمون', 'حصص عُقدت', 'أيام بلا حصة', 'تسجيلات حضور'], rows: r.rows.map((x) => [x.groupName, x.branchName, x.teachers, x.held, x.cancelled, x.recorded]) };
            count = r.rows.length; file = `نشاط-الأفواج-${p.from}-${p.to}.xlsx`;
          }
        }
        const saved = await d.saveFile(file, await writeXlsx(spec), 'xlsx'); if (!saved) return { ok: false, error: 'cancelled' };
        appendAudit(d.db, { tenant_id: d.tenantId() ?? '', at: clock(), actor_id: s.userId, actor_role: s.assignments.map((a) => a.role).join(','), branch_id: null, action: 'export.report', entity_type: 'report', entity_id: s.userId, before_json: null, after_json: JSON.stringify({ kind: p.kind, rows: count }), reason: null });
        return { ok: true, count };
      }
      case 'memo.access': { const s = need(); return { canView: s.assignments.some((a) => authorize(s.assignments, 'memorization.view', a.branchId).allowed), canRecord: s.assignments.some((a) => authorize(s.assignments, 'memorization.record', a.branchId).allowed) }; }
      case 'memo.progress': { const s = need(); return { progress: studentProgress(sctx(s), (data as { studentId: string }).studentId) }; }
      case 'memo.record': { const s = need(); const p = data as { studentId: string; date: string; type: (typeof MEMO_TYPES)[number]; start: { surah: number; ayah: number }; end: { surah: number; ayah: number }; evalRank: number | null; comment?: string | null }; return recordMemorization(sctx(s), { studentId: p.studentId, date: p.date, type: p.type, range: { start: p.start, end: p.end }, evalRank: p.evalRank, comment: p.comment }); }
      case 'memo.void': { const s = need(); const p = data as { recordId: string; reason: string }; return voidMemorization(sctx(s), p.recordId, p.reason); }
      case 'memo.group': { const s = need(); return { rows: groupProgress(sctx(s), (data as { groupId: string }).groupId) }; }
      case 'memo.suggest': { const s = need(); return { next: nextAyahSuggestion(sctx(s), (data as { studentId: string }).studentId) }; }
      case 'guardians.list': { const s = need(); return { rows: listGuardians(sctx(s), (data as { studentId: string }).studentId)?.map((g) => ({ ...g, hasCode: guardianHasCode(d.db, g.guardianId) })) ?? null }; }
      case 'guardians.codeIssue': { const s = need(); return issueGuardianCode(sctx(s), (data as { guardianId: string }).guardianId); }
      case 'guardians.codeRevoke': { const s = need(); return revokeGuardianCode(sctx(s), (data as { guardianId: string }).guardianId); }
      case 'guardians.add': { const s = need(); const p = data as { studentId: string; name: string; phone: string; relation: (typeof RELATIONS)[number]; isPrimary: boolean }; return addGuardian(sctx(s), p.studentId, { name: p.name, phone: p.phone, relation: p.relation, isPrimary: p.isPrimary }); }
      case 'guardians.update': { const s = need(); const p = data as { linkId: string; expectedVersion: number; name: string; phone: string; relation: (typeof RELATIONS)[number]; isPrimary: boolean }; return updateGuardian(sctx(s), p.linkId, p.expectedVersion, { name: p.name, phone: p.phone, relation: p.relation, isPrimary: p.isPrimary }); }
      case 'guardians.remove': { const s = need(); return removeGuardian(sctx(s), (data as { linkId: string }).linkId); }
      case 'guardians.whatsapp': {
        const s = need(); const p = data as { linkId: string; text: string; kind: string }; const c = sctx(s); const t = whatsappTarget(c, p.linkId);
        if (!t || !d.openExternal) return { ok: false, error: 'not_available' };
        const url = whatsappUrl(t.e164, p.text); if (!url.startsWith(WHATSAPP_PREFIX)) return { ok: false, error: 'not_available' };
        await d.openExternal(url); logMessage(c, t, p.kind); return { ok: true }; // opened the chat; whether the person pressed "send" is not known to the program
      }
      case 'guardians.pickFile': {
        const s = need(); if (!s.assignments.some((a) => authorize(s.assignments, 'guardian.edit', a.branchId).allowed)) throw new IpcError('forbidden');
        const f = await d.pickOpenFile(); if (!f) return { ok: false, error: 'cancelled', message: READ_ERROR_AR.cancelled }; if ('error' in f) return { ok: false, error: f.error, message: READ_ERROR_AR[f.error] };
        const r = await readTable(f.data, f.name, (data as { sheetIndex?: number }).sheetIndex ?? 0); if (!r.ok) return { ok: false, error: r.error, message: READ_ERROR_AR[r.error] };
        d.importJob.current = { fileName: f.name, sha256: sha256(f.data.toString('latin1')), table: r.table };
        return { ok: true, fileName: f.name, headers: r.table.headers, rowCount: r.table.rows.length, sample: r.table.rows.slice(0, 5).map((row) => row.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : c === null ? '' : String(c)))), mapping: suggestGuardianMapping(r.table.headers), fields: GUARDIAN_FIELD_AR };
      }
      case 'guardians.preview': case 'guardians.commit': {
        const s = need(); if (!s.assignments.some((a) => authorize(s.assignments, 'guardian.edit', a.branchId).allowed)) throw new IpcError('forbidden');
        const job = d.importJob.current; if (!job) return { ok: false, error: 'no_file' }; const p = data as { mapping: GuardianMapping; skipInvalid?: boolean };
        const problems = guardianMappingProblems(p.mapping); if (problems.length) return { ok: false, error: 'mapping', problems };
        const c = sctx(s);
        if (ch === 'guardians.preview') {
          const rep = previewGuardianImport(c, job.table.rows, job.table.headerRow + 1, p.mapping); const issueCounts: Record<string, number> = {};
          for (const r of rep.rows) for (const i of r.issues) issueCounts[i] = (issueCounts[i] ?? 0) + 1;
          const bad = rep.rows.filter((r) => r.issues.length); const good = rep.rows.filter((r) => !r.issues.length);
          return { ok: true, total: rep.total, valid: rep.ok, withIssues: rep.withIssues, issueCounts, issueText: GIMPORT_ISSUE_AR, warningText: GIMPORT_WARNING_AR, rows: [...bad.slice(0, 200), ...good.slice(0, 20)].map((r) => ({ row: r.row, student: r.student, guardianName: r.guardianName, phone: r.phone, issues: r.issues, warnings: r.warnings })) };
        }
        const r = commitGuardianImport(c, job.table.rows, job.table.headerRow + 1, p.mapping, !!p.skipInvalid); if (r.ok) d.importJob.current = null; return r;
      }
      case 'year.overview': { const s = need(); return { overview: yearOverview(sctx(s)) }; }
      case 'year.start': { const s = need(); return startNewYear(sctx(s), data as never); }
      case 'year.plan': { const s = need(); return { plan: carryOverPlan(sctx(s)) }; }
      case 'year.carryOver': { const s = need(); const p = data as { fromGroupId: string; toGroupId: string }; return carryOver(sctx(s), p.fromGroupId, p.toGroupId); }
      case 'settings.logoSet': { const s = need(); return saveLogo(sctx(s), (data as { dataUrl: string | null }).dataUrl); }
      case 'memo.settingsGet': { const s = need(); const m = getMemoSettings(sctx(s)); return { passRank: m.passRank, version: m.version, scale: scaleList(m), canEdit: authorize(s.assignments, 'settings.manage', null).allowed }; }
      case 'memo.settingsSet': { const s = need(); const p = data as { passRank: number; expectedVersion: number; labels: Record<string, string> }; return saveMemoSettings(sctx(s), { passRank: p.passRank, expectedVersion: p.expectedVersion, labels: Object.fromEntries(Object.entries(p.labels).map(([k, v]) => [Number(k), v])) }); }
      case 'phone.status': case 'phone.enable': case 'phone.disable': case 'phone.newCode': case 'phone.revoke': {
        const s = need(); if (!authorize(s.assignments, 'settings.manage', null).allowed || !d.phone) throw new IpcError('forbidden');
        const branches = visibleBranches(d.db, s.assignments);
        if (ch === 'phone.status') return { ...d.phone.status(), branches };
        if (ch === 'phone.enable') { const r = await d.phone.enable(); appendAudit(d.db, { tenant_id: d.tenantId() ?? '', at: clock(), actor_id: s.userId, actor_role: 'director', branch_id: null, action: 'phone.enable', entity_type: 'phone', entity_id: 'server', before_json: null, after_json: JSON.stringify({ running: r.running }), reason: null }); return { ...r, branches }; }
        if (ch === 'phone.disable') { const r = await d.phone.disable(); appendAudit(d.db, { tenant_id: d.tenantId() ?? '', at: clock(), actor_id: s.userId, actor_role: 'director', branch_id: null, action: 'phone.disable', entity_type: 'phone', entity_id: 'server', before_json: null, after_json: null, reason: null }); return { ...r, branches }; }
        if (ch === 'phone.newCode') { const p = data as { branchId: string }; if (p.branchId !== 'all' && !branches.some((b) => b.id === p.branchId)) return { ok: false, error: 'no_branch' }; return d.phone.newCode(p.branchId === 'all' ? 'all' : [p.branchId]); }
        const p = data as { id: string }; return { ok: d.phone.revoke(p.id, s.userId) };
      }
      case 'students.list': {
        const s = need(); const c = sctx(s);
        return { ...listStudents(c, data as never), counts: studentCounts(c, (data as { branchId?: string }).branchId) };
      }
      case 'students.get': { const s = need(); return { student: getStudent(sctx(s), (data as { id: string }).id) }; }
      case 'students.form': {
        const s = need(); const c = sctx(s);
        const editable = visibleBranches(d.db, s.assignments).filter((b) => authorize(s.assignments, 'student.edit', b.id).allowed);
        return { nextNo: nextStudentNo(c), branches: editable, canTransfer: authorize(s.assignments, 'enrollment.transfer_cross_branch', null).allowed };
      }
      case 'students.create': { const s = need(); const p = data as { input: StudentInput; ignoreDuplicates?: boolean }; return createStudent(sctx(s), p.input, { ignoreDuplicates: p.ignoreDuplicates }); }
      case 'students.update': { const s = need(); const p = data as { id: string; expectedVersion: number; input: StudentInput; ignoreDuplicates?: boolean }; return updateStudent(sctx(s), p.id, p.expectedVersion, p.input, { ignoreDuplicates: p.ignoreDuplicates }); }
      case 'students.archive': { const s = need(); const p = data as { id: string; reason: string }; return archiveStudent(sctx(s), p.id, p.reason); }
      case 'students.unarchive': { const s = need(); return unarchiveStudent(sctx(s), (data as { id: string }).id); }

      case 'backup.now': {
        const s = need();
        if (!authorize(s.assignments, 'backup.manage', null).allowed) throw new IpcError('forbidden');
        const t = d.tenantId(); const key = loadRecoveryKey(d.dataDir, d.protector); const folder = d.settings.get().backupFolder;
        if (!t || !key || !folder) return { ok: false, error: 'not_configured' };
        const b = await backup(t, key, folder, s.userId);
        return b.ok ? { ok: true } : { ok: false, error: 'backup_failed' };
      }
    }
  }
  return Object.assign(dispatch, { autoSave });
}

function activeYearName(d: Deps): string | null {
  return (d.db.prepare("SELECT name FROM academic_year WHERE status = 'active' AND deleted_at IS NULL LIMIT 1").get() as { name: string } | undefined)?.name ?? null;
}
function view(d: Deps) {
  const s = d.session.current!;
  const permissions = PERMISSIONS.filter((p) => branchFilter(s.assignments, p).kind !== 'none');
  const assoc = (d.db.prepare('SELECT name FROM association LIMIT 1').get() as { name: string } | undefined)?.name ?? '';
  const username = (d.db.prepare('SELECT username FROM user_account WHERE id = ?').get(s.userId) as { username: string } | undefined)?.username ?? '';
  return { username, logo: readLogo(d.db, d.tenantId() ?? ''), mustChange: !!s.mustChange, displayName: s.displayName, associationName: assoc, yearName: activeYearName(d), roles: s.assignments.map((a) => a.role), branches: visibleBranches(d.db, s.assignments), permissions };
}
