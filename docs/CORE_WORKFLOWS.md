# CORE_WORKFLOWS.md

**Accountable role:** UX Designer + Business Analyst · **Status:** Batch 2 draft · **Date:** 2026-11-20

**Definition of Done:** every release-1 workflow states actor, trigger, preconditions, main steps, alternative/error paths, postconditions, applicable rules, audit points, and linked requirements; workflows are written to be **validated with the pilot association** (OD-006) before they become screens; nothing here is a screen design.

**How to read:** steps are numbered; **Alt** = alternative path; **Err** = error path. Workflows were drafted from the PRD and business rules, **not yet validated with real staff**. Items needing validation are marked **[VALIDATE]**.

**Actors:** Director (D) · Branch Supervisor (BS) · Registrar (RG) · Academic Supervisor (AS) · Guardian (G) · System (S). Teacher actions in release 1 are performed by staff on the single PC (OD-002).

---

## Workflow index

| ID | Workflow | Priority | Main REQs |
|---|---|---|---|
| WF-01 | First-run setup | M | REQ-001–004 |
| WF-02 | Import existing students | M | REQ-016 |
| WF-03 | Register a student and guardians | M | REQ-010, 011 |
| WF-04 | Enroll a student in a group | M | REQ-012, 021 |
| WF-05 | Transfer a student (group or branch) | M | REQ-012 |
| WF-06 | Record session attendance | M | REQ-040–044 |
| WF-07 | Correct attendance | M | REQ-043 |
| WF-08 | Record memorization/revision | M | REQ-050–053 |
| WF-09 | Review student and group progress | M | REQ-017, 054 |
| WF-10 | Build and change the schedule | S | REQ-030–032 |
| WF-11 | Publish data to the portal | M | REQ-064 |
| WF-12 | Guardian onboarding and portal use | M | REQ-060–066 |
| WF-13 | Publish an announcement | S | REQ-062 |
| WF-14 | Backup and restore | M | REQ-081, 082 |
| WF-15 | Close the academic year, start the next | M | REQ-004 |
| WF-16 | Archive or withdraw a student | M | REQ-014 |
| WF-17 | Produce and print reports | M | REQ-070–072 |
| WF-18 | Activate the license | M | REQ-083, 084 |
| WF-19 | Update the application | S | REQ-085 |
| WF-20 | Admin recovery (blocked by OD-014) | M | REQ-022 |

---

## WF-01 First-run setup

- **Actor:** Director. **Trigger:** first launch after installation.
- **Preconditions:** application installed; license file optional (pilot).
- **Steps:**
  1. Language/locale confirmed (Arabic), calendars and weekend defaults shown (OD-020).
  2. Create the Director account; **print/save the recovery key** (OD-014); create a **second admin** or acknowledge skipping with a warning.
  3. Association profile: name, logo (placeholder until branding is approved), address, contact.
  4. Create branches (men's, women's) and optional departments.
  5. Create the academic year (start/end dates, holidays).
  6. Set policies with defaults: attendance mode, late threshold, correction window, evaluation scale, pass mark (BR-004, BR-031, BR-036).
  7. Create staff accounts and assign roles and branches.
  8. Create groups (branch, level, capacity, weekly schedule) or defer.
  9. Offer **import** of existing students (→ WF-02).
  10. Choose backup destination and schedule (→ WF-14); run first backup.
- **Alt:** user may skip steps and finish later; incomplete setup shows a checklist on the home screen.
- **Err:** invalid dates, overlapping years → inline errors; closing the wizard midway keeps progress.
- **Postconditions:** association usable; first backup exists.
- **Rules:** BR-004, BR-016, BR-046. **Audit:** account creation, role assignment, policy values.
- **[VALIDATE]** Is one working day realistic? Which steps do they dread?

## WF-02 Import existing students

- **Actor:** Director (RG optional, OD in roles matrix). **Trigger:** setup or later.
- **Steps:**
  1. Choose file (Excel/CSV); download the **template** if needed.
  2. Map columns to fields (saved mapping for reuse).
  3. **Dry run**: system validates rows, detects probable duplicates (BR-023), lists errors and warnings.
  4. User fixes the file or excludes rows; repeat dry run.
  5. **Commit** (atomic, BR-045): automatic backup first (BR-043), then insert.
  6. Summary: created / skipped / errors; error file exported.
- **Alt:** import guardians in the same file (one row per student with up to two guardians) **[VALIDATE]**.
- **Err:** unreadable file, wrong encoding, mixed Arabic/Latin digits (normalize), dates in unknown format → clear message with row numbers.
- **Postconditions:** students (and guardians) created, unassigned to groups unless a group column was mapped.
- **Rules:** BR-022, BR-023, BR-043, BR-045. **Audit:** import with file name, counts, user.

## WF-03 Register a student and guardians

- **Actor:** RG, BS, D. **Trigger:** a new child joins.
- **Steps:**
  1. Choose branch; enter student data (only OD-013 fields).
  2. Duplicate check (BR-023): warning with possible matches.
  3. Link guardian(s): search existing guardian first (BR-006/007), else create; mark emergency contact.
  4. Optional documents/photo (only if enabled + consent recorded, BR-022).
  5. Save as **Active** or **Applicant** (OD-023).
  6. Offer "enroll in group now" (→ WF-04) and "print registration card".
- **Alt:** sibling registration copies guardian links.
- **Err:** missing required fields; guardian phone invalid format → inline.
- **Rules:** BR-006, BR-007, BR-014, BR-020, BR-022, BR-023. **Audit:** creation.

## WF-04 Enroll a student in a group

- **Actor:** RG, BS, D. **Preconditions:** student active; group exists for the active year.
- **Steps:** select student → select group in the same branch → system checks BR-001 (no active enrollment this year), BR-018 (capacity) → set start date → confirm.
- **Alt:** over capacity → Director override with reason (audited).
- **Err:** student already enrolled → show current group and offer WF-05.
- **Postconditions:** active enrollment; student appears in the group's attendance lists from the start date.
- **Rules:** BR-001, BR-014, BR-018. **Audit:** enrollment, override.

## WF-05 Transfer a student (group or branch)

- **Actor:** BS (within branch), D (cross-branch). **Trigger:** level change, schedule need, family request.
- **Steps:** open student → "Transfer" → choose new group and **effective date** → enter reason → system ends current enrollment on the day before, creates the new one (BR-002) → shows what attendance history remains where.
- **Alt:** cross-branch transfer: only the Director; visibility of the student changes with the branch scope (BR-014); guardian view unaffected (BR-040).
- **Err:** effective date before the last recorded attendance in the old group is allowed only if no attendance exists after it; otherwise the system asks to correct attendance first **[VALIDATE]**.
- **Postconditions:** history intact; new lists updated.
- **Rules:** BR-001, BR-002, BR-014, BR-028. **Audit:** transfer with reason.

## WF-06 Record session attendance

- **Actor:** RG or BS on the single PC (OD-002); later teachers via the web. **Trigger:** a session took place.
- **Preconditions:** session exists (generated or created); group has enrolled active students.
- **Steps:**
  1. Open **today's sessions**, grouped by branch and time; pick the session.
  2. Roster loads (students enrolled on the session date, BR-028). Default view pre-fills "present" for speed (BR-030).
  3. Mark exceptions: absent / late / excused (note if policy requires, BR-031). Keyboard shortcuts for all states.
  4. **Confirm** the session; only now is it "recorded" (BR-030).
  5. System shows a summary (counts) and flags **consecutive absences** (REQ-046).
- **Alt:** session cancelled → mark cancelled with reason (BR-025). **Alt:** paper sheet used when the PC is unavailable → enter later with the real session date; the system marks "entered late" with the entry time.
- **Err:** attempt to record outside the active year or for a closed year → blocked (BR-017); duplicate save → updates through the same record.
- **Postconditions:** attendance saved; pending list updated; portal data marked "to publish".
- **Rules:** BR-011, BR-025, BR-027, BR-028, BR-030, BR-031. **Audit:** creation is logged with user/time; later changes follow WF-07.
- **[VALIDATE]** Do they record per day or per session today? Are sessions fixed or irregular?

## WF-07 Correct attendance

- **Actor:** BS (within window), D (any time). **Trigger:** error discovered or new information (e.g. excuse brought later).
- **Steps:** open the session/student record → "Correct" → choose new status → **mandatory reason** → system checks the correction window (BR-029) → save → original value preserved in history.
- **Alt:** beyond the window → request goes to the Director (or the BS asks the Director to act).
- **Err:** missing reason → blocked.
- **Postconditions:** corrected record, full history, portal flagged for publish.
- **Rules:** BR-029, BR-047. **Audit:** old/new value, reason.

## WF-08 Record memorization and revision

- **Actor:** AS, BS, RG (on behalf of teachers in release 1). **Trigger:** teacher reports a student's recitation.
- **Steps:**
  1. Select student (from the group roster of the session or via search) and date.
  2. Choose type: new memorization / revision / consolidation (BR-032).
  3. Select **range**: from surah:ayah to surah:ayah, via a fast picker (type surah name or number; shortcuts for "next from last record").
  4. Enter evaluation from the configured scale, optional comment, optional mistakes count **[VALIDATE: which mistake details matter?]**.
  5. Save; the system shows the updated progress and any overlap note ("part of this range was already memorized").
- **Alt:** batch entry for a group: one row per student, same date and type.
- **Err:** invalid range (BR-033); evaluation outside scale; student not enrolled.
- **Postconditions:** record stored; memorized set recalculated by union (BR-034, BR-035).
- **Rules:** BR-012, BR-032–038. **Audit:** creation; later changes as corrections.
- **[VALIDATE]** How do teachers describe where a student is today ("page 40", "from X to Y")? Page-based entry is **not** in release 1 but might be needed as input convenience.

## WF-09 Review student and group progress

- **Actor:** AS, BS, D. **Trigger:** routine follow-up, parent meeting.
- **Steps:** open student profile → summary: attendance rate, memorized set (count and visual map of ayat by surah), recent records by type, trend of evaluations → filter by period → print or export (→ WF-17). Group view: distribution, students with no activity in N days.
- **Rules:** BR-034, BR-035. **Notes:** only counts derived from rules; no decorative charts.

## WF-10 Build and change the schedule

- **Actor:** BS, D. **Priority:** Should.
- **Steps:** group → weekly pattern (days, time, room, teacher) → system generates sessions for the year excluding holidays (BR-026) → conflicts shown immediately (BR-024).
- **Alt:** one-off session; **cancel/reschedule** a session with a reason; affected guardians see the change after the next publish (WF-11).
- **Err:** conflicts: show the other item; Director override with reason.
- **Rules:** BR-024, BR-025, BR-026.

## WF-11 Publish data to the portal

- **Actor:** Director (configures), System (schedules). **Trigger:** manual "Publish now" or schedule when internet is available.
- **Preconditions:** portal configured (hosting decision OD-005), internet reachable.
- **Steps:** system builds a **minimal snapshot** (BR-042) of consenting guardians' children → sends over TLS → portal confirms → "last published" time updated.
- **Alt:** offline → queued; the desktop keeps working, shows "N changes not yet published". **Retry** with backoff; never blocks daily work.
- **Err:** portal unreachable/credentials invalid → visible, non-blocking warning.
- **Unpublish:** remove a child or everything from the portal (BR-041).
- **Rules:** BR-039–042. **Audit:** publish/unpublish with counts.

## WF-12 Guardian onboarding and portal use

- **Actor:** RG/D issues; G uses. **Trigger:** association decides to invite a guardian.
- **Steps (association side):** pick guardian → "Create portal access" → system generates a **one-time code/QR** shown/printed for in-person delivery (OD-015) → the guardian is marked "invited".
- **Steps (guardian side):** open portal URL on phone → enter code → set password → see children → each child: attendance summary, recent progress, announcements, schedule changes; "last updated" visible.
- **Alt:** forgot password → request reset; verification in person or via association (OD-015).
- **Err:** code expired/used → association issues a new code; many failures → rate-limited (Batch 4).
- **Rules:** BR-020, BR-040. **Audit:** account creation/revocation, resets.

## WF-13 Publish an announcement

- **Actor:** D, BS (own branch), AS. **Steps:** write short text → choose audience (all guardians / branch / group) → preview → publish (appears at next WF-11 publish) → can be withdrawn.
- **Rules:** BR-014, BR-041. **Notes:** no replies in release 1 (REQ-065 unresolved).

## WF-14 Backup and restore

- **Actor:** D (and System). **Trigger:** schedule, before updates/imports, manual.
- **Backup steps:** system writes a consistent copy (database + attachments) to the configured destination, verifies it (open + integrity check), records result; user sees "last verified backup" on the home screen.
- **Restore steps:** choose backup (date/size shown) → confirm with a typed phrase → system backs up current state first (BR-044) → restores → integrity check → restart.
- **Alt:** destination unavailable (USB missing) → clear warning; retry later.
- **Err:** verification failure → backup marked invalid, user alerted. **Restore test mode**: restore into a temporary location to prove a backup works without touching live data (REQ-081).
- **Rules:** BR-043, BR-044. **Audit:** every backup/restore.
- **[VALIDATE]** Is there a USB drive or second PC? Is the PC backed up today?

## WF-15 Close the academic year and start the next

- **Actor:** Director. **Trigger:** end of year.
- **Steps:** checklist (pending sessions, unrecorded attendance) → close the year with confirmation (BR-017) → create the new year → **carry-over assistant**: for each student choose new group / graduate / withdraw (bulk actions) → review → commit (audited).
- **Alt:** reopening a closed year is a Director-only, audited exception.
- **Rules:** BR-016, BR-017, OD-025.

## WF-16 Archive or withdraw a student

- **Actor:** BS, D. **Steps:** open student → "Withdraw/Archive" → reason + date → active enrollment ends, student leaves active lists, history kept, guardian access to that child removed from the portal at next publish (BR-019, BR-041).
- **Alt:** restore from archive (audited).
- **Rules:** BR-019, BR-021.

## WF-17 Produce and print reports

- **Actor:** any role per permissions. **Steps:** choose report → filters (branch, group, period, calendar) → preview → export PDF/Excel or print; paper attendance sheets from the group's roster.
- **Err:** Arabic print quality must be verified on the pilot's printer (REQ-071).
- **Rules:** BR-008 (issued prints are snapshots), BR-014 (scope). **Audit:** exports.

## WF-18 Activate the license

- **Actor:** Director. **Steps:** vendor provides a signed license file for the association (pilot: free pilot license) → Director imports it → app shows entitlements, expiry of updates/support, and confirms that data access is unconditional (BR-048).
- **Err:** invalid/corrupt file → "unlicensed" mode, data still accessible (BR-049).
- **Open:** device definition, transfer policy, pricing (OD-018).

## WF-19 Update the application

- **Actor:** Director, System. **Steps:** update available (signed) → user chooses time → **verified backup** (BR-043) → install → database migration → integrity check → if failure: automatic rollback to the previous version and database copy.
- **Rules:** BR-043. **Audit:** version change.

## WF-20 Admin recovery (blocked by OD-014)

- Recommended design: recovery key printed at setup or a second admin resets the password; vendor cannot read data. Steps and anti-abuse measures are defined in `SECURITY_PLAN.md` (Batch 4). Until then this workflow is a placeholder.

---

## Cross-workflow notes

1. **Daily rhythm of the pilot (hypothesis [VALIDATE]):** morning check → record attendance after each session (WF-06) → enter memorization records (WF-08) → end-of-day publish (WF-11) → weekly backup verified (WF-14).
2. **One PC means one operator at a time.** The app is single-user-at-a-time on that machine; fast login switching between staff matters (separate accounts, audit by user).
3. **Gender-sensitive handling** (men's/women's branch staff) is expressed by branch scope only; any further rule is OD-022/OD-003.
4. **Everything that can fail has a non-blocking recovery** (publish, backup destination, update).

## Validation plan (OD-006)

Before Batch 3, walk through WF-01, WF-03, WF-06, WF-08, WF-14 with a supervisor and a teacher from the pilot association using their real paper/Excel material. Capture: forms they use, fields they actually need, how they describe progress, how many sessions per week, and how they would explain a "correction". Update the workflows and rules accordingly.

---

**Cross-role review (Security Engineer):** WF-11 and WF-12 are the only places data leaves the association. Each needs explicit consent, minimum data, TLS, rate limiting, and an unpublish path. WF-14 and WF-20 are where data loss or takeover would happen; their designs must be reviewed before any code.
