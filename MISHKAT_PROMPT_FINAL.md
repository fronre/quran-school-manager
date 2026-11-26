# MISHKAT (مِشكاة) — The Complete Quranic Association Management Ecosystem

> Final merged prompt (original brief + corrective addendum, 2026-11-20).
> Where two statements conflict, **Section 0 (Execution Protocol) and Section 12 (Corrections)** take precedence.

---

## 0. EXECUTION PROTOCOL (read first)

1. **Discovery phase only. Do not write application code** until I explicitly approve the architecture and roadmap.
2. **Work in 4 batches** (see Section 10). Stop after each batch and wait for my approval. Never start the next batch on your own.
3. **Before Batch 1, ask me 15–20 discovery questions**, ordered by importance (see Section 11 for the questions I already know matter). Whatever I cannot answer becomes a recorded open decision.
4. **Never silently invent a missing business rule, legal rule, or product decision.** Record it in `OPEN_DECISIONS.md` with options and a recommendation.
5. **Do not overwrite existing files without inspecting them.** Do not install packages or change system configuration without approval.
6. **Never claim tests passed without running them.** Do not hide or suppress failures.
7. **Be honest about uncertainty.** Technology facts that change over time (library support, packaging tools, legal requirements) must be marked `VERIFY` and checked before they drive a decision. Legal topics require review by a qualified professional; flag them, do not rule on them.
8. **Persistent rules file:** create a `CLAUDE.md` at the repo root containing the stable rules of this prompt (identity, constraints, "do not invent rules", language, brand tokens) so they survive long sessions. Show me its content for approval.
9. **Document language:** technical documents in **English**, with a bilingual **Arabic/English glossary** of domain terms and Arabic UI strings kept separate. (Default; I may override.)
10. **Traceability:** use stable IDs everywhere — `REQ-###` (requirements), `BR-###` (business rules), `OD-###` (open decisions), `RISK-###`, and an **ADR** (architecture decision record: context, options, decision, consequences) for every significant technical decision. Cross-reference them between documents.
11. **Each document needs a "Definition of Done"** at its top and must separate: **Confirmed requirements / Recommended decisions / Unresolved decisions / Future features.** Suggested length: 3–10 pages per document; no padding.
12. **Environment inspection:** inspect the repository (currently empty) and check — without installing anything — which of JDK, Gradle, Android SDK, Git, and PostgreSQL are present and in which versions. Report gaps.

---

## 1. ROLE

You are a senior product team working as one coherent unit. Each document you write has **one accountable role** (named in the document) and ends with a short **review from another role's viewpoint**. Roles available:

CTO · Software Architect · Kotlin Multiplatform Engineer · Windows Desktop Engineer · Android Engineer · Backend Engineer · Database Architect · UX/UI Designer · Design Systems Engineer · Security Engineer · QA Automation Engineer · DevOps Engineer · Product Manager · Business Analyst.

Mission: design and build **MISHKAT**, a complete, commercial-grade management ecosystem for Quranic associations, Quran memorization centers, and Islamic educational institutions. Think like a company shipping to thousands of real organizations — not a student project, tutorial, or basic CRUD app.

---

## 2. PRODUCT IDENTITY

- **Name:** MISHKAT (مِشكاة)
- **Category:** Quranic Association Management Ecosystem
- **Initial market:** Algeria. **Future:** Arab countries and international markets.
- **Vision:** one comprehensive platform covering the full operational lifecycle of a Quranic association — registration, academic progress, Quran memorization, teachers, attendance, administration, communication, finances, reporting, and governance. Configurable to different association structures and policies.
- **Philosophy:** everything important in one coherent system · no unnecessary complexity · professional UX · accurate, auditable records · Arabic-first, RTL-first · offline-capable · secure by design · configurable · commercially maintainable · built for real daily use.

---

## 3. PRODUCT ECOSYSTEM

### A. Windows Desktop Application
Primary administrative application for directors, administrators, academic supervisors, financial administrators, and reception/registration staff. Distributed as a professional Windows installer + executable. (`VERIFY`: packaging tool, **code-signing certificate** requirement/cost, auto-update mechanism, installer size, minimum hardware.)

### B. Android Application(s)
Dedicated mobile experience (not a shrunken desktop UI) for teachers, parents/guardians, and administrators where appropriate.
- Teachers: assigned groups, attendance, memorization progress, evaluations, schedules.
- Parents: children's attendance, progress, announcements, relevant reports.
- **Decision required:** one app with roles vs. two apps (record as an ADR).

### C. Backend and Cloud Platform
Multiple associations · secure authentication · RBAC · association (tenant) isolation · cloud storage · synchronization · notifications · backups · licensing · audit trails · API versioning. Must support growth without a rewrite.

### D. Deployment Modes
1. **Local** — association operates on its own infrastructure.
2. **Cloud** — hosted infrastructure.
3. **Hybrid** — local operation with controlled cloud synchronization.

Define data ownership, synchronization authority, conflict resolution, retry behavior, and offline operation **explicitly**. Never allow two independent authorities to overwrite each other without a defined conflict policy.

**Mandatory questions the architecture must answer** (see Section 12): how multiple Windows PCs in one association share data in Local mode; which features require cloud (e.g. the parent portal); and whether Hybrid ships in the first release.

---

## 4. FUNCTIONAL MODULES

For each module: business purpose, workflow, permissions, domain rules, data model, UI/UX spec, test strategy, error handling, security considerations, and a **MoSCoW priority** (Must / Should / Could / Won't-now).

### 4.1 Association Management
Identity and branding · profile · address/contact · departments · branches · organizational structure · academic calendar · settings · language/localization · operational policies · academic year configuration · customizable attendance policies · configurable evaluation policies.

### 4.2 Student Management
Registration · personal info · profile · contacts · parent/guardian relationships · emergency contacts · enrollment history · academic history · group assignment and transfers · status · document attachments · search/filter · archiving · reports.
Rules: a student belongs to **only one group at a time within the same academic year**; transfers preserve history.

### 4.3 Teacher and Staff Management
Profiles · contacts · qualifications · teaching assignments (multiple groups) · employment or volunteer info · availability · schedules · activity reports · staff permissions.

### 4.4 Groups and Departments
Configurable departments · memorization groups · capacity · schedules · teacher assignments · enrollment management · academic level · group history · performance statistics. Teachers may teach multiple groups.

### 4.5 Attendance
Daily and session-based modes (configurable) · present / absent / late / excused · history · corrections with audit history · reports · guardian notifications where configured. Records must be validated against the student's enrollment and the relevant session.

### 4.6 Quran Memorization and Educational Tracking (core differentiator)
New memorization · revision · consolidation · recitation · evaluation · surah selection · juz tracking · ayah ranges · pages · hizb/thumn/rub' · memorization and recitation quality · mistake recording · teacher comments · evaluation history · individual and group progress · academic reports · configurable evaluation criteria.

Requirements:
- Use a **validated canonical Quran reference dataset**. It must explicitly define the **riwaya** (e.g. Warsh 'an Nafi' / Hafs 'an 'Asim), the **verse-counting system**, and the **mushaf pagination** it follows. Unresolved choice → `OD-###`. Verify the **text source and its license**, and add integrity checks (checksums).
- Preserve exact Surah/Ayah references.
- Never compute completion by adding verse counts when ranges overlap (use range union).
- Memorization, revision, and consolidation are distinct activity types.
- Quran text uses a dedicated Quran font, separate from the UI font.
- Consider (as Should/Could, not assumed): tajweed levels, ijazah/sanad, khatm tracking, certificates.

### 4.7 Scheduling and Timetables
Group and teacher schedules · sessions · rooms · changes · recurring sessions · calendar views · conflict detection (teacher double-booking, overlapping sessions) · holidays · academic calendar. Support the **Hijri and Gregorian calendars** and Friday/Saturday weekend; consider prayer-time-relative scheduling as a Could.

### 4.8 Parent and Guardian Portal
Guardian accounts · multiple children · attendance · progress · memorization/revision reports · announcements · notifications · documents · permissioned communication. **Guardian identity records and login accounts are separate domain concepts.** Declare which deployment modes support this portal.

### 4.9 Financial Management (optional per association)
Income · expenses · membership fees · contributions · donations · categories · payments · summaries · receipts · reports · period reporting · audit history.
History is preserved; corrections use explicit reversal/correction records, never silent edits. Respect currency boundaries (primary currency DZD; multi-currency is an open decision).

### 4.10 Communications and Notifications
Announcements · teacher/parent notifications · reminders · schedule-change and attendance notifications · history · user preferences. Channels per permission and configuration. **Channel options and cost must be decided** (push, SMS, messaging apps; note push depends on Google services availability) — record as open decision.

### 4.11 Reports and Analytics
Student, enrollment, attendance, teacher activity, group performance, memorization progress, academic performance, financial reports, year-over-year comparison. Export to PDF and Excel. Accurate, filterable, printable (Arabic printing quality is a requirement).

### 4.12 Documents and Archives
Student/association/educational/administrative/financial documents · secure storage · permissions · archiving and retention policies. Include **printable artifacts**: student cards, certificates, receipts, paper attendance sheets.

### 4.13 Audit and Governance
User activity logs · sensitive-operation logs · record history · administrative actions · permission changes · export history · security events. Audit history must not be silently editable by ordinary users.

### 4.14 Backup and Recovery
Automatic and manual backups · restore procedures · verification · data export · recovery testing · encryption where appropriate. **Define key management and a recovery-key policy** (a lost key must not silently destroy an association's data).

### 4.15 Licensing and Commercial Management
Perpetual licenses · association license · validation · offline activation · device/deployment limits · feature entitlements · version management · transfer policy · separate maintenance/support agreements · optional cloud hosting · trial mode.
**Never make association data inaccessible because a support or maintenance agreement expired.** Be realistic about piracy resistance on JVM apps; do not promise it. Do not depend on an online payment gateway for the first release.

### 4.16 Data Import and Onboarding (Must)
Associations currently use paper and Excel. Provide **Excel/CSV import** (with validation report and dry-run), and a **first-run setup wizard** (association → academic year → departments → groups). Include a secure admin-account recovery path.

### 4.17 Updates and Support
Signed auto-update with a **database backup before migration** · diagnostics bundle that excludes student data · opt-in crash reporting.

---

## 5. BUSINESS RULES AND DATA INTEGRITY

Business rules live in the **domain layer** and are tested independently of the UI.

1. One active group enrollment per student per academic year.
2. Group transfers preserve historical enrollment.
3. A teacher may teach multiple groups.
4. Attendance policies are configurable.
5. Financial management is optional.
6. A guardian can be associated with multiple students.
7. A student can have multiple guardians.
8. Issued academic and financial records preserve historical integrity.
9. Financial operations respect currency boundaries.
10. Association data never leaks across tenants.
11. Attendance references valid enrollment and sessions.
12. Quran tracking preserves exact Surah and Ayah references.
13. Every sensitive operation is authorized and auditable.

Missing decision → do not invent; record it with options.

---

## 6. DESIGN AND UX

Visual quality is a first-class requirement: premium, contemporary Islamic institutional identity; Arabic-first RTL.

**Brand tokens**

| Token | Value |
|---|---|
| Primary Emerald | `#064E3B` |
| Deep Green | `#003527` |
| Archival Brass | `#B48E43` |
| Persian Teal | `#0F766E` |
| Warm Ivory | `#F4F5F0` |
| White | `#FFFFFF` |
| Primary text | `#0F172A` |
| Secondary text | `#334155` |

Typography: **IBM Plex Sans Arabic** (Arabic UI), **IBM Plex Sans** (Latin), plus a **dedicated Quran-text font** appropriate to the chosen riwaya.

**Contrast rule (measured):** Brass `#B48E43` is only 2.78:1 on Ivory and 3.05:1 on White — it fails WCAG AA for text. Use brass for **decoration and emphasis** (rules, large icons, borders, badges), not small text on light backgrounds. For brass-colored text on light backgrounds define a **darker brass variant** and validate it with a contrast tool. Teal/Emerald/text pairs already pass. Every color pair used for text must be validated (WCAG AA) and listed in `DESIGN_SYSTEM.md`.

**Philosophy:** dense but readable information · exceptional spacing and alignment · strong hierarchy · elegant navigation · professional data grids · clear forms · consistent iconography (single icon set, direction-aware arrows) · subtle depth/borders · excellent empty, loading, error, success — **and offline, syncing, and conflict** — states. Decide numerals policy (Western 0–9 default for Algeria; option for Eastern Arabic) and dark mode priority (likely Could).

**Avoid:** generic AI dashboards · excessive cards · random gradients · excessive ornamentation · unnecessary animation · inconsistent components · tiny type · decorative charts with no operational value. Define minimum font sizes for dense tables.

**Desktop:** reference 1440×900; support 1366×768 and 1920×1080; high-DPI; resizable; keyboard shortcuts; RTL navigation; large tables.
**Mobile:** touch-friendly; fast attendance; simple teacher flow; clear parent flow; accessible Arabic; brand-consistent with desktop.

Create the design system **before** screens. Validate it with an **interactive HTML prototype** that I approve before any Compose implementation.

---

## 7. TECHNICAL ARCHITECTURE

Preferred direction (each choice needs an ADR; items marked `VERIFY` must be checked against current docs):

- **Desktop:** Kotlin, Compose Multiplatform / Compose Desktop (JVM, Windows), Clean Architecture, MVVM. `VERIFY`: Arabic shaping, diacritics (tashkeel) rendering, mixed bidi text, large data grids.
- **Android:** Kotlin, Jetpack Compose, Material 3, shared domain rules where appropriate.
- **Backend:** Kotlin, Spring Boot, REST + OpenAPI, PostgreSQL; **Row-Level Security with mandatory `tenant_id`** as defense in depth.
- **Local persistence:** SQLite with a Kotlin-compatible library (Room KMP vs SQLDelight vs Exposed — `VERIFY` current state and decide by ADR).
- **Infrastructure:** Gradle Kotlin DSL, Flyway or Liquibase, GitHub Actions, automated tests, secrets management, structured logging, monitoring, backups.
- **Shape:** modular monolith first; no microservices without a proven requirement. Keep a pure, dependency-free `domain` module shared across desktop/Android/server where practical.

**Sync-ready from day one (non-negotiable for the schema):** UUID (prefer v7) primary keys · `tenant_id` on every tenant-owned table · version/`updated_at`/`updated_by` fields · soft deletes with tombstones · no auto-increment IDs · explicit per-entity conflict policy.

---

## 8. SECURITY

Secure authentication · MFA where appropriate · RBAC · tenant isolation · modern password hashing · session management · refresh-token security · rate limiting · input validation · SQL-injection prevention · secure uploads · TLS · sensitive-data protection · audit logging · backup security · device management · secure license verification. Defense in depth.
Do not claim any system is completely secure. Produce a realistic **threat model** (including **children's data**, photos/documents, guardian–teacher communication) and a list of security tests. Include data-protection concerns under Algerian law (see Section 12) flagged for legal review.

---

## 9. QUALITY ENGINEERING

TDD where practical. Unit, domain, integration, database, API, authorization, **tenant-isolation**, UI, synchronization, and regression tests. Test critical business rules before the features that depend on them. Never claim tests passed without executing them; never suppress failures to get a green build.

---

## 10. PRODUCT STRATEGY, PHASES, AND THE FIRST TASK

### Delivery phases (to be validated against dependencies and pilot workflows)
1. Discovery, workflows, requirements, architecture, design system (+ **early review with a pilot association**).
2. Windows desktop foundation, identity, association setup, core administration, **data import and onboarding wizard**.
3. Students, teachers, departments, groups, enrollment → **pilot trial build with a real association**.
4. Attendance, scheduling, Quran tracking.
5. Guardians, notifications, reports.
6. Optional finance module and documents.
7. Backend, cloud, licensing, synchronization (Hybrid mode only if justified).
8. Android applications.
9. Pilot hardening, feedback, security review, performance testing, commercial release.

### FIRST TASK — documents, in 4 batches (no application code)

Required documents: `PRODUCT_VISION.md`, `PRD.md`, `BUSINESS_RULES.md`, `USER_ROLES_AND_PERMISSIONS.md`, `CORE_WORKFLOWS.md`, `SYSTEM_ARCHITECTURE.md`, `DATABASE_DESIGN.md` (with a complete **conceptual ERD**, relationships, constraints, indexes, and tenant-isolation requirements), `SECURITY_PLAN.md`, `SYNC_STRATEGY.md`, `DESIGN_SYSTEM.md`, `IMPLEMENTATION_ROADMAP.md`, `OPEN_DECISIONS.md`.

| Batch | Contents | Stop for |
|---|---|---|
| 1 | `PRODUCT_VISION`, `PRD` (with MoSCoW and a defined MVP), `USER_ROLES_AND_PERMISSIONS`, draft `OPEN_DECISIONS`, glossary, `CLAUDE.md` draft | My answers to critical open decisions |
| 2 | `BUSINESS_RULES`, `CORE_WORKFLOWS` | Review (ideally with a real supervisor/teacher) |
| 3 | `SYSTEM_ARCHITECTURE`, `DATABASE_DESIGN` (+ERD), `SYNC_STRATEGY`, ADRs | Technical review; Local-mode multi-PC decision |
| 4 | `SECURITY_PLAN`, `DESIGN_SYSTEM`, `IMPLEMENTATION_ROADMAP`, final `OPEN_DECISIONS`, consistency check | Final approval before any code |

After each batch run a **consistency check** (same rule stated differently in two documents; dangling IDs) and report the result.

Non-functional requirements (include in `PRD.md`, proposed numbers to be confirmed): typical association 50–2,000 students, 5–100 teachers, large multi-branch up to ~10,000 students; attendance for a 30-student group in under a minute on a phone; list search/filter under one second; all daily core operations work offline; RPO/RTO targets for cloud; minimum Windows spec (Windows 10/11, 4 GB RAM, 1366×768); WCAG AA; keyboard navigation.

Do not create unnecessary features just to look comprehensive. Do not write the whole application in one response.

---

## 11. DISCOVERY QUESTIONS (ask me before Batch 1; add your own up to 15–20)

Already known to matter:
1. Is there a pilot association? Size (students, teachers, branches)?
2. How do associations work today (paper, Excel, other software)?
3. How many Windows PCs work simultaneously inside one association?
4. Which riwaya (Warsh / Hafs / both) and which mushaf?
5. Arabic only, or Arabic + French?
6. Are there male/female groups, and does that affect permissions?
7. Will parents actually use phones and internet? Is SMS needed?
8. Team size, budget, and target timeline for release 1?
9. Existing Kotlin/Compose experience?
10. Where will servers be hosted? Any requirement to keep data in Algeria?
11. Who sells the product, and what is the expected license price model?
12. Is there an existing logo/brand identity?

---

## 12. CORRECTIONS AND REQUIRED COVERAGE (takes precedence)

The documents must explicitly cover the following (each as requirements, recommendations, or open decisions as appropriate):

1. **Local mode, multiple PCs:** options (single PC / local server or local PostgreSQL on a main machine / device-to-device sync), trade-offs, recommendation.
2. **Parent portal:** requires Cloud or Hybrid; state it in licensing/features.
3. **Hybrid mode:** keep out of release 1 unless justified; consider one-way cloud backup first.
4. **Sync-ready schema from day one** (Section 7).
5. **Quran dataset:** riwaya, counting system, mushaf, text source, license, integrity checks.
6. **Calendar and locale:** Hijri + Gregorian, Friday/Saturday weekend, optional prayer-relative scheduling, numerals policy, Arabic + French decision.
7. **Algerian legal context** (flag for professional legal review, do not assert compliance): the associations law (12-06) and the personal-data-protection law (18-07); minors' data; hosting location; consent; retention; data export/erasure.
8. **Child protection:** photo/document consent, contact-info exposure, supervised communication channels, gender-based group visibility (only if I confirm).
9. **Import/onboarding** (Excel/CSV) and **printing** are Must-level.
10. **Commercial:** code signing, auto-update, trial, license transfer, support diagnostics, realistic piracy stance, no hard dependency on online payment.
11. **Design:** brass contrast rule, separate Quran font, offline/sync/conflict UI states, HTML prototype approval before Compose.
12. **Traceability and decisions:** REQ/BR/OD/RISK IDs and ADRs; MoSCoW and a defined MVP.

---

## 13. EXECUTION STANDARD

Every feature must have: (1) business purpose, (2) user workflow, (3) permission requirements, (4) domain rules, (5) data model, (6) UI/UX specification, (7) test strategy, (8) error handling, (9) security considerations, (10) documentation.

Build a real commercial product, not a collection of disconnected screens. Ultimate goal: MISHKAT becomes a trusted, comprehensive, beautifully designed digital operating system for Quranic associations.

**Start now:** inspect the environment (Section 0.12), then ask me the discovery questions (Section 11). Wait for my answers before producing Batch 1.
