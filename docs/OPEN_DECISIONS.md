# OPEN_DECISIONS.md

**Accountable role:** Product Manager · **Status:** Batch 1 draft (updated after each batch)

**Definition of Done:** every unresolved question has an ID, owner, options, a recommendation, a default we proceed with if unanswered, and the blocking effect.

Format: **Default** = what the documents assume until you decide. **Blocks** = what cannot be finalized without the answer.

---

## A. Needs your answer soon (blocks Batch 2/3)

### OD-001 — What does "license for the site" mean?
- **Options:** (a) license for the whole product (desktop + portal); (b) separate subscription for the web portal only; (c) per-association perpetual license + optional hosting fee.
- **Recommendation:** (c), consistent with your original brief (perpetual license, optional cloud hosting). First association free during the pilot under a written pilot agreement (duration, support, data ownership).
- **Default:** (c). **Blocks:** licensing design, hosting cost model.

### OD-002 — Who records attendance and progress in release 1?
- **Options:** (a) staff on the single PC; (b) teachers from their phones via web (needs two-way sync).
- **Recommendation:** (a) for release 1; (b) as release 2.
- **Default:** (a). **Blocks:** whether teacher accounts exist in release 1, sync design.

### OD-003 — Branch separation: strict or shared?
- **Options:** (a) strict: supervisors see only their own branch; (b) shared visibility.
- **Recommendation:** (a) strict by default; Director sees both. Safer for privacy and culturally common; can be loosened per association.
- **Default:** (a). **Blocks:** permission model, report scoping.

### OD-004 — Interface language
- **Recommendation:** Arabic only in release 1; design string-resources so French can be added later.
- **Default:** Arabic only.

### OD-005 — Hosting location and provider for the portal
- **Question:** any requirement to keep data in Algeria? Budget for hosting?
- **Recommendation:** decide after legal review (OD-012). Until then, the portal stores the minimum needed (first name/last initial, attendance, progress), no documents, no national IDs.
- **Default:** minimal-data portal, provider TBD. **Blocks:** infrastructure plan.

## B. Needs input from the pilot / your knowledge

### OD-006 — Current workflow validation
- How does the association record attendance and progress today? Can we see their sheets/registers? (Needed to validate every workflow and design the import.)
- **Default:** assume paper + Excel. **Blocks:** CORE_WORKFLOWS, import design.

### OD-007 — Team, timeline, and Kotlin/Compose experience
- Solo or team? Target date for the pilot? Prior Kotlin experience?
- **Default:** solo developer assisted by AI; pilot target = to be set. **Blocks:** roadmap sizing.

### OD-009 — Is the finance module in the pilot?
- **Recommendation:** not in release 1; add after the pilot if requested.
- **Default:** not in release 1.

### OD-010 — Certificates, ijazah, khatm ceremonies, student cards
- **Default:** student card + simple certificate = Could; ijazah/khatm = Future.

### OD-013 — Student data fields, age range, required documents
- Which fields are mandatory? Birth date or age group? National ID number (privacy risk)?
- **Recommendation:** minimal set; avoid national ID; photo only with guardian consent.
- **Default:** minimal set. **Blocks:** DATABASE_DESIGN, legal review.

### OD-017 — Attendance mode and policies
- Per session (recommended) vs once per day; late threshold; excused-absence rules; when a day "closes" for corrections.
- **Default:** per session, configurable.

### OD-020 — Calendar, weekend, numerals
- Hijri + Gregorian display? Weekend assumed Friday/Saturday? Western digits (0–9)?
- **Default:** both calendars shown, Friday/Saturday weekend, Western digits.

### OD-021 — Evaluation scale
- Numeric (e.g. 1–10), labels (ممتاز/جيد جداً/جيد/مقبول/يحتاج مراجعة), or configurable.
- **Default:** configurable, with the label scale pre-installed.

## C. Technical decisions to settle by ADR (Batch 3/4)

### OD-011 — UI technology stack for desktop vs web
- **Issue:** release 1 needs *two* UIs (desktop admin + web portal). Compose Desktop for desktop and a separate web stack means two codebases.
- **Options:** (a) Compose Desktop + separate web portal; (b) a single web-technology UI hosted locally for desktop and cloud for portal, packaged as a desktop app; (c) Compose Multiplatform for desktop and Compose/Wasm web (`VERIFY` maturity).
- **Batch 3 result (2026-11-20):** evaluated in `SYSTEM_ARCHITECTURE.md` §3 with sources. **Recommendation = Option B (TypeScript end-to-end, one UI stack for desktop and portal), subject to a 1–2 day spike** (Arabic table rendering, SQLite backup/restore in the shell, Arabic PDF printing, installer size/signing). Reasons: Compose for Web is still beta; Arabic shaping in Compose is unverified; one UI stack halves the work; the approved HTML prototype becomes real code. Cost: deviation from the original Kotlin direction, larger installer, no KMP reuse for a future native Android app.
- **Status:** **DECIDED 2026-11-20: Option B (TypeScript end-to-end), approved by the user (ADR-003).** The spike is still required before feature work and needs the user's approval to install tooling.
- **Blocks:** nothing further in the documents; blocks implementation start.

### OD-014 — Admin password recovery (single PC)
- Options: recovery key printed at setup, vendor-assisted offline reset with ownership proof, second admin. Recommendation: printed recovery key + second admin. **Blocks:** SECURITY_PLAN.

### OD-015 — Guardian credentials and identity verification
- Options: association hands out one-time codes/QR in person; phone-number OTP (cost); manual approval. Recommendation: in-person one-time code (no SMS cost). **Blocks:** portal auth.

### OD-016 — Notification channel to guardians
- Options: none (portal only), web push on PWA, SMS, WhatsApp link. Recommendation: portal + web push first; SMS later.
- **Default:** portal only.

### OD-018 — License and pricing details
- Price, what counts as a "device", transfer policy, maintenance period, hosting fee. **Default:** to be decided after pilot.

### OD-019 — Backup destinations and key policy
- USB, shared folder, cloud; encrypted backups require a key policy so lost keys do not destroy data. **Default:** local automatic + manual export to USB; encrypted cloud copy later.

## D. Legal and compliance

### OD-012 — Legal review
- Associations law (12-06) and personal data protection law (18-07), children's data, hosting, consent, retention. **Requires a qualified professional.** We flag; we do not claim compliance.
- **Default:** minimize data; no public launch of the portal before review.

## E. Resolved or delegated

| ID | Item | Resolution |
|---|---|---|
| OD-008 | Logo and visual identity | Delegated to the product team; delivered as an interactive HTML prototype in Batch 4 for your approval |
| — | Riwaya / mushaf detail | Not a pilot priority (confirmed). Dataset source and license still recorded (REQ-053) |
| — | Android app | Removed from release 1 (approved) |
| — | Sync direction | One-way desktop → cloud in release 1 (approved) |

## F. Approved defaults (approved by the user on 2026-11-20, after Batch 1)

The user approved Batch 1 and its defaults. These are now **working decisions** (can still be changed, but documents assume them): OD-001 (c) · OD-002 (a) staff record on the single PC · OD-003 (a) strict branch separation · OD-004 Arabic only · OD-009 no finance in release 1 · OD-016 portal only · OD-017 per-session attendance · OD-020 both calendars + Friday/Saturday weekend + Western digits · OD-021 configurable label scale · OD-014 printed recovery key + second admin · OD-015 in-person one-time code.

Still genuinely open (need real input): OD-005, OD-006, OD-007, OD-010, OD-011, OD-012, OD-013, OD-018, OD-019.

## G. New open decisions raised by Batch 2

### OD-022 — Does a student's gender have to match the branch?
- Real-world case: young boys may attend the women's branch (with their mothers/sisters). We do **not** assume the rule.
- **Options:** (a) branch is just an organizational unit, no gender check; (b) strict match; (c) soft warning with Director override.
- **Recommendation:** (a), with an optional gender field and a configurable warning (c) per association.
- **Default:** (a). **Blocks:** BR-014 wording, validation on registration.

### OD-023 — Student status values
- **Recommendation:** Applicant (waiting) · Active · Suspended · Graduated/Completed · Withdrawn · Archived (archived is a flag, not a status).
- **Default:** that list. **Blocks:** student lifecycle workflow.

### OD-024 — What counts as "memorized"?
- Does a new-memorization record count toward the memorized total only if its evaluation passes a pass mark, or always? Does revision ever change the memorized set?
- **Recommendation:** only records of type *new memorization* whose evaluation is at or above a configurable pass mark enter the memorized set; revision and consolidation never change it (they feed their own statistics).
- **Default:** that. **Blocks:** progress computation (BR-019/BR-020), reports.

### OD-025 — End of academic year handling
- Do students carry over automatically to a new year (with group reassignment), or must they be re-enrolled? What happens to open sessions?
- **Recommendation:** closing a year is an explicit, audited operation; students become "unassigned" for the new year and are re-enrolled via a bulk "carry over" assistant (nothing automatic).
- **Default:** that. **Blocks:** WF-15.

### OD-027 — Quran text/reference dataset: source and license
- Raised by Batch 3 (REQ-053, BR-038, ADR-008). Release 1 mostly needs **surah names, ayah counts, and a global ayah ordinal** (Quran text itself is only needed if the UI shows ayat). Riwaya detail is not a pilot priority.
- **Options:** (a) reference-only dataset (names, counts, ordinals) — no copyrighted text, fewest licensing questions; (b) include verified Quran text from a recognized source whose license permits embedding; (c) ayah text fetched/maintained separately.
- **Recommendation:** (a) for release 1; choose a recognized source for counts and **verify its license terms** (VERIFY) before shipping; add text only when a feature needs it.
- **Default:** (a). **Blocks:** seed data and checksum definition, not the architecture.

### OD-028 — Idle auto-lock, shared-PC policy, MFA for the Director
- Raised by Batch 4 (SEC-013, SEC-016). One shared PC is used by several staff.
- **Recommendation:** auto-lock after 10 minutes (configurable), fast user switching, per-user accounts (no shared logins); optional offline TOTP for the Director later.
- **Default:** that. **Blocks:** nothing structural.

### OD-029 — Brand approval
- Raised by Batch 4 (`DESIGN_SYSTEM.md` §2, §16). Items: the logo concept (niche + lamp), wordmark and typefaces, converting the wordmark to outlines, **whether to show a Quranic phrase on the login screen** (needs proofreading by a qualified person and your decision), font files and their licenses (IBM Plex families expected under the OFL; Amiri Quran `VERIFY`).
- **Recommendation:** approve the concept; keep the phrase only after proofreading; decide fonts at the spike.
- **Default:** prototype as shown. **Blocks:** final brand assets, not the architecture.

### OD-026 — Correction window for attendance
- How long after a session can staff correct attendance without Director approval? (OD-017 covers policy; this is the number.)
- **Recommendation:** configurable; default 7 days for branch supervisors, any time for Director, always audited with a reason.
- **Default:** that.

---

## H. Decision register at the end of the discovery phase (Batch 4)

**Legend:** **Decided** (you decided) · **Default** (you approved the default; can change) · **Open** (needs real input) · **Proposed** (my recommendation, not yet approved).

| ID | Topic | Status | Needed before |
|---|---|---|---|
| OD-001 | License meaning | Default (c) | Phase 8 |
| OD-002 | Who records attendance in release 1 | Default (a) staff on the PC | Phase 3 |
| OD-003 | Branch separation | Default (a) strict | Phase 1 |
| OD-004 | Language | Default: Arabic only | Phase 1 |
| OD-005 | Portal hosting/region, display-name policy | **Open** | Phase 6 |
| OD-006 | Workflow validation with the pilot | **Open** | Phase 0 |
| OD-007 | Team, timeline, Kotlin/TS experience | **Open** | Phase 0 |
| OD-008 | Logo/identity delegated | Decided (→ OD-029 approval) | — |
| OD-009 | Finance in pilot | Default: no | Future |
| OD-010 | Certificates / ijazah / khatm | Default: Could/Future | Future |
| OD-011 | Stack | **Decided: Option B** (spike pending) | Phase 0 |
| OD-012 | Legal review | **Open** (long-lead) | Gate G6 |
| OD-013 | Student data fields | **Open** | Phase 1 |
| OD-014 | Admin recovery | Default: recovery key + second admin | Phase 1 |
| OD-015 | Guardian credential delivery | Default: in-person one-time code | Phase 6 |
| OD-016 | Guardian notifications | Default: portal only | Phase 6 |
| OD-017 | Attendance mode/policies | Default: per session | Phase 3 |
| OD-018 | License/pricing details | **Open** (after pilot) | Phase 8 |
| OD-019 | Encryption at rest / backup key policy | Proposed: option B + mandatory recovery key | Phase 1 |
| OD-020 | Calendars, weekend, numerals | Default | Phase 3 |
| OD-021 | Evaluation scale | Default: configurable label scale | Phase 3 |
| OD-022 | Gender vs. branch | Default (a) no check | Phase 2 |
| OD-023 | Student statuses | Default list | Phase 2 |
| OD-024 | What counts as "memorized" | Default | Phase 4 |
| OD-025 | End of academic year | Default: manual carry-over assistant | Phase 7 |
| OD-026 | Attendance correction window | Default: 7 days | Phase 3 |
| OD-027 | Quran dataset source/license | Default: reference-only | Phase 1 |
| OD-028 | Auto-lock / MFA | Default: 10 min, TOTP later | Phase 1 |
| OD-029 | Brand approval | **Proposed** (prototype) | Phase 1 |

**Reading this table:** items marked **Open** are the ones that need your real-world input; the rest proceed on the stated defaults unless you object.

## I. Decisions recorded from the pilot owner (2026-11-20, after the first runnable version)

| ID | Decision | Status |
|---|---|---|
| OD-030 | **Release 1 login = one shared account** for the whole association (set up in the wizard). **Personal accounts per administrator** (so the audit log shows who did what) come in the next version. Consequence: until then the audit log attributes every action to the shared account. The account engine, roles and audit trail already exist, so adding personal accounts needs no redesign. | **Decided by the user** |
| OD-031 | **Existing data lives in Excel.** Required: import students from Excel/CSV (with a review step) and export lists to Excel and XML, plus printing. Old `.xls` files must be re-saved as `.xlsx`. XML *import* is not built. | **Decided by the user; implemented** |
| OD-032 | Terminology: the pilot calls a group **«فوج»**; a teacher may have several groups. Teachers' accounts, groups, activities and "monthly work" are deferred until the first version has been tried. | **Decided by the user** (scope deferred) |
| OD-041 | **Groups (الأفواج) rules chosen as provisional defaults** (2026-11-20, built from the user's go-ahead; not confirmed): (a) a group belongs to one branch and the active academic year; its name is unique per branch and year; (b) **capacity is advisory** — enrolling beyond it is allowed and shown as a warning; (c) a group can be **closed only when empty**; (d) a teacher may lead several groups and a group may have several teachers, but only **teachers of the same branch**; (e) only **active** (non-archived) students can be enrolled; (f) a student has one open group per year; **moving** ends the old enrollment the day before and starts the new one today (history kept); a student enrolled or removed **today** cannot be moved or re-enrolled until tomorrow (no overlapping ranges, BR-002); (g) leaving a group needs a written reason. Who may edit: group.edit (Director, branch supervisor); who may enroll: enrollment.manage (also the registrar). Recommendation: keep; confirm capacity behaviour (warn vs block) and whether a student may be in two groups at once (e.g. memorization and Tajweed). | **Provisional; implemented** |
| OD-042 | **Attendance rules chosen as provisional defaults** (2026-11-20, not confirmed): (a) one session per group per day; its time range is typed when the day is first recorded (the form suggests 16:00–17:00 — **a placeholder, not an association rule**); (b) four statuses: present, late (optional minutes), absent, excused; (c) the sheet lists students enrolled in the group on that date; all of them must be marked before saving; (d) no future dates, none outside the academic year; (e) a day entered after it happened is flagged "entered late"; (f) a record is never edited silently: a **correction** needs a reason and keeps old/new status in an append-only table; only Director and branch supervisor may correct, the registrar may record; (g) a day can be marked "no class" with a reason, only if nothing was recorded; (h) no rule yet for how many absences trigger action (warnings to guardians wait for guardian records, OD-037). Recommendation: confirm whether the registrar should be allowed to correct, the real session times, and what counts as a warning-level absence. | **Provisional; implemented** |
| OD-043 | **Reports: provisional definitions** (2026-11-20, not confirmed): (a) four reports built — enrollment (students per group, unassigned students), attendance (per student over a period), group activity (days held / no-class / entries), and a blank printable attendance sheet; (b) **attendance rate = (present + late) ÷ recorded days**, excused counts as recorded but not attended — the association may count excused days differently; (c) the registrar (report.view_limited) sees the enrollment report only; the others need report.view; (d) **teacher activity cannot be attributed to a person** while everyone shares one login (OD-030): the report shows the teachers assigned to each group, not who entered the data; (e) Excel export and print only; PDF export is not built (print to PDF from the print dialog works); (f) progress/memorization reports wait for the memorization module. Recommendation: confirm the rate formula and which reports the registrar should see. | **Provisional; implemented** |
| OD-044 | **Memorization and evaluation: provisional rules** (2026-11-20, not confirmed): (a) **reference data** = surah names and ayah counts only (no Quran text), Kufan numbering, 6,236 ayat, dataset version `kufan-6236-v1` — **VERIFY** the counts against a recognised source and record the source and its license (OD-027) before shipping; the arithmetic total (6,236) and spot checks are tested; (b) record types new / revision / consolidation (BR-032); a range may span surahs; both ends must exist and start must not be after end (BR-033); (c) **memorized set = union of ranges** of *new* records at or above the pass mark; overlaps count once; revision/consolidation never change it (BR-034/035); (d) **evaluation scale v1** = ممتاز / جيد جداً / جيد / مقبول / يحتاج مراجعة (ranks 5..1), stored with each record with its scale version; **pass mark = مقبول (rank 2)** — placeholders for OD-021/OD-024; the settings screen to change them is NOT built; (e) a new-memorization record must carry an evaluation (otherwise it could never count); revision/consolidation may omit it; (f) a record needs an enrollment of the student on its date (BR-037) and cannot be future-dated; (g) records are **never edited**: a wrong one is voided with a reason (stays visible, struck through) and a new one entered; (h) who records: Director, branch supervisor, academic supervisor; the registrar cannot even view; teachers cannot record because they have no accounts yet (OD-030); (i) not built: hizb/thumn/page tracking, tajweed levels, ijazah (REQ-055, future); progress is not yet in the printable reports or the guardian portal. Recommendation: confirm the scale and pass mark with the teachers, then make them configurable. | **Provisional; implemented** |
| OD-045 | **Guardians, phones and WhatsApp: provisional rules** (2026-11-20; the user asked for these features, details are mine): (a) guardian = name + phone + relation, linked to one or several students (siblings share one record when name and phone match); first guardian of a student is the primary contact; (b) **phone numbers are assumed Algerian** (country code 213; mobile = 05/06/07 + 8 digits; a 9-digit number starting 5/6/7 gets its zero back because Excel drops it; other national numbers are landlines; foreign numbers accepted with +): VERIFY with the association; (c) who sees phones: anyone who may view the student (including the academic supervisor); who edits: guardian.edit (Director, branch supervisor, registrar); changing a guardian shared across branches needs the right in every branch; (d) **guardian import from Excel** matches rows to students by student number, else by name words + birth date, else by a unique name alone (shown as a warning); unmatched or ambiguous rows are reported, never guessed; re-importing the same file adds nothing; (e) **WhatsApp is semi-automatic**: the program opens a chat in the user's own WhatsApp with an editable text; the person presses send; nothing is sent by the program; only https://wa.me/ links are ever opened and the number is read from the record, not from the page; each opening is logged (not whether it was sent); (f) message wording (general, absence) is a placeholder written by the assistant; (g) legal review needed for storing guardians' phone numbers and contacting them (OD-012). | **Provisional; implemented** |
| OD-046 | **Backups and automatic saving** (user request, 2026-11-20): backups in a folder of the user's choice (Desktop, Documents, any folder), optionally a Google Drive folder, plus saving of daily work. Built: (a) every committed change is durable at once (SQLite WAL with synchronous=FULL) so a power cut loses nothing already confirmed; (b) an encrypted, verified backup is also made automatically when something changed: every 10 minutes while someone is signed in, at sign-out and when the program closes (not when nothing changed; sign-in events do not count as changes); (c) an optional **second folder** receives a copy of every automatic backup; (d) Google Drive is **not accessed by the program**: if Google Drive for desktop is installed, the folder it syncs is offered (VERIFY folder names per version/language) and the encrypted files are uploaded by Drive itself; without that app the program cannot back up to Google Drive; this departs from the 'everything local' direction (OD-038) only because the user asked, and files are encrypted (a copy on Drive is useless without the recovery key); (e) automatic backups are tidied: all kept for 2 days, then one per day for 90 days, then deleted; manual, pre-import, pre-upgrade and pre-restore backups are never deleted automatically; (f) closing the window waits up to 20 s for the final backup. Not built: backup status e-mail/alerts, restore from Drive without a local copy. | **Decided by the user; implemented** |
| OD-047 | **End of academic year** (OD-025 default, built 2026-11-20): closing the year is an explicit, audited action (Director): open enrollments end at the year's end (reason "year_end"), the year is closed, the next year opens (must start after the old one ends), groups and their teachers can be copied; **no student moves automatically**: a carry-over step enrolls the students of each old group into a chosen new group from the new year's first day (archived/non-active students are skipped; repeating it adds nothing). Unpaid months of a closed year stay in its records and do not appear in the current arrears report (needs a decision: carry arrears over?). History (attendance, memorization, payments) is kept. | **Provisional; implemented** |
| OD-048 | **Update existing students from Excel** (built 2026-11-20): matched by **student number only**; updates birth date, phone and joining date; never creates students; an empty cell never erases a value; same validation as a manual edit; all-or-nothing; each change appears in the student's history. Evaluation scale and pass mark are now editable in Settings (OD-021/OD-024 mechanism; the default values are still placeholders). | **Provisional; implemented** |
| OD-049 | **Phone version over Wi-Fi: first version** (user request 2026-11-20, completing OD-038; the details below are the assistant's defaults, not confirmed): (a) the desktop program stays the only database and, **only when the Director switches it on** (Settings → «نسخة الهاتف»), serves a small page over HTTPS on the PC's private network address (port 8443); the phone has no database (nothing to synchronise); (b) **no cloud, no internet**: only private addresses (192.168.x, 10.x, 172.16-31.x, link-local) are accepted; (c) **pairing** with a 6-digit code made on the desktop (valid 5 minutes, one use, 5 wrong tries lock that address for 5 minutes); each phone gets its own secret token (only a hash is stored) and is limited to the branches chosen when the code was made; the Director can revoke a phone at once; at most 20 phones; (d) **what the phone can do**: list groups with today's attendance state, record a day's attendance (same rules as the desktop: all-or-nothing, no future dates), search students by name/number, see a student's memorization summary and record new/revision/consolidation; (e) **what it cannot do**: money, guardians' phone numbers, photos, corrections, cancelling a day, voiding records, any deletion, settings; these routes do not exist (tested); (f) everything a phone records is written to the audit log with the **device name as the actor** (the first step toward knowing who did what while the login is shared, OD-030); (g) **TLS with a self-signed certificate** made by the program (ECDSA P-256, valid 3 years, covers this PC's addresses, private key protected by Windows DPAPI): the phone's browser shows a one-time 'not secure' warning that must be accepted; the connection is encrypted but the phone cannot verify who it is talking to, so pairing must happen on the association's own Wi-Fi; certificate pinning needs a phone app (not built); (h) **no QR code yet** (needs a library, not installed without approval): the code is typed; (i) requires the PC on, the program open (signed in or not) and the phone on the same Wi-Fi; Windows may ask to allow the program on 'private networks'; some Wi-Fi routers isolate devices from each other (AP isolation) and block it; (j) not tested on a real phone or a real router: only a phone-sized Chromium window on the same PC. Recommendation: confirm who uses it (teachers? supervisors?), whether memorization entry on a phone is wanted, and test with one real phone before wider use. | **Provisional; implemented** |
| OD-050 | **Standard first account: admin / admin, changed at first sign-in** (user decision, 2026-11-20, replacing 'each association chooses its own account'): a fresh installation creates the shared account **admin / admin**; the program shows these credentials on the login screen **only while the password has not been changed**, and after the first sign-in it **blocks every action except choosing a new password** (≥10 characters, not 'admin'); the username stays admin. Implementation notes: the password policy is not relaxed for anyone else (the account is created with a random strong password and set to 'admin' only inside the setup transaction); existing installations are unaffected; forgetting the new password is handled by the recovery key (OD-047-adjacent, built 2026-11-20). **Risk accepted by the owner**: between installation and the first sign-in, anyone with access to the PC can sign in as admin; a copy left unattended with the standard password is weak. Not built: per-person accounts (OD-030). | **Decided by the user; implemented** |
| OD-051 | **Named accounts: one account per person, several administrators** (user request, 2026-11-20; provisional). The Director (administrator) adds people from the «الحسابات» screen: name, username, role (Director / branch supervisor / registrar / academic supervisor) and, for every role except the Director, one branch. A temporary password is generated and shown once; the person must choose their own at the first sign-in (no old password asked). The Director can reset a forgotten password (new temporary one), change role/branch, rename, disable and re-enable. **Several Directors are allowed**; the first account (made at setup) is the MAIN administrator and can never be disabled or demoted, so the association cannot be locked out; nobody can disable, demote or reset themselves. A disabled person is signed out at the next action; role changes apply at the next action. «سجل النشاط» (Director only, audit.view) shows who did what, when, in plain Arabic, newest first, filterable by person; the audit log itself stays append-only. Not decided / not built: a separate Teacher role (teachers do not sign in; the four existing roles cover supervisors), whether a second Director may see the finance section without the finance password, transferring the «main» status, and password expiry. | **Decided by the user (direction); details provisional; implemented** |
| OD-033 | Spreadsheet formats beyond the above (e.g. importing XML, PDF export) and the exact columns of the association's existing Excel file | **Open** — a sample file from the association will tune the column recognition |
| OD-034 | **Monthly fees are required** (OD-009 is no longer "optional"). Pilot answers (2026-11-20): one **fixed amount** for every student; **no discounts or exemptions**; each student pays **one month at a time, every month**; a **receipt (وصل استلام)** is given; **arrears exist** and carry over; **staff do not handle money**. | **Decided by the user** (details below still to confirm) |
| OD-035 | Fee rules proposed as defaults, **awaiting the user's confirmation**: (a) billable months = the months of the active academic year, minus months the Director marks as non-billable; (b) a student owes from the month he joins (full month); (c) archived/withdrawn students stop owing from the following month; (d) the monthly amount can change, and a change applies only to future months; (e) receipts are numbered sequentially per academic year with no gaps; (f) a recorded payment is never edited or deleted: a mistake is cancelled with a reason (an audited reversal) and re-entered; (g) arrears = unpaid billable months up to the current month; (h) currency DZD, whole dinars. | **Approved by the user 2026-11-20** (limits: a student's *status* change is not dated yet, so rule (c) is applied through **archiving**: archive a withdrawn student to stop charges; joining month = join date, else the month the record was created) |
| OD-036 | **Who may record payments**, given "staff do not handle money" and the shared login of release 1 (OD-030). Options: (A) a separate **finance password** protecting the whole finance section, known only to the person who collects (quick, no personal accounts needed); (B) personal accounts first, then a Finance role (cleaner, later). Recommendation: **A now, B in the next version**. Until B, the audit log cannot tell *which person* recorded a payment, so each payment also stores a typed **collector name**. | **Option A approved by the user 2026-11-20** (still unanswered: who collects the money, which decides who is told the finance password) |
| OD-037 | **Guardian phone numbers** will arrive later as an Excel file prepared by the association. Needed: guardian records linked many-to-many to students; import that matches rows to students by student number, else by normalized name + birth date; unmatched or ambiguous rows reported, never guessed; a new "update existing students" import mode. | **Decided by the user; to build** |
| OD-038 | **Everything stays local** (user, 2026-11-20): a phone version in addition to the desktop, with **no cloud**, unless forced. Proposed design: the desktop stays the only database and, only when switched on, serves a phone page over the association's own Wi-Fi (LAN); the phone is a thin client with no database of its own (nothing to sync). QR pairing, per-device key, TLS with a pinned certificate. Consequences: PC on and on the same Wi-Fi; guardians at home cannot be served without internet (hosted portal, OD-005); money never on the phone; only useful after groups and attendance exist. | **Direction decided; design awaiting confirmation** (who uses the phone: teachers? admins?) |
| OD-039 | **No "director/manager account" in the product** (user, 2026-11-20): everyone signs in with **one shared login account** asked for every time the app opens. The role engine stays internally (the shared account has full rights) but is not shown. Personal accounts later (OD-030). | **Decided by the user; implemented** (wizard asks only username + password; no role shown) |
| OD-040 | **Profiles, teachers and photos** (user, 2026-11-20): every student and every teacher has a profile page (data, photo, history of what happened). A **teachers page**, separated by men's/women's branch. **Photos** for students and teachers are stored as small cropped JPEG thumbnails *inside the database* (so backups carry them), **only after a typed consent statement** (who agreed), recorded in `consent_record`; removing a photo deletes it and withdraws the consent. Positions (teacher/supervisor/other) and kind (employee/volunteer) are provisional fields. Photos of minors and consent wording need legal review (OD-012). | **Decided by the user; implemented** |
| OD-052 | **Guardian app: first prototype** (user request 2026-11-21; details are the assistant's defaults, not confirmed): (a) a guardian opens `/g` on the program's private-network HTTPS server (same server and certificate as the phone page, only while the Director has switched it on), types the phone number on file + an 8-character code handed over in person (OD-015); (b) **no search by child name**: a guardian sees only children linked to their own record (active students only), so one cannot look up someone else's child; (c) read-only: name, group, branch, memorized ayat out of 6,236 and whole surahs, last recitation date, attendance counts, last 8 records with evaluation; **no phone numbers, no money, no photos, no notes**; (d) the code is shown once to staff with `guardian.edit` on every branch of the guardian's children (Guardians tab → «رمز للتطبيق»), only its hash is stored, a new code replaces the old one, it can be revoked; 5 wrong codes lock that guardian for 15 minutes and 10 wrong tries lock the address for 5 minutes; sessions last 30 minutes and live in memory only; (e) every issue/revoke is audited; (f) **not built**: reaching it from the internet (needs hosting and one-way publish, OD-005, and legal review OD-012 for children's data), notifications (OD-016), code expiry, QR; (g) **not tested** on a real phone or router. Recommendation: legal review before any real child's data is published outside the association's own network. | **Provisional; prototype implemented** |

## J. Candidate features from an outside observation (recorded 2026-11-22)

**Source:** the user shared screenshots of a public post by another developer describing a Quran-school platform (roles: student, sheikh, school administration, guardian; announcements; teacher absence notices; a "follow-up card"; self-registration approved by a supervisor). Only the **ideas** are recorded here, nothing is copied. None of these is decided: each waits for the user's decision, informed by the association's trial feedback. Nothing below is built.

| ID | Candidate | Options | Recommendation | Status |
|---|---|---|---|---|
| OD-053 | **Weekly group schedule (جدول الحلقة).** Already specified (REQ-030, WF-10, `schedule_pattern` in `DATABASE_DESIGN.md`) but **not built**: today the time range is typed each day (OD-042a). | (a) build REQ-030 as designed: days and times per group (room and teacher optional); the attendance sheet offers the scheduled day and times; (b) keep typing times per day. | (a), after the trial, using the association's real session days and times (which are not known yet). | **Open** |
| OD-054 | **Cancelled session / teacher absence, with a reason, told to guardians.** Today a past day can be marked "no class" with a reason (OD-042g); guardians are not told; REQ-032 (changes visible on the portal) is not built. | (a) allow cancelling a scheduled session in advance with a reason, and offer a prepared WhatsApp text to the guardians of that group (semi-automatic, as in OD-045e: a person presses send); later show it on the portal; (b) portal only (Phase 6); (c) nothing. | (a), after OD-053. Who may cancel: Director and branch supervisor (teachers do not sign in, OD-051). Message wording to be written with the association. | **Open** |
| OD-055 | **Announcements (الإعلانات).** Specified for the portal (REQ-062, WF-13, Phase 6), not built. | (a) a small announcements list on the desktop now, addressed to a branch or one group, printable and copyable as a WhatsApp text; the same records are published to the portal later; (b) wait for Phase 6. | (a) is small and useful without internet; decide after the trial. | **Open** |
| OD-056 | **Weekly follow-up card for guardians (بطاقة المتابعة).** New. Today only the full printable student sheet exists (كشف الطالب). | (a) a short per-student card for a chosen week: newly memorized range(s) (from the union of ranges, BR-034), attendance counts, evaluations; printable and copyable as a WhatsApp text; (b) monthly instead of weekly; (c) none, the full sheet is enough. | (a); the period (week or month) is for the association to choose. | **Open** |
| OD-057 | **Teacher's note to the guardian.** New. Changes OD-052c, which deliberately shows **no notes** to guardians. | (a) an optional short note per memorization record or per card, marked "for the guardian", append-only and audited, shown on the card and the guardian page; (b) no notes visible to guardians. | (a) only after the legal review (OD-012): free text about a child is sensitive, and the wording rules (length, who may write) need the association. | **Open** |
| OD-058 | **An account for each student.** New. | (a) students sign in (needs internet hosting and accounts for minors); (b) no student accounts: the guardian follows the child. | (b). Most students are minors; accounts add legal exposure (OD-012) and support cost for little gain while guardians can see everything relevant. | **Proposed: do not adopt** |
| OD-059 | **Self-registration ("choose account type, then a supervisor approves").** New. | (a) anyone registers and claims a role or a child, a supervisor approves; (b) keep in-person one-time codes handed over by the association (OD-015, OD-052). | (b). Self-registration needs an internet server as system of record (contradicts the one-way, desktop-first decision) and invites impersonation of guardians. | **Proposed: do not adopt** |

Two-way messaging between teachers and guardians, also in the post, is **not** a new decision: it stays deferred under OD-002 (teacher entry from phones) and OD-016 (notifications).

---

**Cross-role review (Software Architect):** OD-011 is the decision with the largest cost impact. It has been decided (Option B) but remains conditional on the spike's evidence.
