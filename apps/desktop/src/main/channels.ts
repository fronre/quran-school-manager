/** The only IPC channels that exist. Shared by the preload (client side) and the main process (server side). */
export const CHANNELS = [
  'app.info', 'auth.login', 'auth.logout', 'auth.resetPassword', 'session.current',
  'setup.begin', 'setup.checkPassword', 'setup.pickBackupFolder', 'setup.commit', 'setup.restorePick', 'setup.restoreCommit',
  'home.summary', 'home.today', 'backup.now',
  'import.pickFile', 'import.preview', 'import.commit', 'import.saveErrors', 'import.updatePreview', 'import.updateCommit', 'export.students',
  'finance.status', 'finance.setPassword', 'finance.unlock', 'finance.lock', 'finance.changePassword', 'finance.resetPassword',
  'finance.settings', 'finance.setRate', 'finance.setFreeMonth', 'finance.record', 'finance.cancel', 'finance.receipt', 'finance.payments', 'finance.statement', 'finance.arrears', 'finance.summary', 'finance.exportArrears',
  'staff.list', 'staff.get', 'staff.form', 'staff.create', 'staff.update', 'staff.archive', 'staff.unarchive', 'photo.get', 'photo.pick', 'photo.remove', 'profile.activity',
  'settings.get', 'settings.updateAssociation', 'settings.renameBranch', 'settings.addBranch', 'account.changePassword', 'backup.list', 'backup.setFolder', 'backup.restore', 'backup.useSuggestion', 'backup.setSecondFolder', 'backup.clearSecondFolder',
  'groups.list', 'groups.get', 'groups.form', 'groups.create', 'groups.update', 'groups.setStatus', 'groups.assignTeacher', 'groups.removeTeacher', 'groups.assignable', 'groups.unassigned', 'groups.enroll', 'groups.leave', 'groups.ofStudent', 'groups.ofTeacher',
  'attendance.sheet', 'attendance.save', 'attendance.cancel', 'attendance.correct', 'attendance.history', 'attendance.ofStudent',
  'reports.enrollment', 'reports.attendance', 'reports.activity', 'reports.export',
  'memo.access', 'memo.progress', 'memo.record', 'memo.void', 'memo.group', 'memo.suggest',
  'guardians.list', 'guardians.add', 'guardians.update', 'guardians.remove', 'guardians.codeIssue', 'guardians.codeRevoke', 'guardians.whatsapp', 'guardians.pickFile', 'guardians.preview', 'guardians.commit',
  'year.overview', 'year.start', 'year.plan', 'year.carryOver',
  'memo.settingsGet', 'memo.settingsSet', 'settings.logoSet', 'accounts.list', 'accounts.create', 'accounts.setStatus', 'accounts.setRole', 'accounts.resetPassword', 'accounts.rename', 'account.setFirstPassword', 'audit.list',
  'phone.status', 'phone.enable', 'phone.disable', 'phone.newCode', 'phone.revoke',
  'students.list', 'students.get', 'students.form', 'students.create', 'students.update', 'students.archive', 'students.unarchive',
] as const;
export type Channel = (typeof CHANNELS)[number];
export const IPC_ENVELOPE = 'mishkat:invoke';
