# USER_ROLES_AND_PERMISSIONS.md

**Accountable role:** Security Engineer + Business Analyst · **Status:** Batch 1 draft

**Definition of Done:** every role has a purpose, channel, and scope; a permission matrix covers all release-1 modules; branch scoping is explicit; unresolved items are linked to open decisions; sensitive operations are listed.

---

## 1. Principles

1. **Least privilege**, deny by default.
2. **Scope = role × branch.** Permissions apply within an association and (by default) within a branch.
3. Every sensitive action is **authorized and audited** (BR-013 in the original brief).
4. **Accounts ≠ people**: a guardian *record* (domain person) is separate from a guardian *login account*.
5. Roles are **configurable per association** within system-defined limits; the vendor cannot silently read association data.

## 2. Roles

| Role | Channel | Purpose | Status |
|---|---|---|---|
| **Director** (المدير) | Desktop | Full control of the association, both branches, settings, roles, backups | Confirmed (role exists); scope Recommended |
| **Branch Supervisor** (مشرف الفرع) | Desktop | Manages one branch: groups, students, teachers, attendance, reports for that branch | Recommended (OD-003) |
| **Registrar / Reception** (التسجيل) | Desktop | Registers students and guardians, enrollment, documents, printing | Recommended |
| **Academic Supervisor** (المشرف التربوي) | Desktop | Evaluations, progress reports, teacher follow-up | Recommended |
| **Teacher** (معلم / معلمة) | Release 1: **none on own device** (admin records for them) · Later: web | Records attendance and progress for assigned groups | Unresolved (OD-002) |
| **Finance Admin** | Desktop | Financial module | Future / optional (OD-009) |
| **Guardian** (ولي الأمر) | Web portal | Read-only view of their own children | Confirmed purpose; read-only is Recommended |
| **Support Technician (vendor)** | Diagnostics only | Helps with installs/updates; **no access to association data** | Recommended |

No separate student login in release 1 (Future).

## 3. Branch scoping rules

- Every group, staff assignment, and enrollment belongs to a **branch** (men's / women's).
- **Default (Recommended, awaiting your decision OD-003):** a Branch Supervisor, Registrar, or Academic Supervisor assigned to a branch sees only that branch's students, teachers, and groups. Director sees both.
- Cross-branch transfer of a student requires Director approval and is audited.
- A guardian sees only their own children, regardless of branch.

## 4. Permission matrix — release 1

Legend: **F** full · **B** own branch only · **R** read-only · **A** assigned groups only · **—** none · **?** depends on open decision.

| Capability | Director | Branch Supv. | Registrar | Academic Supv. | Teacher (later) | Guardian |
|---|---|---|---|---|---|---|
| Association settings, branches, academic year | F | — | — | — | — | — |
| Create / edit roles & staff accounts | F | — | — | — | — | — |
| Students: create/edit | F | B | B | R(B) | — | — |
| Students: view | F | B | B | B | A | own children |
| Student documents | F | B | B | — | — | own (R) ? |
| Guardians: create/edit | F | B | B | — | — | own profile (R) |
| Groups & timetable: create/edit | F | B | — | R(B) | R(A) | R (children's groups) |
| Enrollment & transfers | F | B (within branch) | B | — | — | — |
| Cross-branch transfer | F | — | — | — | — | — |
| Attendance: record | F | B | B (on behalf) | — | A (later) | — |
| Attendance: correct (with reason) | F | B | — | — | — | — |
| Attendance: view | F | B | B | B | A | own children |
| Memorization & evaluations: record | F | B | — | B | A (later) | — |
| Memorization & evaluations: view | F | B | — | B | A | own children |
| Announcements: publish | F | B | — | B ? | — | R |
| Reports: view/export | F | B | B (limited) | B | A (limited) | own children (limited) |
| Import data (Excel/CSV) | F | — | ? | — | — | — |
| Backup / restore | F | — | — | — | — | — |
| Audit log: view | F | — | — | — | — | — |
| License management | F | — | — | — | — | — |
| Publish data to web portal | F | — | — | — | — | — |

## 5. Sensitive operations (always audited, may require reason)

1. Attendance or evaluation correction after the day closes.
2. Student transfer between groups or branches; archiving/deleting a student.
3. Role or permission change; staff account creation/disable.
4. Data export (PDF/Excel/backup) and import.
5. Backup restore.
6. Publishing/unpublishing data to the web portal; guardian account creation/revocation.
7. License operations.
8. Login failures and lockouts (security events).

Audit entries record: who, when, branch, entity, before/after, reason. Ordinary roles cannot edit or delete audit entries.

## 6. Authentication (summary; details in `SECURITY_PLAN.md`, Batch 4)

- Desktop: local accounts, strong password hashing, lockout/backoff, **admin recovery path** designed so it is not a bypass (OD-014).
- Web portal: guardian accounts created by the association; credentials delivery channel is OD-015.
- MFA: Recommended for Director and for any role that can export data (decision in Batch 4).

## 7. Unresolved items for this document

| ID | Question |
|---|---|
| OD-002 | Do teachers get their own login/devices in release 1? |
| OD-003 | Is branch separation strict (supervisor sees only own branch) or shared? |
| OD-009 | Is the finance module in the pilot? |
| OD-014 | Admin-password recovery mechanism |
| OD-015 | How guardians receive credentials; identity verification |

---

**Cross-role review (QA Automation Engineer):** Every row of the matrix needs an authorization test, and every branch-scoped row needs a negative test (supervisor of branch A cannot read branch B). These are mandatory acceptance tests, not nice-to-haves.
