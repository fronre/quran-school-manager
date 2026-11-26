// Groups (الأفواج): typed wrappers over the IPC channels. The main process validates everything again.
export interface GroupRow { id: string; branchId: string; branchName: string; yearName: string; name: string; level: string | null; capacity: number; status: 'active' | 'closed'; members: number; teachers: { id: string; name: string }[]; version: number }
export interface GroupMember { enrollmentId: string; studentId: string; studentNo: string; name: string; since: string }
export type GroupResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export const GROUP_ERROR_TEXT: Record<string, string> = {
  forbidden: 'لا تملكون صلاحية هذا الإجراء.', not_found: 'لم يعد هذا العنصر متاحاً. أعيدوا تحميل الصفحة.', invalid: 'راجعوا الاسم والسعة (رقم من 1 إلى 500).',
  no_active_year: 'لا يوجد عام دراسي نشط. فعّلوا عاماً دراسياً أولاً.', duplicate_name: 'يوجد فوج بهذا الاسم في الفرع نفسه. اختاروا اسماً آخر.',
  conflict: 'عُدِّل هذا الفوج من مكان آخر قبل حفظكم. أعيدوا فتحه ثم أعيدوا التعديل.', closed: 'الفوج مغلق. أعيدوا فتحه أولاً.',
  has_members: 'لا يمكن إغلاق فوج فيه طلاب. انقلوهم أو أخرجوهم أولاً.', student_not_found: 'الطالب غير متاح في فرع هذا الفوج.', student_not_active: 'يمكن تسجيل الطلاب «النشطين» فقط (غير مؤرشفين).',
  already_enrolled: 'الطالب مسجّل في فوج آخر. استعملوا «نقل» بدل «تسجيل».', not_enrolled: 'الطالب ليس في هذا الفوج.', same_group: 'الطالب في هذا الفوج أصلاً.',
  same_day: 'سُجّل هذا الطالب أو أُخرج اليوم، فلا يمكن تغيير فوجه اليوم نفسه. أعيدوا المحاولة غداً.', staff_not_found: 'هذا المعلم غير متاح لهذا الفوج (فرع آخر أو مؤرشف).',
  already_assigned: 'المعلم مرتبط بهذا الفوج من قبل.', not_assigned: 'المعلم ليس في هذا الفوج.', reason_required: 'اكتبوا السبب (حتى 300 حرف).',
};
declare global { interface Window { mishkat: { invoke(channel: string, payload?: unknown): Promise<unknown> } } }
const gcall = <T>(channel: string, payload?: unknown) => window.mishkat.invoke(channel, payload) as Promise<T>;
export const groupsApi = {
  list: (q: { branchId?: string; status?: 'active' | 'closed' | 'all' }) => gcall<{ rows: GroupRow[] }>('groups.list', q),
  get: (id: string) => gcall<{ found: { group: GroupRow; members: GroupMember[] } | null }>('groups.get', { id }),
  form: () => gcall<{ branches: { id: string; name: string }[]; canEnroll: boolean; canEdit: boolean }>('groups.form'),
  create: (i: { branchId: string; name: string; level: string | null; capacity: number }) => gcall<GroupResult<{ id: string }>>('groups.create', i),
  update: (id: string, expectedVersion: number, i: { name: string; level: string | null; capacity: number }) => gcall<GroupResult>('groups.update', { id, expectedVersion, ...i }),
  setStatus: (id: string, status: 'active' | 'closed') => gcall<GroupResult>('groups.setStatus', { id, status }),
  assignTeacher: (groupId: string, staffId: string) => gcall<GroupResult>('groups.assignTeacher', { groupId, staffId }),
  removeTeacher: (groupId: string, staffId: string) => gcall<GroupResult>('groups.removeTeacher', { groupId, staffId }),
  assignable: (groupId: string) => gcall<{ rows: { id: string; name: string }[] }>('groups.assignable', { groupId }),
  unassigned: (branchId: string, search?: string) => gcall<{ rows: { id: string; studentNo: string; name: string }[] }>('groups.unassigned', { branchId, search }),
  enroll: (groupId: string, studentId: string, mode?: 'enroll' | 'transfer') => gcall<GroupResult<{ enrollmentId: string }>>('groups.enroll', { groupId, studentId, mode }),
  leave: (groupId: string, studentId: string, reason: string) => gcall<GroupResult>('groups.leave', { groupId, studentId, reason }),
  ofStudent: (studentId: string) => gcall<{ info: { current: { groupId: string; name: string; since: string } | null; past: { name: string; from: string; to: string }[] } | null }>('groups.ofStudent', { studentId }),
  ofTeacher: (staffId: string) => gcall<{ rows: { id: string; name: string; branchName: string; members: number }[] }>('groups.ofTeacher', { staffId }),
};
