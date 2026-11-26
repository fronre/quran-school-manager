# PRODUCT_VISION.md

**Accountable role:** Product Manager · **Status:** Batch 1 draft · **Date:** 2026-11-20

**Definition of Done:** states who MISHKAT is for, the problem, the release-1 promise, what it deliberately is not, and how success is measured; every claim is tagged Confirmed / Recommended / Unresolved / Future.

---

## 1. One-sentence vision

MISHKAT (مِشكاة) is the daily operating system of a Quranic association: one reliable place to register students, organize groups and teachers, record attendance and memorization, and keep guardians informed.

## 2. Problem

Quranic associations run on paper registers, scattered spreadsheets, and memory. Consequences (to be validated in pilot interviews, see OD-006):

- Attendance and progress records are lost, inconsistent, or hard to summarize.
- Directors cannot answer simple questions quickly (how many students per group, who has been absent three times, who finished which portion).
- Guardians learn about problems late.
- Two branches (men / women) need separate organization under one administration.

## 3. Users and context

| Item | Value | Status |
|---|---|---|
| First market | Algeria | Confirmed |
| Pilot association | 200+ students, two branches (men's and women's), **one computer** in the association | Confirmed |
| Guardians with phones | ~90% | Confirmed |
| Primary goal | Management and organization (*tasyir wa tanzim*) | Confirmed |
| Qur'anic text fidelity (riwaya, mushaf details) | Not a priority for the pilot | Confirmed |
| Commercial model | First association free; then sold under license | Confirmed (terms: OD-001, OD-018) |
| Branding | Delegated to the product team (logo + identity) | Confirmed |

## 4. Release-1 promise

> "A director can run the whole association from one Windows computer, even without internet, and guardians can follow their children from their phones."

Release 1 consists of:

1. **MISHKAT Desktop (Windows)** — the system of record. Works offline. Administration, students, groups, teachers, attendance, memorization tracking, reports, backups.
2. **MISHKAT Web Portal (mobile-first, Arabic RTL)** — guardian-facing, read-only in release 1, fed by one-way publication from the desktop.

## 5. Decisions shaping the product

### Confirmed
- C-1: Desktop (Windows) + web in release 1.
- C-2: Scope favors management and organization over Qur'anic-text depth.

### Recommended (pending your explicit approval unless marked approved)
- R-1 (**approved in chat 2026-11-20**): No native Android app in release 1; the web portal serves phones.
- R-2 (**approved in chat 2026-11-20**): Desktop is the system of record; synchronization to the cloud is **one-way (desktop → cloud)** in release 1.
- R-3: Arabic-only interface in release 1 (OD-004).
- R-4: Memorization tracking stays simple: surah + ayah range + activity type + evaluation (no hizb/thumn depth unless requested).
- R-5: Branch-scoped visibility by default (OD-003).

### Unresolved
See `OPEN_DECISIONS.md` (OD-001 … OD-027; defaults approved 2026-11-20 are listed in its section F).

### Future (explicitly not release 1)
Two-way sync (teachers writing from phones), Hybrid multi-device operation, native Android app, SMS/messaging integrations, finance module (pending OD-009), multi-association cloud hosting at scale, multi-language (French), certificates/ijazah.

## 6. Principles

1. **Everything important in one coherent system**, no feature without a workflow.
2. **Arabic-first, RTL-first**, readable at a glance.
3. **Accurate, auditable records**: corrections are recorded, never silent.
4. **Works without internet.** The association's data lives with the association.
5. **Privacy by default**: children's data, branch separation, least privilege.
6. **Honest scope**: nothing is promised that is not in the PRD.

## 7. What MISHKAT is not (release 1)

- Not a Qur'an reading/learning app.
- Not a payments processor or accounting system.
- Not a social or chat platform.
- Not a general school information system.

## 8. Success measures (proposed; confirm in pilot)

| Measure | Target |
|---|---|
| Time to record attendance for a 30-student group | under 60 seconds |
| Time to set up the pilot association (wizard + import) | under 1 working day |
| Pilot association uses the system for daily attendance | 4 consecutive weeks |
| Guardians who open the portal at least monthly | to be defined with the pilot |
| Data loss incidents | zero; restore tested |

## 7b. Risks (top 5)

| ID | Risk | Mitigation |
|---|---|---|
| RISK-001 | Scope creep from the large original brief | MoSCoW + defined MVP |
| RISK-002 | Pilot users resist moving from paper | Import wizard, printable sheets, short training |
| RISK-003 | Single-PC data loss | Automatic local backups + export to USB/cloud |
| RISK-004 | Children's data privacy / legal exposure | Legal review (OD-012), branch scoping, minimal data |
| RISK-005 | Two UI stacks (desktop + web) double the work | Decide stack by ADR in Batch 3 (OD-011) |

---

**Cross-role review (Security Engineer):** The portal exposes children's data to the internet. Before any release: threat model, per-guardian scoping tests, and a legal review. Not optional.
