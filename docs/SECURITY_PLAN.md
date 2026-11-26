# SECURITY_PLAN.md

**Accountable role:** Security Engineer · **Status:** Batch 4 draft · **Date:** 2026-11-20

**Definition of Done:** assets and actors are named; a realistic threat model covers every component; each control has an ID, an owner module, and a test; unresolved choices are tied to open decisions with a recommended default; nothing claims "completely secure"; release gates are explicit.

**Honest framing:** these controls reduce risk; they do not eliminate it. The system holds **children's personal data** on a small-office PC and exposes a subset on the internet. The most probable real-world harms are **not** sophisticated attacks but: lost/unencrypted backups, shared passwords, an unattended logged-in PC, wrong data published, and data loss. The plan weights controls accordingly.

**Status legend:** **C** Confirmed (decided) · **R** Recommended default · **U** Unresolved (named OD) · **F** Future. Controls carry IDs `SEC-###`.

---

## 1. Assets

| Asset | Sensitivity | Where |
|---|---|---|
| Students' personal data (names, ages, guardians' phones), attendance, progress | **High** (minors) | Desktop DB; minimal projection on the portal |
| Documents and photos (if enabled) | High | Desktop file store only (never the portal in release 1) |
| Staff accounts and password hashes | High | Desktop DB |
| Guardian portal credentials | High | Portal DB |
| Audit log | Integrity-critical | Desktop DB |
| Backups | High (full copy of everything) | USB / folder / cloud |
| Recovery key, backup passphrase | **Critical** | Printed / user-held |
| License signing private key | **Critical** (commercial) | Vendor only |
| Code-signing key | **Critical** (supply chain) | Vendor only |
| Portal ingestion keys (device keys) | High | Desktop (protected store) + portal registry |

## 2. Actors and realistic threats

| Actor | Capability | Main concerns |
|---|---|---|
| **Curious or careless staff** | Legitimate login, shared PC | Viewing the other branch, shared passwords, leaving the PC unlocked, wrong exports |
| **Former staff / volunteer** | Remembered password, copied files | Residual access, copying a backup or database |
| **Someone with physical access to the PC** | Steals/borrows the PC or disk | Reading the database and documents |
| **Malware on the PC** | Runs as the Windows user | Reads DB, steals keys held for the same user, ransomware |
| **Internet attacker on the portal** | Scripted attacks | Credential stuffing, guessing invite codes, injection, scraping children's data, DoS |
| **A guardian** | Valid account | Seeing other children, enumerating ids |
| **Supply-chain attacker** | Compromised dependency/update | Malicious code in the installer or update |
| **Pirate** | Wants to bypass licensing | Cracking the license check |
| **Mistake / accident** | Anyone | Publishing wrong data, deleting a backup, restoring the wrong file |

**Out of scope for release 1:** nation-state adversaries, hardware attacks, defending against a malicious Director with full legitimate access (we provide accountability via audit, not prevention).

## 3. Threat model by component (STRIDE-oriented)

Rating = likelihood × impact for this deployment: **H / M / L**.

### 3.1 Desktop application

| ID | Threat | Rating | Controls | Test |
|---|---|---|---|---|
| T-D1 | Weak/shared passwords; brute force | H | SEC-010, SEC-011, SEC-012 | Lockout/backoff tests, hash parameter test |
| T-D2 | Unattended unlocked PC | H | SEC-013 (auto-lock), fast user switching | Idle-timeout UI test |
| T-D3 | Staff reads other branch / unauthorized records | H | SEC-020, SEC-021 | **Negative authorization tests on every matrix row** |
| T-D4 | Renderer compromise → full OS access (Electron) | M | SEC-030 – SEC-036 | Hardening checklist test, CSP test |
| T-D5 | Malicious or buggy file (import, document, update) | M | SEC-050 – SEC-053, SEC-070 | Fuzz/limit tests |
| T-D6 | Tampering with the audit log | M | SEC-060, SEC-061 | Chain verification test |
| T-D7 | Lost admin password locks everyone out | H (operational) | SEC-014 recovery design | Recovery drill |

### 3.2 Local data and backups

| ID | Threat | Rating | Controls | Test |
|---|---|---|---|---|
| T-B1 | Disk/PC theft exposes the database | M | SEC-040 – SEC-043 | Open-file test (encrypted file unreadable) |
| T-B2 | **Lost or stolen backup USB** | **H** | SEC-044 (backups always encrypted) | Backup unreadable without key |
| T-B3 | Ransomware encrypts DB and local backups | M | Off-machine backup copy recommended in wizard; SEC-045 | Restore drill from off-machine copy |
| T-B4 | Restoring the wrong/foreign/tampered backup | M | SEC-046 | Wrong-tenant and corrupted-backup tests |
| T-B5 | Key loss → permanent data loss | H | SEC-043 recovery key + acknowledgment | Recovery drill |

### 3.3 Update and supply chain

| ID | Threat | Rating | Controls | Test |
|---|---|---|---|---|
| T-S1 | Malicious update or dependency | M | SEC-070 – SEC-074 | Signature-verification test, CI audit |
| T-S2 | Unsigned installer triggers warnings/trains users to ignore them | H (trust) | SEC-071 | Release checklist |

### 3.4 Publishing channel and portal

| ID | Threat | Rating | Controls | Test |
|---|---|---|---|---|
| T-P1 | Forged or replayed ingestion requests | M | SEC-080 – SEC-083 (also SYNC §8) | Bad signature, replay, wrong-tenant tests |
| T-P2 | Cross-tenant / cross-guardian data access | **H** impact | SEC-090 – SEC-093 | RLS and guardian negative tests on real PostgreSQL |
| T-P3 | Invite-code guessing, credential stuffing | H | SEC-100 – SEC-104 | Rate-limit and entropy tests |
| T-P4 | XSS / injection through names or announcements | M | SEC-110 – SEC-113 | Output-encoding tests, CSP, DAST |
| T-P5 | Scraping or enumeration of children | M | Opaque ids, rate limits, minimal projection | Enumeration tests |
| T-P6 | **Publishing the wrong data** (consent not honored) | **H** (privacy) | SEC-120 – SEC-123 | Projection property tests, takedown test |
| T-P7 | DoS on the portal | M | CDN/rate limiting, stateless scaling | Load smoke test |
| T-P8 | Portal database leak | M | Minimal data, RLS, encrypted storage/backups, no documents | Data inventory review |

### 3.5 Licensing

| ID | Threat | Rating | Controls |
|---|---|---|---|
| T-L1 | Cracked or shared license | M (commercial only) | SEC-130 – SEC-133; accepted residual risk |
| T-L2 | License logic locks a legitimate user out of their own data | M (trust) | **BR-048/BR-049: licensing can never gate data access** |

## 4. Controls

### 4.1 Authentication (desktop)

| ID | Control | Status |
|---|---|---|
| SEC-010 | Passwords hashed with **Argon2id** (memory-hard), per-user salt, parameters tuned to ~250–500 ms on the target PC; parameters stored with the hash for future upgrade. **Verified 2026-11-20:** Electron's Node (BoringSSL) has **no `crypto.argon2`**, so the app uses the prebuilt N-API library `@node-rs/argon2` (win32-x64 binary, works inside Electron; same PHC string format). Parameters still to be tuned on the pilot PC | R |
| SEC-011 | Password policy: minimum length 10 (passphrases encouraged), **no composition rules**, block common/breached lists shipped offline, no forced periodic rotation | R |
| SEC-012 | **Backoff, not permanent lock:** after 5 failures delay increases (e.g. 30 s → 1 min → 5 min → 15 min); failures are audited as security events; no account enumeration (same message) | R |
| SEC-013 | **Auto-lock after idle** (default 10 min, configurable) and quick user switching; critical because one PC is shared (OD-028) | R |
| SEC-014 | **Recovery design (OD-014 default):** a recovery key (high-entropy, shown/printed once at setup, only a verifier is stored) + a mandatory second admin recommendation. Using the recovery key is a security event. **The vendor has no backdoor and cannot reset passwords.** | R |
| SEC-015 | Re-authentication (password again) before: export, restore, role/permission changes, license import, publish settings, archive/purge | R |
| SEC-016 | Optional **TOTP (works offline)** for the Director account | F/Should (OD-028) |

### 4.2 Authorization

| ID | Control | Status |
|---|---|---|
| SEC-020 | RBAC × branch scope, deny by default, enforced in the Application layer **and** in scoped repositories (ADR-006, BR-014) | C |
| SEC-021 | Every row of the permission matrix has a positive and a **negative** test; cross-branch reads return *not found* | C |
| SEC-022 | Permission changes take effect on the next action; no long-lived caches; changes are audited | R |
| SEC-023 | No UI-only checks; the desktop shell exposes only allow-listed, schema-validated IPC commands (see SEC-033) | R |

### 4.3 Desktop shell hardening (Electron-class; `VERIFY` against the current official Electron security checklist during the spike)

| ID | Control |
|---|---|
| SEC-030 | `contextIsolation` on, `nodeIntegration` off, renderer **sandboxed**; no `remote` module |
| SEC-031 | Load **only local packaged content**; no remote URLs in the app window; block unexpected navigation and new windows; deny all permission requests by default |
| SEC-032 | Strict **Content-Security-Policy** (no inline script, no `eval`, no remote origins); no dynamic code loading |
| SEC-033 | **IPC allow-list:** a fixed set of commands, each with a runtime schema; the main process re-checks authorization and never trusts renderer-supplied identity or paths |
| SEC-034 | No shell execution from user-influenced data; file paths constrained to the app data directory |
| SEC-035 | Debug/devtools and unsigned-code flags disabled in release builds; fuses/hardening flags set at packaging |
| SEC-036 | Native modules minimized, pinned, rebuilt in CI; dependency count kept low |

### 4.4 Data at rest and key management (OD-019)

| Option | Pros | Cons |
|---|---|---|
| **A. OS encryption only** (device encryption/BitLocker where the Windows edition and hardware allow — `VERIFY` on the pilot PC) | No app complexity | Not under our control; may be unavailable; protects only when the PC is off/stolen |
| **B. Application-level database encryption** (SQLCipher-class), key wrapped by the Windows user store (DPAPI-class) **plus** a recovery key | Protects copies of the DB file moved elsewhere | Does not stop malware running as the same user; native-module/packaging cost; must handle key recovery |
| **C. B + password-derived key** (user must enter a password at start) | Strongest against theft | Usability cost; lose the password and the key → data loss without recovery key |

**Recommended default (R):** **B** for the pilot, with the recovery key mandatory, and the setup wizard **recommending** OS encryption in addition. **C** can be offered later as an option. Documents are stored in an encrypted file store using the same key hierarchy.

| ID | Control | Status |
|---|---|---|
| SEC-040 | Data-encryption key (DEK) generated at setup; database/documents encrypted with it | R (OD-019) |
| SEC-041 | DEK wrapped by an OS-protected key; **second wrapping with the recovery key** | R. **Implemented so far (2026-11-20):** the *recovery key* is stored protected by Windows DPAPI through Electron `safeStorage` so scheduled backups can run unattended; verified on the real app. Limits: anyone signed in to that Windows account can use it; the database itself is not yet encrypted (OD-019); Electron 45 marks the synchronous `safeStorage` calls deprecated — move to the async API before upgrading Electron (VERIFY) |
| SEC-042 | Keys never logged, never in config files, never in the repository | C |
| SEC-043 | **Setup cannot finish** until the user confirms they stored the recovery key; a periodic reminder verifies the key *exists* (without displaying it) | R |
| SEC-044 | **Backups are always encrypted** (AES-256-GCM or equivalent authenticated encryption), each with integrity tag, keyed from the recovery material or an explicit backup passphrase; plain-text backups are not an option | R |
| SEC-045 | Wizard strongly recommends an **off-machine copy** (second location) to survive ransomware/disk failure | R |
| SEC-046 | **Restore validation:** the backup must belong to this tenant (tenant id + signature), pass integrity verification, and the current state is backed up first (BR-044) | R |

### 4.5 Files, imports, exports, printing

| ID | Control |
|---|---|
| SEC-050 | Document uploads: allow-list by **content sniffing** (not extension), size limits, stored in the app data directory under generated names, hash recorded, never executed or opened by a shell handler without confirmation |
| SEC-051 | Import (xlsx/csv): size and row limits, ZIP-bomb protection, macros never executed (xlsx only), strict parsing in a worker with timeouts |
| SEC-052 | **Spreadsheet formula injection:** exported cells beginning with `=`, `+`, `-`, `@` are neutralized |
| SEC-053 | Printable/PDF generation uses templates with **escaped** data; no user-controlled HTML reaches the print renderer unescaped |

### 4.6 Audit and logging

| ID | Control |
|---|---|
| SEC-060 | Audit log append-only with hash chain (ADR-007, BR-047); verification at start and on demand; the audit viewer is Director-only and its use is audited |
| SEC-061 | Security events recorded: failed logins/lockouts, recovery-key use, role changes, exports, restores, publish/unpublish, license import, device-key registration |
| SEC-062 | Application logs contain **no personal data** (ids only) and no secrets; rotated; diagnostics bundle excludes data (REQ-086) |

### 4.7 Updates and supply chain

| ID | Control |
|---|---|
| SEC-070 | Updates are **signed** and the signature is verified by the app independently of transport security |
| SEC-071 | Windows installer **code-signed** (certificate or Store path — ADR-014, spike S4); unsigned installers are not distributed to associations |
| SEC-072 | Dependencies pinned with lockfile; automated vulnerability audit in CI; no `postinstall` scripts from unreviewed packages; SBOM generated per release |
| SEC-073 | Signing keys held outside the repository (hardware token or cloud key service); repository and CI accounts use two-factor authentication; branch protection |
| SEC-074 | Automatic **rollback** to the previous version and DB copy if an update fails (BR-043) |

### 4.8 Publishing channel (see `SYNC_STRATEGY.md` §8)

| ID | Control |
|---|---|
| SEC-080 | TLS only with certificate validation |
| SEC-081 | Device key pair; every request signed over method, path, body hash, timestamp, nonce |
| SEC-082 | Replay defense: nonce + validity window + `(epoch, seq)` monotonicity |
| SEC-083 | Registration by one-time token; device keys revocable; full resync after re-registration |

### 4.9 Portal

| ID | Control | Status |
|---|---|---|
| SEC-090 | Row-level security enforced and forced on every tenant table; the application database role cannot bypass it | C |
| SEC-091 | Guardian scoping (BR-040) enforced server-side on every read; opaque identifiers; "not found" for out-of-scope ids | C |
| SEC-092 | Portal database and backups encrypted at rest by the provider; least-privilege roles; no shared admin accounts; admin access audited | R |
| SEC-093 | Secrets in the platform's secret store, never in source; separate staging and production | R |
| SEC-100 | **Invite codes:** ≥ 128 bits of entropy (shown as a QR/long code) or a shorter code only with strict attempt limits; single use; expire (default 7 days); stored hashed | R |
| SEC-101 | Guardian passwords hashed with Argon2id; same password policy as SEC-011 | R |
| SEC-102 | Rate limiting and progressive delay on login, redemption, and reset (per account, per IP, per tenant); uniform error messages | R |
| SEC-103 | Password reset is **association-mediated** (OD-015): the portal alone cannot reset identity without proof from the association | R |
| SEC-104 | Sessions: random opaque tokens in `HttpOnly`, `Secure`, `SameSite` cookies; short idle timeout; rotation on login; revocation when the association revokes access | R |
| SEC-110 | Strict CSP, no inline scripts; output encoding by default; framework escaping | R |
| SEC-111 | CSRF protection for state-changing requests (release 1 has very few); security headers (HSTS, `X-Content-Type-Options`, frame denial, referrer policy) | R |
| SEC-112 | No personal data in URLs, logs, analytics; **no third-party trackers** | C |
| SEC-113 | Strict schema validation of every input; parameterized queries only | C |

### 4.10 Privacy and publishing safeguards

| ID | Control | Status |
|---|---|---|
| SEC-120 | Only children whose guardian has `portal_consent` are projected; **projection property tests** prove no forbidden field can appear (BR-042) | C |
| SEC-121 | **First-publish preview:** the Director sees exactly what will leave the machine before the first run and when the policy changes | R |
| SEC-122 | **Priority takedown:** consent withdrawal, archive, or revoke removes data from the portal at the next (immediate) run; UI shows "removal pending" until acknowledged | R |
| SEC-123 | Real children's data is **never used in development or tests**; synthetic data generator only | C |

### 4.11 Licensing

| ID | Control | Status |
|---|---|---|
| SEC-130 | License file is **signed** with an offline vendor private key; the app embeds the public key; unsigned/altered files are rejected | R (ADR-011) |
| SEC-131 | License content: association id, entitlements, issue date, update/support end date, device limit hint; **no personal data** | R |
| SEC-132 | Validation failures degrade **entitlements only** (e.g. no updates, no portal), never data access (BR-048/049) | C |
| SEC-133 | Honest residual risk: a determined pirate can bypass client-side checks; defenses are signed files, soft device binding (OD-018), and the vendor's control of the optional hosted portal/updates | C |

## 5. Security-relevant business rules (cross-reference)

BR-010 tenant isolation · BR-013 sensitive operations audited · BR-014 branch scope · BR-019 archive not delete · BR-022 minimum data · BR-039–042 one-way publishing and minimal projection · BR-043/044 backup before risk, safe restore · BR-045 safe import · BR-047 append-only audit · BR-048/049 licensing never blocks data.

## 6. Security testing plan

| Test | When | Tooling (examples; `VERIFY` at implementation) |
|---|---|---|
| Authorization matrix incl. negative branch/tenant/guardian tests | Every build (CI) | Automated tests |
| RLS and cross-tenant tests on real PostgreSQL | Every build | Automated tests |
| Password hashing, lockout/backoff, recovery-key flow | Every build | Automated tests |
| Projection/privacy property tests | Every build | Property-based tests |
| Import/export fuzzing and limits; formula-injection tests | Per release | Fuzzing harness |
| Backup: encrypted, tamper detection, wrong-tenant restore, restore drill | Per release | Scripted drill |
| Static analysis, secret scanning, dependency audit, SBOM | Every build | CI scanners |
| Electron/desktop-shell hardening checklist review | Per release | Checklist + automated config test |
| Dynamic scan of the portal (baseline) | Per release | OWASP-style baseline scan |
| **Independent penetration test of the portal** | **Before any public portal launch** | External tester (budget needed) |
| Threat-model review | Every release and on new features | Workshop + this document |

### Release gates (security)

1. **Gate S1 (pilot, desktop-only):** SEC-010–016, 020–023, 030–036, 040–046, 050–053, 060–062, 070–074 implemented and tested; restore drill done on the pilot PC.
2. **Gate S2 (portal for real guardians):** SEC-080–083, 090–093, 100–113, 120–123 implemented and tested; **legal review (OD-012) completed**; penetration test findings (high/critical) resolved; incident-response contacts defined.
3. **Gate S3 (commercial release):** SEC-130–133 implemented; vulnerability-disclosure contact published; support access policy (below) written.

## 7. Incident response and support policy (outline)

- **Vendor support has no standing access to association data.** Diagnostics bundle contains no student data (REQ-086). Remote help sessions require the Director's explicit presence and consent.
- **Incident playbook:** detect → contain (revoke device key, disable portal tenant, force password resets) → assess what data was involved → notify the association → follow legal notification duties (OD-012) → fix and document → add a regression test.
- **Vulnerability reports:** a contact address and a short disclosure policy published before commercial release.
- **Data subject requests** (access/correction/erasure): supported through documented Director procedures (export, correction records, audited purge), aligned with the legal review.

## 8. Unresolved items

| ID | Item | Default used above |
|---|---|---|
| OD-012 | Legal review and notification duties | Minimize data; no public portal before review |
| OD-014 | Admin recovery | Recovery key + second admin |
| OD-015 | Guardian credential delivery/verification | In-person one-time code, association-mediated reset |
| OD-019 | Encryption at rest and backup key policy | Option B + mandatory recovery key; encrypted backups always |
| OD-028 | Idle auto-lock duration, MFA for Director (new) | 10 min; TOTP optional later |
| OD-018 | Device binding/limits in the license | Soft binding, to be defined |

---

**Cross-role review (Product Manager):** the controls that users will *feel* are auto-lock, the recovery key ceremony, backup passphrase handling, and invite-code delivery. Each needs a short, humane Arabic flow (design system Batch 4) and pilot validation; security that users bypass is not security.

**Dependency note (2026-11-20):** `npm audit` reports a moderate advisory in `uuid` (< 11.1.1, missing bounds check when a caller supplies an output buffer) pulled in by `exceljs`. Our code never passes a buffer to it, so it is not exploitable here; revisit when `exceljs` updates. Spreadsheet input is untrusted: size, row and column limits apply and formulas are never evaluated (only cached results are read); exports write user text as text, never as formulas.

**Finance access (2026-11-20, OD-036 option A):** the finance section is protected by its own password (Argon2id hash in `finance_access`), enforced in the Electron main process: every finance IPC channel requires the signed-in Director AND an unlocked section; the section relocks after 10 idle minutes and on sign-out; wrong passwords back off (5 free tries, then 30 s, 1 min, 5 min, 15 min); reset is possible only with the recovery key and is audited. Known limit while the login is shared: the audit log cannot name *which person* recorded a payment, so each payment stores a typed collector name; personal accounts (OD-030) remove this limit. Payments are append-only at the database level (no edit, no delete; one audited cancellation with a reason).

**Upgrade safety (BR-043):** the app now takes a verified, encrypted backup before applying any pending schema migration to an existing installation, and refuses to migrate (leaving the data untouched) if that backup cannot be made.

**Restore and settings (2026-11-20):** restoring a backup requires re-authentication with the login password (same slow-down as sign-in, SEC-015), a typed confirmation word, takes a safety copy of the current state first (BR-044), and restarts the app on the restored data; if it breaks midway the app restarts instead of continuing on a half-swapped database. Lesson recorded: this step passed all unit tests but failed in the **bundled** app (the migrations folder was resolved from `import.meta.url`, unavailable in the bundle) and was found only by the end-to-end run of the built app; bundled-app smoke tests are therefore part of the release checks. Automatic backup: taken at sign-in when the last verified backup is older than 20 hours.
