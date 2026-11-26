# BUSINESS_RULES.md

**Accountable role:** Business Analyst + Software Architect · **Status:** Batch 2 draft · **Date:** 2026-11-20

**Definition of Done:** every rule has an ID, a precise statement, the layer that enforces it, and a test idea; rules from the original brief keep their original numbers (BR-001 … BR-013); new rules are marked and justified; every parameter that is not decided is a named configuration value tied to an open decision; no rule is invented silently.

**Status legend:** **C** Confirmed (original brief or your decisions) · **R** Recommended (derived, pending your review) · **U** Unresolved (open decision) · **F** Future.

**Enforcement layers:** **D** domain model (pure code, unit-tested, independent of UI) · **DB** database constraint/trigger · **A** application service (authorization, audit) · **UI** only a convenience. A rule that matters must be enforced in **D** and, where possible, also **DB**; UI-only enforcement does not count.

---

## 1. Rules from the original brief (numbering preserved)

| ID | Rule | Layer | Test idea | Status |
|---|---|---|---|---|
| BR-001 | A student has **at most one active enrollment per academic year**. | D + DB (partial unique index on student + year where active) | Try to enroll an enrolled student in a second group → rejected; two concurrent writes → one wins | C |
| BR-002 | **Transfers preserve history.** A transfer ends the old enrollment (with end date and reason) and creates a new one; nothing is overwritten or deleted. | D | After transfer, both enrollments exist; attendance before the transfer still points to the old enrollment | C |
| BR-003 | A **teacher may be assigned to several groups**. | D | Assign one teacher to 3 groups → allowed | C |
| BR-004 | **Attendance policies are configurable** per association (mode, statuses meaning, late threshold, correction window). | D (policy object) | Same input, different policy → different validation result | C |
| BR-005 | The **finance module is optional**; when disabled, no finance data or UI exists and no other rule depends on it. | D + A | Disabled → finance endpoints/screens unavailable; reports unchanged | C |
| BR-006 | A **guardian may be linked to several students**. | D | One guardian, three children | C |
| BR-007 | A **student may have several guardians**. | D | One student, two guardians (e.g. mother and father) | C |
| BR-008 | **Issued records keep historical integrity**: a published report, certificate, or receipt is a snapshot; later edits to source data never change an already-issued document. Corrections produce a new version that references the old one. | D + A | Edit student name after issuing a card → old issued record unchanged | C |
| BR-009 | **Financial operations respect currency boundaries**: no operation mixes currencies without an explicit recorded exchange. (Applies only if finance is enabled.) | D | Sum of DZD and EUR rows rejected | C (F in release 1) |
| BR-010 | **Association data never leaks across tenants.** | DB (tenant id on every tenant-owned row, row-level security on the server) + A | Tenant A user requests tenant B id → not found (not "forbidden") | C |
| BR-011 | **Attendance must reference a valid enrollment and a valid session** of the same group and date. | D + DB (foreign keys) | Attendance for a student not enrolled in that session's group → rejected | C |
| BR-012 | **Quran tracking preserves exact Surah and Ayah references** from the validated dataset. | D | Ayah 287 of Al-Baqarah accepted only if the dataset says it exists | C |
| BR-013 | **Every sensitive operation is authorized and audited.** The list is in `USER_ROLES_AND_PERMISSIONS.md` §5. | A + DB (append-only audit table) | For each listed operation: unauthorized → rejected + logged; authorized → one audit row | C |

## 2. Organization, branches, academic year

| ID | Rule | Layer | Test idea | Status |
|---|---|---|---|---|
| BR-014 | Every group, enrollment, and staff assignment belongs to a **branch**. By default, users scoped to a branch can read and write **only that branch**; the Director sees all branches. (OD-003 approved: strict.) | A + D | Supervisor of branch A requests a student of branch B → not found | C (default approved) |
| BR-015 | A **student's gender is not required to match the branch** (OD-022); the association may enable a warning. | D (policy) | Boy in women's branch → allowed; with warning enabled → warning shown | R (OD-022) |
| BR-016 | Exactly **one academic year is active** at a time; sessions and enrollments belong to a year. | D + DB | Activate a second year → previous one must be closed first | R |
| BR-017 | **Closing an academic year** is an explicit audited operation: no new sessions/attendance for that year; its data becomes read-only except audited corrections by the Director. Nothing is carried over automatically (OD-025). | D + A | After closing, record attendance → rejected | R (OD-025) |
| BR-018 | A **group** belongs to one branch and one academic year, has a **capacity**; enrollment beyond capacity is blocked unless the Director overrides with a reason. | D | 31st student in a 30-capacity group → rejected; override → allowed and audited | R |

## 3. Students and guardians

| ID | Rule | Layer | Test idea | Status |
|---|---|---|---|---|
| BR-019 | Students are **never hard-deleted** through the application; they are **archived** with a reason. Archived students keep all history and are hidden from active lists. | D + A | Delete action does not exist; archive keeps attendance | R |
| BR-020 | **Guardian record ≠ guardian login account.** A guardian record can exist without an account. Revoking an account never deletes the person or the links. | D | Revoke account → person and student links intact | C |
| BR-021 | Student status values and transitions follow OD-023 (Applicant, Active, Suspended, Graduated/Completed, Withdrawn; archived is separate). Only Active students appear in new attendance lists. | D | Suspended student not in the attendance list; history intact | R (OD-023) |
| BR-022 | **Minimum data principle**: only the fields confirmed in OD-013 are collected; national ID number and photos are not collected unless the Director enables them and a consent record exists. | D + A | Disabled field cannot be saved | R (OD-013) |
| BR-023 | A **duplicate-person check** warns on likely duplicates (same normalized name + birth date or guardian phone). It warns; the user decides. | D | Register same child twice → warning, not block | R |

## 4. Teachers, scheduling

| ID | Rule | Layer | Test idea | Status |
|---|---|---|---|---|
| BR-024 | A **teacher cannot be scheduled in two overlapping sessions**; a **room cannot host two overlapping sessions**. The conflict is detected on save and reported with the conflicting item. A Director may override with a reason. | D | Overlap by one minute → conflict; adjacent sessions → allowed | R |
| BR-025 | A **session** belongs to one group and one date/time slot, generated from the group's weekly pattern or created as a one-off; **cancelled sessions** stay in history with a reason and take no attendance. | D | Attendance on cancelled session → rejected | R |
| BR-026 | **Holidays** (Hijri/Gregorian, OD-020) suppress generated sessions; the Director may still create an exceptional session. | D | Generate sessions across a holiday → skipped | R |

## 5. Attendance

| ID | Rule | Layer | Test idea | Status |
|---|---|---|---|---|
| BR-027 | Attendance statuses are **present / absent / late / excused**. A student has **at most one attendance record per session** (re-saving updates it through the correction path, not by duplication). | D + DB (unique student + session) | Two records same session → impossible | C |
| BR-028 | Attendance can be recorded only for **Active students enrolled on that date** in the session's group (BR-011). After a transfer, only the enrollment in force on the session date applies. | D | Student transferred on day 10: session on day 9 → old group, day 11 → new group | C |
| BR-029 | **Correction** requires a **reason**, writes an audit entry (old value, new value, who, when) and never erases the original. Corrections beyond the **correction window** (default 7 days for supervisors, parameter per OD-026) require the Director. | D + A | Correct after 8 days as supervisor → rejected; as Director → allowed and audited | R (OD-026) |
| BR-030 | Attendance entry **defaults**: the attendance screen may pre-fill "present" for convenience, but a session counts as **"recorded"** only when staff explicitly confirm it. Unconfirmed sessions are listed as pending. | D + UI | Pre-filled list not confirmed → session stays pending; report shows "not recorded" separately from "absent" | R |
| BR-031 | **Late** has a configurable threshold (minutes); an **excused** absence requires a note unless the policy says otherwise. | D (policy) | Policy requires note → save without note rejected | R (OD-017) |

## 6. Quran memorization and progress (release-1 simple model)

| ID | Rule | Layer | Test idea | Status |
|---|---|---|---|---|
| BR-032 | A progress record has a **type**: *new memorization*, *revision*, or *consolidation*. The three are different activities and are reported separately. | D | Same range in two types → two distinct records and statistics | C |
| BR-033 | A record references a **contiguous range** (start surah:ayah → end surah:ayah) valid in the dataset; start must not be after end; ranges may span surahs. | D | Reversed range → rejected; invalid ayah → rejected | C |
| BR-034 | The **memorized set** of a student is the **union** of ranges (as ordinal sets in the dataset), never a sum of lengths. Overlaps are counted once. | D | 1:1–1:7 plus 1:5–1:7 → 7 ayat, not 10 | C |
| BR-035 | Only records of type *new memorization* whose evaluation is at or above the configurable **pass mark** enter the memorized set; revision and consolidation never change it (OD-024). | D | Failing new-memorization → not counted; revision → not counted | R (OD-024) |
| BR-036 | An **evaluation** value must belong to the association's configured scale (OD-021); the scale can be changed for the future without altering the stored meaning of past evaluations (store the scale version with each record). | D | Change scale → old records keep their original labels | R |
| BR-037 | Progress records are tied to **a student, a date, an enrollment, and (when it exists) a session**; corrections follow BR-029-style audit. | D + A | Record without enrollment → rejected | R |
| BR-038 | The **Quran dataset** is read-only reference data: versioned, with its **source and license recorded** and an integrity check; the app never edits it. Changing dataset version is an audited, tested migration. | D + build | Checksum mismatch → app refuses to start | C (REQ-053) |

## 7. Portal and synchronization

| ID | Rule | Layer | Test idea | Status |
|---|---|---|---|---|
| BR-039 | **One-way publication**: desktop is the only authority; the portal cannot change association data (release 1). Therefore **no conflict resolution** exists in release 1. | A | Portal API has no write endpoints for domain data | C (R-2 approved) |
| BR-040 | A guardian sees **only own linked children**, never siblings of other guardians, never another branch's data. | A + DB | Guardian A requests child of guardian B → not found | C |
| BR-041 | Published data is a **snapshot with a "last updated" time** shown to guardians. Unpublishing removes data from the portal without touching desktop data. | A | Unpublish → portal empty, desktop intact | R |
| BR-042 | The portal receives the **minimum data** (OD-005): no documents, no national ids, no free-text staff comments unless marked "shareable". | A | Staff comment not marked shareable never published | R |

## 8. Data lifecycle, backup, imports

| ID | Rule | Layer | Test idea | Status |
|---|---|---|---|---|
| BR-043 | **Backup before risk**: the app makes an automatic verified backup before any schema migration, import, or restore. If it fails, the operation does not start. | A | Simulate backup failure → migration aborted | R |
| BR-044 | **Restore** replaces data only after confirmation, shows the backup's date and size, and keeps the pre-restore state as a new backup. Restoring never mixes two states. | A | Restore then undo-restore works | R |
| BR-045 | **Import** is a two-step operation: dry-run with a validation report, then commit. The commit is **atomic** (all or nothing) and audited; bad rows are exported to an error file. | A | One invalid row among 200 → report lists it; commit blocked until resolved or explicitly excluded | R |
| BR-046 | All records use **UUID identifiers**, carry **tenant id**, **version**, **updated at/by**, and use **soft delete (tombstones)**; there are no auto-increment ids. (Sync-readiness requirement.) | DB | Schema test scans every table for the columns | C (brief) |
| BR-047 | **Audit entries are append-only**; ordinary roles cannot edit or delete them; export/viewing of the audit log is itself audited. | DB + A | Attempt update/delete on audit table as app user → denied | C |

## 9. Licensing

| ID | Rule | Layer | Test idea | Status |
|---|---|---|---|---|
| BR-048 | **Lapse of license, maintenance, or support never blocks access to the association's data.** At worst new-version updates and optional cloud services stop; viewing, backup, and export always remain available. | D + A | Expired license → can still open, back up, export | C |
| BR-049 | A license is validated **offline** (signed file); validation failure degrades only entitlement-based features (as defined in Batch 4), never data access. | A | Corrupt license file → app opens in "unlicensed" mode with data access | R |

## 10. Finance (future; not release 1)

| ID | Rule | Status |
|---|---|---|
| BR-050 | Financial transactions are **immutable**; corrections are explicit **reversal or correction records** referencing the original, never silent edits. | C (brief), F |
| BR-051 | Receipts are issued snapshots (BR-008). | C, F |

## 11. Configurable parameters (nothing hard-coded)

| Parameter | Default | Linked decision |
|---|---|---|
| Attendance mode | per session | OD-017 |
| Late threshold (minutes) | association sets it | OD-017 |
| Excused absence needs a note | yes | OD-017 |
| Correction window (days, non-Director) | 7 | OD-026 |
| Pass mark for new memorization | association sets it | OD-024 |
| Evaluation scale | label scale pre-installed | OD-021 |
| Gender/branch warning | off | OD-022 |
| Group capacity override allowed | Director only | BR-018 |
| Weekend days | Friday, Saturday | OD-020 |
| Calendar display | Hijri + Gregorian | OD-020 |

## 12. Worked edge cases (to be turned into tests)

1. **Transfer mid-week.** Student moves from group A to group B on Wednesday. Sessions Monday/Tuesday stay with A; Wednesday onward with B (BR-002, BR-028).
2. **Overlapping memorization.** Ranges 2:1–2:20 (new) and 2:10–2:30 (new, passing) → memorized set is 2:1–2:30, 30 ayat (BR-034).
3. **Revision does not inflate progress.** A student revises Al-Fatiha 20 times → memorized set unchanged (BR-035).
4. **Correction after closing the year.** Only the Director, with a reason, audited (BR-017, BR-029).
5. **Guardian with two children in two branches.** Sees both children (BR-040) even though staff scoped to one branch see only their own.
6. **Backup fails during update.** Update aborted; old version continues (BR-043).
7. **Expired license.** App opens, exports, backs up (BR-048).
8. **Duplicate registration.** Warning, not block (BR-023).

## 13. Unresolved items for this document

OD-017 (attendance policy details), OD-021 (scale), OD-022 (gender/branch), OD-023 (status values), OD-024 (memorized definition), OD-025 (year carry-over), OD-026 (correction window), OD-013 (data fields).

---

**Cross-role review (QA Automation Engineer):** Rules marked **D** must be implemented as pure domain code with property-style tests (overlaps, unions, transfers). Rules marked **DB** need a database-level test too. A rule with only a UI check is considered **not implemented**.
