import { STUDENT_STATUS_AR, STAFF_POSITION_AR, STAFF_KIND_AR, type StaffInput, type StaffPosition, type StaffKind, type SetupInput, type SetupIssue, type StudentInput, type StudentIssue, type StudentStatus } from '@mishkat/domain';

export interface UserView { username?: string; logo?: string | null; mustChange?: boolean; displayName: string; associationName: string; yearName: string | null; roles: string[]; branches: { id: string; name: string }[]; permissions: string[] }
export interface StudentRow {
  id: string; studentNo: string; givenName: string; familyName: string; birthDate: string | null; phone: string | null;
  branchId: string; branchName: string; status: StudentStatus; joinedOn: string | null; archivedAt: string | null; archiveReason: string | null; version: number;
}
export interface StudentQuery { search?: string; branchId?: string; status?: StudentStatus; archived?: 'active' | 'archived' | 'all'; limit?: number; offset?: number }
export type StudentFail = 'forbidden' | 'not_found' | 'invalid' | 'duplicate_number' | 'duplicates' | 'branch_not_found' | 'conflict' | 'has_enrollments' | 'archived' | 'already_archived' | 'not_archived' | 'reason_required';
export type StudentResult<T = object> = ({ ok: true } & T) | { ok: false; error: StudentFail; issues?: StudentIssue[]; duplicates?: StudentRow[] };
export type AppInfo = { version: string; logo?: string | null; setupNeeded: boolean; defaultAccountHint?: boolean };
export type CommitResult =
  | { ok: true; user: UserView; backup: { ok: boolean } }
  | { ok: false; error: 'no_key' | 'key_mismatch' | 'os_protection_unavailable' | 'already_set_up' | 'username_taken' | 'failed' }
  | { ok: false; error: 'invalid'; issues: SetupIssue[] };

declare global { interface Window { mishkat: { invoke(channel: string, payload?: unknown): Promise<unknown> } } }

/** Thin typed wrappers. The main process validates everything again; this is convenience, not security. */
const call = <T>(channel: string, payload?: unknown) => window.mishkat.invoke(channel, payload) as Promise<T>;

const baseApi = {
  info: () => call<AppInfo>('app.info'),
  current: () => call<{ user: UserView | null }>('session.current'),
  login: (username: string, password: string) => call<{ ok: boolean; user?: UserView }>('auth.login', { username, password }),
  logout: () => call<{ ok: boolean }>('auth.logout'),
  setupBegin: () => call<{ keyDisplay: string; defaultBackupFolder: string }>('setup.begin'),
  checkPassword: (username: string, password: string) => call<{ problems: string[] }>('setup.checkPassword', { username, password }),
  pickBackupFolder: () => call<{ folder: string | null }>('setup.pickBackupFolder'),
  restorePick: () => call<{ ok: true; name: string; createdAt: string; sizeBytes: number } | { ok: false; error: string }>('setup.restorePick'),
  restoreCommit: (recoveryKey: string) => call<{ ok: boolean; error?: string; restarting?: boolean; backupCreatedAt?: string; firstBackup?: boolean; retryAfterSeconds?: number }>('setup.restoreCommit', { recoveryKey }),
  setupCommit: (input: SetupInput, keyConfirm: { first: string; last: string }) => call<CommitResult>('setup.commit', { ...input, keyConfirm, defaultAccount: true }),
  homeSummary: () => call<{ lastBackupAt: string | null }>('home.summary'),
  studentsList: (q: StudentQuery) => call<{ rows: StudentRow[]; total: number; counts: { active: number; archived: number } }>('students.list', q),
  studentsForm: () => call<{ nextNo: string; branches: { id: string; name: string }[]; canTransfer: boolean }>('students.form'),
  studentCreate: (input: StudentInput, ignoreDuplicates?: boolean) => call<StudentResult<{ id: string }>>('students.create', { input, ignoreDuplicates }),
  studentUpdate: (id: string, expectedVersion: number, input: StudentInput, ignoreDuplicates?: boolean) => call<StudentResult>('students.update', { id, expectedVersion, input, ignoreDuplicates }),
  studentArchive: (id: string, reason: string) => call<StudentResult>('students.archive', { id, reason }),
  studentUnarchive: (id: string) => call<StudentResult>('students.unarchive', { id }),
  backupNow: () => call<{ ok: boolean; error?: string }>('backup.now'),
};

export const ROLE_LABEL: Record<string, string> = {
  director: 'المدير', branch_supervisor: 'مشرف الفرع', registrar: 'التسجيل', academic_supervisor: 'المشرف التربوي',
};

/** Arabic messages: what happened and how to fix it; no blame (DESIGN_SYSTEM section 7). */
export const ISSUE_TEXT: Record<string, string> = {
  required: 'هذا الحقل مطلوب.',
  too_long: 'النص أطول من المسموح. اختصروه.',
  duplicate: 'هذا الاسم مستخدم لفرع آخر. اختاروا اسماً مختلفاً.',
  bad_date: 'التاريخ غير صحيح. اختاروه من التقويم.',
  date_order: 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية.',
  bad_username: 'اسم المستخدم من 3 إلى 40 حرفاً، دون مسافات: حروف وأرقام ونقطة وشرطة فقط.',
  too_many: 'عدد الفروع أكبر من المسموح.',
};
export const PASSWORD_TEXT: Record<string, string> = {
  too_short: 'كلمة المرور قصيرة. استخدموا 10 أحرف على الأقل، وتكفي عبارة من عدة كلمات.',
  common: 'كلمة المرور شائعة وسهلة التخمين. اختاروا غيرها.',
  contains_username: 'كلمة المرور تحتوي اسم المستخدم. اختاروا غيرها.',
  blank: 'اكتبوا كلمة المرور.',
};

export const STATUS_LABEL = STUDENT_STATUS_AR;
export const STATUS_TONE: Record<StudentStatus, string> = { applicant: 'teal', active: 'ok', suspended: 'warn', completed: 'neutral', withdrawn: 'bad' };
export const STUDENT_ISSUE_TEXT: Record<string, string> = {
  required: 'هذا الحقل مطلوب.', too_long: 'النص أطول من المسموح. اختصروه.', bad_date: 'التاريخ غير صحيح. اختاروه من التقويم.',
  future_date: 'التاريخ في المستقبل. اختاروا تاريخاً سبق.', too_old: 'التاريخ قديم جداً. راجعوا السنة.',
  bad_phone: 'رقم الهاتف غير صحيح. أرقام ورمز + وشرطة ومسافة فقط.', bad_status: 'الحالة غير صحيحة.',
  bad_student_no: 'رقم الطالب من 1 إلى 30 حرفاً أو رقماً، دون مسافات.',
};
export const STUDENT_ERROR_TEXT: Record<string, string> = {
  forbidden: 'لا تملكون صلاحية هذا الإجراء.', not_found: 'لم يعد هذا الطالب متاحاً. أعيدوا تحميل القائمة.',
  duplicate_number: 'رقم الطالب مستخدم لطالب آخر. اختاروا رقماً مختلفاً.', branch_not_found: 'الفرع غير متاح. اختاروا فرعاً آخر.',
  conflict: 'عُدِّل هذا السجل من مكان آخر قبل حفظكم. أعيدوا فتحه ثم أعيدوا التعديل.',
  has_enrollments: 'لا يمكن نقل طالب مسجَّل في حلقة بين الفروع من هنا. يتم النقل من شاشة الحلقات لاحقاً.',
  archived: 'الطالب مؤرشف. أعيدوه من الأرشيف أولاً ثم عدّلوه.', already_archived: 'الطالب مؤرشف من قبل.', not_archived: 'الطالب ليس في الأرشيف.',
  reason_required: 'اكتبوا سبب الأرشفة (حتى 300 حرف).', invalid: 'بعض البيانات تحتاج إلى تصحيح. راجعوا الحقول المعلَّمة.',
};

// ---- import / export ----
export type ImportMapping = Partial<Record<'fullName' | 'givenName' | 'familyName' | 'studentNo' | 'birthDate' | 'phone' | 'branch' | 'status' | 'joinedOn', number>>;
export interface ImportOptionsUI { mapping: ImportMapping; nameOrder: 'given-first' | 'family-first'; defaultBranchId: string | null; defaultStatus: StudentStatus }
export type ImportFileResult =
  | { ok: true; fileName: string; sheetNames: string[]; sheetName: string; headers: string[]; rowCount: number; sample: string[][]; mapping: ImportMapping; branches: { id: string; name: string }[] }
  | { ok: false; error: string; message?: string };
export interface ImportPreviewRow { row: number; cells: string[]; name: string; studentNo: string; branchId: string; issues: { field: string; code: string }[]; warnings: { code: string; withRow?: number }[] }
export type ImportPreviewResult =
  | { ok: true; total: number; valid: number; withIssues: number; withWarnings: number; issueCounts: Record<string, number>; rows: ImportPreviewRow[] }
  | { ok: false; error: string; problems?: string[] };
export type ImportCommitResult = { ok: true; imported: number; skipped: number } | { ok: false; error: string; withIssues?: number };
export type ExportFilter = { search?: string; branchId?: string; status?: StudentStatus; archived?: 'active' | 'archived' | 'all' };

export const api = {
  ...baseApi,
  importPick: (sheetIndex?: number) => call<ImportFileResult>('import.pickFile', sheetIndex === undefined ? {} : { sheetIndex }),
  importPreview: (o: ImportOptionsUI) => call<ImportPreviewResult>('import.preview', o),
  importCommit: (o: ImportOptionsUI, skipInvalid: boolean) => call<ImportCommitResult>('import.commit', { ...o, skipInvalid }),
  importSaveErrors: (o: ImportOptionsUI) => call<{ ok: boolean; error?: string; count?: number }>('import.saveErrors', o),
  studentGet: (id: string) => call<{ student: StudentRow | null }>('students.get', { id }),
  logoSet: (dataUrl: string | null) => call<{ ok: true } | { ok: false; error: 'forbidden' | 'invalid' | 'too_big' }>('settings.logoSet', { dataUrl }),
  settingsGet: () => call<SettingsData>('settings.get'),
  settingsUpdateAssociation: (expectedVersion: number, name: string, address: string, contact: string) => call<SettingsResult>('settings.updateAssociation', { expectedVersion, name, address, contact }),
  settingsRenameBranch: (id: string, expectedVersion: number, name: string) => call<SettingsResult>('settings.renameBranch', { id, expectedVersion, name }),
  settingsAddBranch: (name: string) => call<SettingsResult>('settings.addBranch', { name }),
  accountChangePassword: (oldPassword: string, newPassword: string) => call<SettingsResult>('account.changePassword', { oldPassword, newPassword }),
  backupList: () => call<BackupList>('backup.list'),
  backupSetFolder: () => call<{ ok: boolean; folder?: string }>('backup.setFolder'),
  backupUseSuggestion: (id: string) => call<{ ok: boolean; error?: string }>('backup.useSuggestion', { id }),
  backupSetSecondFolder: () => call<{ ok: boolean; error?: string }>('backup.setSecondFolder'),
  backupClearSecondFolder: () => call<{ ok: boolean }>('backup.clearSecondFolder'),
  backupRestore: (file: string, password: string, recoveryKey?: string) => call<{ ok: boolean; error?: string; restarting?: boolean; retryAfterSeconds?: number }>('backup.restore', { file, password, recoveryKey: recoveryKey || undefined }),
  staffGet: (id: string) => call<{ staff: StaffRow | null }>('staff.get', { id }),
  staffList: (q: { search?: string; branchId?: string; position?: StaffPosition | 'all'; archived?: 'active' | 'archived' | 'all'; limit?: number; offset?: number }) => call<{ rows: StaffRow[]; total: number }>('staff.list', q),
  staffForm: () => call<{ branches: { id: string; name: string }[]; canTransfer: boolean }>('staff.form'),
  staffCreate: (input: StaffInput) => call<StaffResult<{ id: string }>>('staff.create', { input }),
  staffUpdate: (id: string, expectedVersion: number, input: StaffInput) => call<StaffResult>('staff.update', { id, expectedVersion, input }),
  staffArchive: (id: string, reason: string) => call<StaffResult>('staff.archive', { id, reason }),
  staffUnarchive: (id: string) => call<StaffResult>('staff.unarchive', { id }),
  photoGet: (kind: 'student' | 'staff', id: string) => call<{ photo: PhotoData | null }>('photo.get', { kind, id }),
  photoPick: (kind: 'student' | 'staff', id: string, consentGivenBy: string) => call<{ ok: boolean; error?: string; photo?: PhotoData | null }>('photo.pick', { kind, id, consentGivenBy }),
  photoRemove: (kind: 'student' | 'staff', id: string) => call<{ ok: boolean; error?: string }>('photo.remove', { kind, id }),
  profileActivity: (kind: 'student' | 'staff', id: string) => call<{ rows: ActivityRow[] | null }>('profile.activity', { kind, id }),
  financeStatus: () => call<{ canUse: boolean; configured: boolean; unlocked: boolean }>('finance.status'),
  financeSetPassword: (password: string) => call<PwResult>('finance.setPassword', { password }),
  financeUnlock: (password: string) => call<PwResult>('finance.unlock', { password }),
  financeLock: () => call<{ ok: boolean }>('finance.lock'),
  financeChangePassword: (oldPassword: string, newPassword: string) => call<PwResult>('finance.changePassword', { oldPassword, newPassword }),
  financeResetPassword: (recoveryKey: string, newPassword: string) => call<PwResult>('finance.resetPassword', { recoveryKey, newPassword }),
  financeSettings: () => call<FinanceSettings | { error: string }>('finance.settings'),
  financeSetRate: (effectiveFrom: string, amount: number) => call<FinResult>('finance.setRate', { effectiveFrom, amount }),
  financeSetFreeMonth: (month: string, free: boolean, reason?: string) => call<FinResult>('finance.setFreeMonth', { month, free, reason }),
  financeRecord: (studentId: string, month: string, paidOn: string, collectorName: string) => call<FinResult<{ id: string; receiptNo: number; amount: number }>>('finance.record', { studentId, month, paidOn, collectorName }),
  financeCancel: (id: string, reason: string) => call<FinResult>('finance.cancel', { id, reason }),
  financeReceipt: (id: string) => call<{ receipt: Receipt | null }>('finance.receipt', { id }),
  financePayments: (q: { search?: string; month?: string; status?: 'live' | 'cancelled' | 'all'; limit?: number; offset?: number }) => call<{ rows: PaymentRow[]; total: number }>('finance.payments', q),
  financeStatement: (studentId: string) => call<{ statement: Statement | null }>('finance.statement', { studentId }),
  financeArrears: (q: { branchId?: string; search?: string; limit?: number; offset?: number }) => call<{ rows: ArrearsRow[]; total: number; totalAmount: number; unpricedMonths: number }>('finance.arrears', q),
  financeSummary: () => call<{ summary: MonthSummary | null }>('finance.summary'),
  financeExportArrears: (q: { branchId?: string; search?: string }) => call<{ ok: boolean; error?: string; count?: number }>('finance.exportArrears', q),
  exportStudents: (format: 'xlsx' | 'xml', filter: ExportFilter) => call<{ ok: boolean; error?: string; count?: number }>('export.students', { format, filter }),
};

// ---- finance ----
export type PwResult = { ok: true } | { ok: false; error: 'weak' | 'already_set' | 'not_set' | 'wrong' | 'locked' | 'bad_key'; retryAfterSeconds?: number };
export type FinResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export interface MonthLine { month: string; status: 'paid' | 'due' | 'upcoming' | 'free' | 'no_rate'; amount: number | null; receiptNo: number | null; paidOn: string | null }
export interface Statement { student: { id: string; no: string; name: string; branchName: string }; year: { id: string; name: string; startDate: string; endDate: string }; lines: MonthLine[]; arrears: { months: string[]; total: number; unpriced: number } }
export interface FinanceSettings { ok: true; year: { id: string; name: string; startDate: string; endDate: string } | null; rates: { effectiveFrom: string; amount: number }[]; freeMonths: string[]; months: string[]; today: string }
export interface Receipt { id: string; receiptNo: number; yearName: string; association: string; studentName: string; studentNo: string; branchName: string; month: string; amount: number; paidOn: string; collectorName: string; cancelledAt: string | null; cancelReason: string | null }
export type PaymentRow = Omit<Receipt, 'yearName' | 'association'>;
export interface ArrearsRow { studentId: string; studentNo: string; name: string; branchName: string; archived: boolean; months: string[]; count: number; total: number; unpriced: number }
export interface MonthSummary { month: string; rate: number | null; owing: number; paid: number; unpaid: number; expected: number; collected: number }

const MONTH_NAMES = ['جانفي', 'فيفري', 'مارس', 'أفريل', 'ماي', 'جوان', 'جويلية', 'أوت', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
/** "2026-09" -> { name: "سبتمبر", year: "2026" } (Algerian month names). */
export const monthParts = (m: string): { name: string; year: string } => ({ name: MONTH_NAMES[Number(m.slice(5, 7)) - 1] ?? m, year: m.slice(0, 4) });
export const money = (n: number): string => new Intl.NumberFormat('en-US').format(n);

/** Correct Arabic counted noun: 1 طالب، 2 طالبان، 3-10 طلاب، 11+ طالباً. */
export const studentsWord = (n: number): string => (n === 1 ? 'طالب' : n === 2 ? 'طالبان' : n >= 3 && n <= 10 ? 'طلاب' : 'طالباً');

// ---- staff, photos, activity ----
export interface StaffRow { id: string; personId: string; givenName: string; familyName: string; birthDate: string | null; phone: string | null; branchId: string | null; branchName: string | null; position: StaffPosition; kind: StaffKind; archivedAt: string | null; archiveReason: string | null; version: number; hasPhoto: boolean }
export type StaffResult<T = object> = ({ ok: true } & T) | { ok: false; error: string; issues?: { field: string; code: string }[] };
export interface PhotoData { mime: string; base64: string; width: number; height: number }
export interface ActivityRow { seq: number; at: string; action: string; reason: string | null; changes: string[] }
export const POSITION_LABEL = STAFF_POSITION_AR; export const KIND_LABEL = STAFF_KIND_AR;
export const STAFF_ISSUE_TEXT: Record<string, string> = { ...STUDENT_ISSUE_TEXT, bad_position: 'الوظيفة غير صحيحة.', bad_kind: 'النوع غير صحيح.' };
export const STAFF_ERROR_TEXT: Record<string, string> = {
  forbidden: 'لا تملكون صلاحية هذا الإجراء.', not_found: 'لم يعد هذا السجل متاحاً. أعيدوا تحميل القائمة.', branch_not_found: 'الفرع غير متاح. اختاروا فرعاً آخر.',
  conflict: 'عُدِّل هذا السجل من مكان آخر قبل حفظكم. أعيدوا فتحه ثم أعيدوا التعديل.', archived: 'السجل مؤرشف. أعيدوه من الأرشيف أولاً ثم عدّلوه.',
  already_archived: 'السجل مؤرشف من قبل.', not_archived: 'السجل ليس في الأرشيف.', reason_required: 'اكتبوا السبب (حتى 300 حرف).', invalid: 'بعض البيانات تحتاج إلى تصحيح. راجعوا الحقول المعلَّمة.',
};
export const PHOTO_ERROR_TEXT: Record<string, string> = {
  consent_required: 'اكتبوا من وافق على حفظ الصورة قبل اختيارها.', too_large: 'الصورة كبيرة جداً (الحد 15 ميغابايت). اختاروا صورة أصغر.', invalid_image: 'تعذّرت قراءة الصورة. اختاروا ملف صورة سليماً (jpg أو png).',
  forbidden: 'لا تملكون صلاحية تغيير الصورة.', not_found: 'لم يعد هذا السجل متاحاً.',
};
const ACTION_AR: Record<string, string> = {
  'student.create': 'أُضيف الطالب', 'student.update': 'عُدّلت بيانات الطالب', 'student.archive': 'أُرشف الطالب', 'student.unarchive': 'أُعيد الطالب من الأرشيف',
  'staff.create': 'أُضيف إلى القائمة', 'staff.update': 'عُدّلت البيانات', 'staff.archive': 'أُرشف', 'staff.unarchive': 'أُعيد من الأرشيف',
  'photo.set': 'أُضيفت صورة', 'photo.remove': 'حُذفت الصورة',
};
const FIELD_AR: Record<string, string> = { givenName: 'الاسم', familyName: 'اللقب', birthDate: 'تاريخ الميلاد', phone: 'الهاتف', branchId: 'الفرع', status: 'الحالة', joinedOn: 'تاريخ الانضمام', studentNo: 'رقم الطالب', position: 'الوظيفة', kind: 'النوع' };
export const actionLabel = (a: string): string => ACTION_AR[a] ?? a;
export const fieldLabel = (f: string): string => FIELD_AR[f] ?? f;

// ---- settings and backups ----
export interface SettingsData { association: { id: string; name: string; address: string | null; contact: string | null; version: number }; branches: { id: string; name: string; active: boolean; students: number; teachers: number; version: number }[]; username: string }
export type SettingsResult = { ok: true } | { ok: false; error: string; retryAfterSeconds?: number };
export interface BackupList { folder: string | null; secondFolder: string | null; suggestions: { id: string; label: string; path: string; kind: 'drive' | 'desktop' | 'documents' }[]; auto: { lastAt: string | null; ok: boolean | null; secondOk: boolean | null }; lastBackupAt: string | null; history: { id: string; kind: string; file: string; at: string | null; sizeBytes: number | null; verified: boolean; failed: boolean }[]; files: { name: string; sizeBytes: number; modifiedAt: string }[]; otherFiles?: number }
export const BACKUP_KIND_AR: Record<string, string> = { manual: 'يدوي', scheduled: 'تلقائي يومي', pre_migration: 'قبل تحديث البرنامج', pre_import: 'قبل استيراد', pre_restore: 'قبل استعادة', restore: 'استعادة' };
export const SETTINGS_ERROR_TEXT: Record<string, string> = {
  forbidden: 'لا تملكون صلاحية هذا الإجراء.', invalid: 'القيمة غير صحيحة. تأكدوا من الاسم وطوله.', conflict: 'عُدِّل هذا من مكان آخر قبل حفظكم. أعيدوا فتح الصفحة ثم أعيدوا المحاولة.',
  duplicate_name: 'هذا الاسم مستخدم لفرع آخر. اختاروا اسماً مختلفاً.', too_many: 'بلغتم أقصى عدد من الفروع.', not_found: 'لم يعد هذا العنصر متاحاً.',
  weak: 'كلمة المرور الجديدة ضعيفة: استخدموا 10 أحرف على الأقل، دون اسم المستخدم فيها.',
};
export const fileSize = (n: number): string => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const stamp = (iso: string): string => { const d = new Date(iso); const p = (x: number) => String(x).padStart(2, '0'); return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

/** Short label for the branch switch: the word for branch is dropped, e.g. men's branch becomes just men. */
export const shortBranch = (name: string): string => name.replace(/^فرع\s+/, '');
