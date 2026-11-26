# PRD.md — Product Requirements

**Accountable role:** Product Manager · **Status:** Batch 1 draft · **Date:** 2026-11-20

**Definition of Done:** every release-1 module has requirements with IDs and MoSCoW priority; the MVP is defined; non-functional requirements carry numbers (marked proposed); each requirement states its status; open questions point to `OPEN_DECISIONS.md`.

**Status legend:** **C** Confirmed by you · **R** Recommended (pending approval unless noted) · **U** Unresolved (blocked by an OD) · **F** Future.
**Priority:** **M** Must · **S** Should · **C** Could · **W** Won't in release 1.

---

## 1. Release 1 scope summary

| Component | In release 1 |
|---|---|
| Windows Desktop (offline, single PC) | Yes, system of record |
| Web Portal for guardians (read-only, mobile-first, Arabic RTL) | Yes, fed by one-way publish |
| Android app | No (W) |
| Two-way sync / teacher write-back from phones | No (W, Future) |
| Hybrid multi-PC mode | No (W) |
| Finance module | Pending OD-009 (default: not in pilot) |
| French / multi-language | No (W), pending OD-004 |

## 2. Definition of the MVP

The MVP is "pilot-ready" when the pilot association (200+ students, two branches, one PC) can, **without paper as the system of record**:

1. Set itself up (branches, academic year, groups, staff) in one working day.
2. Import its existing student list.
3. Register/maintain students and guardians, assign them to groups, transfer them with history preserved.
4. Record attendance for every session/day and correct it with an audit trail.
5. Record memorization/revision progress per student.
6. Produce attendance and progress reports (print + PDF/Excel).
7. Back up and restore its data, tested.
8. Let guardians see their own children's attendance, progress, and announcements on their phones.

Anything not on this list is not MVP.

## 3. Requirements

### 3.1 Association and setup

| ID | Requirement | Pri | Status |
|---|---|---|---|
| REQ-001 | First-run setup wizard: association profile → branches → academic year → groups → staff/roles | M | R |
| REQ-002 | Association identity (name, logo, address, contact) used on prints and the portal | M | R |
| REQ-003 | Two branches (men's / women's) as first-class entities; the model supports 1..N branches | M | C |
| REQ-004 | Academic year configuration; one active year at a time | M | R |
| REQ-005 | Configurable attendance policy per association (see BR in Batch 2 and OD-017) | M | R |
| REQ-006 | Configurable evaluation scale (OD-021) | S | U |
| REQ-007 | Holidays and calendar, Hijri + Gregorian display (OD-020) | S | U |

### 3.2 Students and guardians

| ID | Requirement | Pri | Status |
|---|---|---|---|
| REQ-010 | Register and edit students (personal info, status, branch, notes); minimal data by default (OD-013) | M | R |
| REQ-011 | Guardians as separate person records linked many-to-many to students; emergency contact flag | M | R |
| REQ-012 | One active group per student per academic year; transfers keep full history | M | C |
| REQ-013 | Search and filter (name, group, branch, status) fast on 200–2000 students | M | R |
| REQ-014 | Student archiving (not deletion) with reason | M | R |
| REQ-015 | Document attachments for students (scan/photo) with permissions | S | R |
| REQ-016 | Excel/CSV **import** with dry-run, validation report, and error file | M | R |
| REQ-017 | Student profile summary page (attendance, progress, history) | M | R |

### 3.3 Teachers, staff, groups

| ID | Requirement | Pri | Status |
|---|---|---|---|
| REQ-020 | Teacher profiles (contact, qualifications, notes) | M | R |
| REQ-021 | Teacher may be assigned to multiple groups; group has capacity and branch | M | C |
| REQ-022 | Staff accounts and roles per `USER_ROLES_AND_PERMISSIONS.md` | M | R |
| REQ-023 | Group history (who taught, who was enrolled, when) | S | R |
| REQ-024 | Teacher activity report (sessions held, attendance recorded) | C | R |

### 3.4 Scheduling

| ID | Requirement | Pri | Status |
|---|---|---|---|
| REQ-030 | Weekly recurring schedule per group; room optional | S | R |
| REQ-031 | Conflict detection: teacher double-booking, room overlap | S | R |
| REQ-032 | Schedule changes and cancellations visible on the portal | C | R |

### 3.5 Attendance

| ID | Requirement | Pri | Status |
|---|---|---|---|
| REQ-040 | Record attendance: present / absent / late / excused | M | R |
| REQ-041 | Mode (daily vs per session) configurable (OD-017); default recommended: **per group session** | M | U |
| REQ-042 | Validate against enrollment and session; reject invalid records | M | C |
| REQ-043 | Correction with mandatory reason and audit history | M | R |
| REQ-044 | Fast group attendance screen: all present by default, tap exceptions; keyboard-friendly | M | R |
| REQ-045 | Attendance reports (by student/group/branch/period) | M | R |
| REQ-046 | Consecutive-absence alert list for staff | S | R |

### 3.6 Memorization and progress (simple, release 1)

| ID | Requirement | Pri | Status |
|---|---|---|---|
| REQ-050 | Record activity: new memorization / revision / consolidation, with surah and ayah range | M | R |
| REQ-051 | Evaluation per record using the configured scale and optional comment | M | R |
| REQ-052 | Student progress = **union of ranges** (no double counting of overlaps) | M | C |
| REQ-053 | Exact Surah/Ayah references from a validated dataset; the dataset's source and license recorded (riwaya detail is not a pilot priority) | M | C |
| REQ-054 | Group and student progress reports | M | R |
| REQ-055 | Hizb/thumn/page tracking, tajweed levels, ijazah | W | F |

### 3.7 Guardian web portal

| ID | Requirement | Pri | Status |
|---|---|---|---|
| REQ-060 | Guardian login; sees only own children | M | C |
| REQ-061 | View attendance and recent progress for each child | M | C |
| REQ-062 | View announcements and schedule changes | S | R |
| REQ-063 | Mobile-first Arabic RTL UI, installable as a PWA (decision in Batch 3) | M | R |
| REQ-064 | Data arrives by **one-way publish** from desktop; portal shows "last updated" time | M | R |
| REQ-065 | Guardian can contact the association (message form) | C | U |
| REQ-066 | Guardian credentials delivery and identity verification | M | U (OD-015) |

### 3.8 Reports and printing

| ID | Requirement | Pri | Status |
|---|---|---|---|
| REQ-070 | Standard reports: enrollment, attendance, progress, teacher activity | M | R |
| REQ-071 | Export PDF and Excel; Arabic printing quality verified on a real printer | M | R |
| REQ-072 | Printable paper attendance sheet (fallback when PC unavailable) | S | R |
| REQ-073 | Student card / certificate printing | C | U (OD-010) |

### 3.9 Governance, backup, licensing

| ID | Requirement | Pri | Status |
|---|---|---|---|
| REQ-080 | Audit log for sensitive operations (list in roles doc), not editable by users | M | C |
| REQ-081 | Automatic local backups + manual backup + restore; restore test built into the product | M | R |
| REQ-082 | Backup destination options (USB / network folder / cloud) and key policy (OD-019) | M | U |
| REQ-083 | Offline license file validation; pilot license free (OD-001, OD-018) | M | R |
| REQ-084 | License expiry or lapse of maintenance **never locks access to the association's data** | M | C |
| REQ-085 | Signed updates with automatic DB backup before migration | S | R |
| REQ-086 | Diagnostics export that excludes student data | S | R |

### 3.9b Deliberately excluded / future

| ID | Item | Status |
|---|---|---|
| REQ-090 | Finance module | U (OD-009) / F |
| REQ-091 | Two-way sync; teacher entry from phones | F (OD-002) |
| REQ-092 | Native Android app | F |
| REQ-093 | SMS / messaging gateway | F (OD-016) |
| REQ-094 | French UI | F (OD-004) |
| REQ-095 | Multi-association cloud hosting at scale | F |

## 4. Non-functional requirements (proposed numbers — confirm with the pilot)

| ID | Requirement | Proposed target |
|---|---|---|
| NFR-001 | Pilot scale | 200–2,000 students, 5–100 staff, 2 branches |
| NFR-002 | Attendance entry, 30-student group | < 60 s |
| NFR-003 | Search/filter response | < 1 s on a typical office PC |
| NFR-004 | Offline operation | All desktop daily operations work without internet |
| NFR-005 | Minimum PC | Windows 10/11, 4 GB RAM, 1366×768 (verify packaged-app footprint) |
| NFR-006 | Portal availability | Best-effort in pilot; target decided with hosting (OD-005) |
| NFR-007 | Backup | Automatic at least daily; restore verified; RPO ≤ 24 h in pilot |
| NFR-008 | Accessibility | WCAG AA contrast, keyboard navigation, scalable text |
| NFR-009 | Portal first load on mobile 3G/4G | < 3 s for the main view (proposed) |
| NFR-010 | Data privacy | Children's data minimized; legal review before public portal (OD-012) |

## 5. Dependencies and sequencing notes

- Desktop foundation → students/groups → attendance/progress → reports → portal publish. The portal's read model depends on the desktop schema being **sync-ready** (UUIDs, tenant id, version fields, soft deletes) from the first migration (see Batch 3).
- Pilot review points: after Batch 2 (workflows) and after the first working students/groups build.

## 6. Out of scope statement

Anything not listed in Section 3 as M/S/C is not planned for release 1.

---

**Cross-role review (QA Automation Engineer):** Each M requirement must be traceable to at least one acceptance test before implementation begins. REQ-012, REQ-042, REQ-052, REQ-060, and REQ-084 are *invariants* and need domain-level tests independent of UI.
