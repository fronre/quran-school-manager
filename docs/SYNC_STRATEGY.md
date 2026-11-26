# SYNC_STRATEGY.md

**Accountable role:** Software Architect + Backend Engineer · **Status:** Batch 3 draft · **Date:** 2026-11-20

**Definition of Done:** data ownership and authority are explicit for every data class; the release-1 protocol (one-way publish) is specified end to end including identity, ordering, idempotence, retries, offline behavior, restore, and security; the conflict policy is stated (including *why none is needed* in release 1); the release-2 extension (teacher entries from phones) is designed so that it never creates two authorities; test strategy is defined.

**Status legend:** **C** Confirmed (approved by you) · **R** Recommended · **F** Future · **U** Unresolved (named OD).

---

## 1. Principles

1. **One authority per data class.** Two independent systems must never be allowed to overwrite each other's data (original brief, §3.D).
2. **The desktop is the authority for all association data** (ADR-001, C).
3. **Publishing is state-based and idempotent**: re-sending the same state is harmless; the portal can always be rebuilt from the desktop.
4. **Offline is the normal case**, not an error. Nothing in daily work waits for the network.
5. **Minimum data crosses the boundary** (BR-042).
6. **The portal never changes association data** in release 1 (BR-039).

## 2. Data ownership matrix

| Data class | Authority | Direction | Notes |
|---|---|---|---|
| Association, branches, years, groups, sessions, schedule | Desktop | Desktop → Portal (projection) | Labels only where possible |
| Students, guardians, enrollments | Desktop | Desktop → Portal (minimal) | Only children with a guardian who gave `portal_consent` |
| Attendance, memorization records, evaluations | Desktop | Desktop → Portal (projection/summaries) | Shareable comments only |
| Announcements | Desktop | Desktop → Portal | Withdrawals propagate as tombstones |
| Staff accounts, passwords, roles, audit log, documents, policies, backups, license | Desktop | **Never leaves the machine** | Not in the portal at all |
| **Guardian portal credentials** (login id, password hash, reset state) | **Portal** | Portal-only | A second authority, but over a **disjoint** data class; the desktop never sees passwords |
| Invite state (invited / redeemed / revoked, last login) | Portal (facts) | Portal → Desktop, **advisory** | Shown to staff; never alters domain data |
| Teacher submissions from phones | *Desktop decides; portal only stores proposals* | Portal → Desktop (**release 2**) | See §9 |

## 3. Release-1 protocol: one-way publish

### 3.1 Identity and ordering

- Each installation has a **tenant id** (= association id) and a **device key pair** created at registration (WF-11 setup). The public key is registered with the portal.
- Publishing uses an **epoch** and a **sequence**:
  - `epoch`: integer, starts at 1, **incremented after every restore from backup** (see §6) and on explicit full resync.
  - `seq`: strictly increasing integer inside an epoch, assigned by the desktop per publish run.
- Ordering is by `(epoch, seq)` — **never by wall-clock time** (clock skew proof).
- Each published item is the **whole current state of one record** (not a patch): `{entity_type, entity_id, content_hash, state | tombstone}`. The portal applies an item only if its `(epoch, seq)` is higher than what it holds for that record; therefore replays, reordering, and duplicates are harmless.

### 3.2 Change detection (no heavy machinery)

1. A **projection** function builds, from the authoritative tables, the exact set of items that the portal should hold (minimal fields, consenting guardians only, shareable comments only).
2. Each item gets a **content hash**. `publication_state` stores the hash last acknowledged by the portal.
3. **Diff**: new hash ≠ acknowledged hash → upsert; item no longer in the projection (archived child, withdrawn announcement, consent withdrawn) → **tombstone**.
4. A publish run sends the diff in **batches** (e.g. a few hundred items), each batch carrying `(tenant, epoch, seq, batch_no, idempotency_key)`.
5. After the portal acknowledges a batch, the desktop updates `publication_state` for those items **in one transaction**. A crash between send and acknowledgement just causes a harmless re-send.

No distributed queue is needed (ADR-015). Volumes are tiny: a typical daily diff is tens of items.

### 3.3 When to publish

| Trigger | Behavior |
|---|---|
| Manual "Publish now" (Director) | Immediate run |
| Scheduled (default: end of day, and after attendance confirmation) | Runs when internet is available; skipped silently when not |
| After consent withdrawal / archive / withdraw student (**privacy-critical**) | Run immediately with high priority; the UI shows "removal pending" until acknowledged |

### 3.4 Retry and offline behavior

| Situation | Behavior |
|---|---|
| No internet | Run is not started; banner shows "N changes not yet published" and last successful publish time |
| Network error mid-run | Resume from the first unacknowledged batch; exponential backoff (e.g. 1 min → 2 → 4 … max 1 h), with jitter; stops after a threshold and waits for the next trigger or manual action |
| Portal returns 5xx | Same as network error |
| Portal returns 4xx (validation/auth) | **Do not retry blindly**: show a clear error to the Director (e.g. "device not authorized", "tenant suspended", "payload rejected: field X"); log it in `publication_run` |
| App closed during a run | Next start resumes; idempotent |
| Long outage (weeks) | The next run simply sends the accumulated diff; if too large, falls back to full resync (§7) |

Daily work **never blocks** on publishing (BR from the failure-mode table).

### 3.5 Portal-side ingestion

1. Authenticate the request (§8).
2. Verify `tenant` matches the device registration; set the PostgreSQL session variable for RLS.
3. Apply items **transactionally per batch**: upsert where `(epoch, seq)` is newer; tombstones delete (or hide) the projected row.
4. Record `p_receipt(epoch, seq)` and return the acknowledged range.
5. Never create or modify any record that is not an item of the projection; reject unknown entity types.

### 3.6 Conflict policy (release 1)

**There are no conflicts in release 1 by construction:** the portal cannot write association data, the desktop is the only author of every projected record, and the only portal-owned data (credentials) is disjoint. The apparent edge cases are handled by rule, not by merge logic:

| Edge case | Rule |
|---|---|
| Desktop and portal disagree about a child's attendance | The portal is wrong or stale; the desktop wins; next publish overwrites |
| Same guardian linked to two children, one archived | The archived child's items are tombstoned; the other remains |
| Two publish runs overlap (double click) | A run lock on the desktop prevents it; if it happened, `(epoch, seq)` ordering makes the later run win |
| Desktop clock wrong | Irrelevant for ordering; the UI warns on large clock jumps (domain data may still carry wrong *dates* — that is a data-entry issue, not a sync issue) |
| Invite redeemed on the portal while the desktop is offline | The portal keeps the fact; the desktop learns it later through the advisory status feed |

## 4. Account-status feed (portal → desktop, advisory)

- The desktop **polls** (or fetches on startup and before each publish) `GET /tenants/{id}/account-status?since={cursor}`.
- Returns facts only: `{guardian_id, state, last_login_at}`. The desktop stores them in `portal_account_status` for display.
- It can **never** change students, enrollments, attendance, or progress, and nothing in it is trusted to authorize actions on the desktop.

## 5. Guardian account lifecycle across the boundary

1. Staff creates a **one-time invite** (WF-12): the desktop generates a random code and stores only its **hash**; the code is shown/printed once.
2. The invite hash and guardian link are published (an item type).
3. The guardian redeems the code on the portal, sets a password (portal-owned credential).
4. Staff **revoke**: the desktop marks the invite/consent revoked and publishes the tombstone; the portal disables the account and removes the child links immediately upon receipt.
5. If the guardian's consent is withdrawn on the desktop, the children vanish from the portal at the next (priority) publish.

## 6. Backup/restore and the epoch rule (the dangerous case)

**Problem:** the desktop restores an older backup. Its `seq` counter goes back, but the portal holds newer data; a naive protocol would be ignored or corrupt state.

**Rule:** every restore (and every reinstall that loads a backup) **increments `epoch`** and triggers a **full resync**. The portal treats a higher epoch as a new authoritative baseline for the tenant: it replaces all projected rows of older epochs (rows not present in the new baseline are removed). The desktop records the restore in `backup_log` and the audit log.

Consequence to communicate to staff: after a restore, guardians may briefly see older data until the full resync completes, and anything recorded after the backup time is **gone from both sides** (it was never in the restored authoritative data).

## 7. Full resync

- Triggers: first publish, restore (epoch bump), portal reports it lost data, protocol version change, diff larger than a threshold, manual "Rebuild portal data".
- Procedure: bump `seq` inside the current epoch (or new epoch), send **all** projected items; at the end send a **commit marker**; the portal deletes projected rows of this tenant that were not part of the run (mark-and-sweep). During the run the portal keeps serving the old data (no half-empty states).

## 8. Security of the channel

| Concern | Measure |
|---|---|
| Transport | TLS only; certificate validation; no plaintext fallback |
| Authenticating the installation | Device key pair; each request signed (e.g. public-key signature over method, path, body hash, timestamp, nonce); portal verifies against the registered public key |
| Replay | Nonce + short validity window + `(epoch, seq)` monotonicity |
| Tenant isolation | Tenant id bound to the device registration; RLS on every query |
| Payload | Minimal projection only; size limits; strict schema validation on the portal |
| Registration | One-time registration token issued by the vendor/operator (offline license flow), not guessable; revocable |
| Rate limiting | Per device and per IP on ingestion; per account/IP on guardian login and invite redemption |
| Privacy | Priority takedown (§3.3); unpublish tool (BR-041); no personal data in logs |
| Key loss/theft | Revoke the device key at the portal; re-register with a new token; full resync |

Details (key storage, algorithm choices) belong to `SECURITY_PLAN.md` (Batch 4).

## 9. Release 2 design (Future): teacher entries from phones — still one authority

Goal: let teachers record attendance/progress from their phones (OD-002 option b) **without** two-way data merging.

- The portal gets a **command inbox**. A teacher's phone sends **commands** such as `RecordAttendance(session_id, entries…)` with a client-generated command id (idempotent), the **base version** of the session as last published, and the teacher's identity.
- The desktop **pulls** commands, **validates them with the same domain rules** (BR-011, BR-028, BR-029 …) and either **applies** (creating normal records, audited as "via portal by teacher X") or **rejects** with a reason.
- The outcome is published back: the teacher sees *pending / accepted / rejected (reason)*.
- Because only the desktop mutates domain state, there is still **no merge and no conflict resolution** — only accept/reject. Stale commands (session already confirmed or corrected) are rejected with a clear message.
- Needs: teacher accounts (portal-owned credentials), scoped permissions (teacher sees only assigned groups), offline queue on the phone (PWA), and a decision on what happens when the desktop PC is off for days (commands wait; the portal shows "waiting for the association").

Hybrid multi-PC operation remains out of scope (REQ-092/095 Future).

## 10. Observability (for support, without data)

- `publication_run` stores counts, durations, status, and error codes (no personal data).
- Home screen shows: last successful publish, pending changes count, last error in plain Arabic.
- Diagnostics bundle (REQ-086) includes publish history without payloads.

## 11. Test strategy

| Test | What it proves |
|---|---|
| Projection tests | Only consenting guardians' children, only shareable comments, no forbidden fields (property tests over random data) |
| Diff tests | Unchanged state sends nothing; changes send one item; deletions send tombstones |
| Idempotence/ordering | Same batch twice, batches out of order, duplicated runs → identical portal state |
| Crash tests | Kill the process between send and ack at every step → eventually consistent, no loss/duplication |
| Epoch/restore test | Restore old backup → epoch bump → full resync → portal equals desktop; stale newer rows removed |
| Retry/backoff | Simulated 5xx/timeouts/4xx behave as specified |
| Security tests | Bad signature, replayed request, wrong tenant, oversize payload → rejected |
| Tenant isolation on the portal | Cross-tenant and cross-guardian negative tests with a real PostgreSQL (RLS) |
| Privacy takedown | Consent withdrawal removes data from the portal within the stated time |
| Soak test | 2,000 students, 3 years of data, repeated full resyncs within time budget |

## 12. Open items

| ID | Item |
|---|---|
| OD-005 | Portal hosting/region, display-name policy |
| OD-012 | Legal review of what may be published and where it may be stored |
| OD-015 | Guardian credential delivery and verification |
| OD-016 | Notification channel (web push vs none) — affects whether the portal needs a push subscription store |
| OD-002 | Release 2 teacher entries |

---

**Cross-role review (QA Automation Engineer):** The two scenarios that most often break real systems are **crash between send and acknowledge** and **restore of an old backup**. Both have dedicated tests above; neither may be removed to make the suite faster.
