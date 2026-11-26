# Spike report S1–S4 (Phase 0)

**Date:** 2026-11-20 · **Machine:** developer PC (Windows 11), NOT the pilot PC · **Code:** `spike/` (throwaway, not product code)
**Versions actually used:** Electron 45.4.1 (Chromium 156, Node 24.22.3), better-sqlite3 13.2.0, electron-builder 26.18.0.

## Definition of Done
Each criterion from SYSTEM_ARCHITECTURE §3.4 is marked Pass / Partial / Not tested, with what was and was not measured.

## Results

| ID | Criterion | Result | Evidence and limits |
|---|---|---|---|
| S1 | Arabic + tashkeel + Latin + digits in a 2,000-row table | **Partial pass** | Screenshot `spike/out/s1.png` reviewed by eye: RTL order, tashkeel, mixed "Benali", and LTR-isolated verse ranges (e.g. `10:3–7`) render correctly. Page loaded in 340 ms. **Not measured:** scroll smoothness, IBM Plex Sans Arabic (system font Segoe UI was used), the pilot PC. |
| S2 | SQLite WAL + online backup + verified restore, offline | **Pass (dev PC)** | `journal_mode=wal`, STRICT table, 2,000 rows inserted; `db.backup()` then restore: 2,000 rows, `integrity_check = ok`, Arabic text intact. **Not tested:** backup while a writer is active, power loss, large DB, encryption at rest (SEC option B), pilot PC. |
| S3 | Arabic PDF of an attendance sheet | **Partial pass** | `printToPDF` produced `spike/out/s3.pdf`: 61 A4 pages, 293 KB, 388 ms. **Not done:** visual check of the PDF pages (only the HTML screenshot was reviewed), real printer on the pilot PC, page-break quality, header/footer. |
| S4 | Installer size, update path, signing | **Partial pass** | Unsigned NSIS installer = **130,118,475 bytes (≈124 MiB)**, under the proposed 200 MB limit; unpacked app ≈385 MB. **Not tested:** installing and running the packaged app, silent update, signing (no certificate; options still to be priced), antivirus/SmartScreen behaviour. |

## Findings that change the plan
1. **RISK-007 confirmed in practice.** electron-builder tries to rebuild `better-sqlite3` from source and fails without Visual Studio Build Tools (also the project path contains a space, which node-gyp warns about). Working fallback: use the prebuilt `win32-x64` binary (`npmRebuild: false`). Decision for Phase 0 CI: build on a Windows runner, pin versions, keep `npmRebuild: false`, and verify the packaged app opens a database. Do not require Build Tools on the pilot PC.
2. **Package hygiene.** The package contains prebuilds for macOS/Linux (unused); trim in the build config. Pin the exact Electron and SQLite-binding versions (VERIFY on each upgrade).
3. **Installer size is not a blocker for Electron.** Tauri's size advantage is therefore not decisive for this pilot; the shell stays Electron unless a later criterion fails.

## Update 2 — follow-up tests (same day, still developer PC)
| Test | Result |
|---|---|
| S2b backup while a writer is active, then SIGKILL of the writer | **Pass.** Backup taken during writes: `integrity_check = ok`. After kill: `ok`, no committed row lost (`synchronous=FULL`). Short run (~2 s); not a power-loss test. |
| S3b PDF with IBM Plex Sans Arabic embedded | **Pass visually** (screenshot of the PDF viewer reviewed): RTL table, tashkeel, repeated header row on each page, page numbers "n / total", 120 rows = 4 A4 pages. |
| Bug found in S3b | The date in the title rendered **reversed** (`22-11-2026`) until wrapped in `<bdi dir="ltr">`. Rule confirmed: every date/number in print templates must be LTR-isolated (matches DESIGN_SYSTEM). Add a print-template test. |
| Font loading | Font URLs must be URL-encoded (the user's folder has a space). Bundle fonts inside the app and load them by relative URL. |
| Packaged app run (unsigned build, `dist/win-unpacked`) | **Opens SQLite correctly** (WAL, backup, restore, 2,000 rows, `integrity ok`) and produces the PDF — **but only with `--disable-gpu`**. With default settings the packaged app hung in all 3 runs on this PC (log: GPU process exit 143, network-service restart; the hung step was the hidden-window screenshot/print stage). The same code run through `electron .` did not hang. **Cause not established.** |
| S4 silent update | **Not tested** (requires installing the app on this PC; waiting for your OK). |

### GPU hang investigation (Update 3)
Method: packaged unsigned build, stage log, 25–40 s timeout, A/B with `app.disableHardwareAcceleration()` (env switch in the spike).
| Mode | Completed |
|---|---|
| GPU default | **0 of 5** in the final batch (earlier runs: 0 of 3, 1 of 2) — mostly hangs |
| `disableHardwareAcceleration()` | **5 of 5** (earlier: 2 of 2) |

Where it hangs: the stage log stops at `capture start`, i.e. `capturePage()` of a **hidden** (`show:false`) window while the GPU process is failing. Not established: why the GPU process fails on this PC (driver/virtualisation unknown), and whether a **visible** window also hangs (the product shows its windows; the spike's hidden-window screenshot is unusual). Conclusion is therefore limited: with GPU off the packaged app is stable here; with GPU on it is not for this particular step.
**Decision (approved by the user 2026-11-20; recorded as an ADR-003 addendum in SYSTEM_ARCHITECTURE §3.4):** the desktop app disables hardware acceleration by default (the UI is tables and forms), and Phase 0 adds a visible-window smoke test of the packaged build on the pilot PC.

### New risk
**RISK-012 (proposed):** Chromium GPU-process failures on older or unusual Windows hardware can hang the app. Pilot PC is unknown. Mitigations to evaluate in Phase 0: call `app.disableHardwareAcceleration()` (a table UI does not need the GPU), add a watchdog and a visible error, and make the first-run check part of the installer smoke test on the pilot PC.

## Outcome against the gate
- No criterion failed. ADR-003 (TypeScript end-to-end, Electron default) is **not reopened**.
- The spike is **not complete**: the "Not tested / Not measured" items above must be closed before gate G0, mainly on the pilot PC and printer.

## Remaining to close the spike
| # | Task | Needs |
|---|---|---|
| 1 | Run `spike` on the pilot PC; print `s3.pdf` and a real attendance sheet on their printer | Access to the pilot PC and printer (OD-006) |
| 2 | ~~Visual check of PDF pages; Plex Arabic~~ done (Update 2) | — |
| 3 | ~~Run the packaged build~~ done with GPU caveat; **find the cause of the GPU hang and test `disableHardwareAcceleration()`** | None |
| 4 | ~~Backup during writes; kill-mid-write~~ done (short run); add a power-loss style test later | None |
| 5 | Price and choose code signing (OV vs EV certificate vs Microsoft Store) | Your budget decision (new OD) |
| 6 | Silent update test (electron-updater against a local server) | None |

## Cross-role review
- **Engineer:** versions are what npm resolved today; treat as VERIFY. Throwaway code writes into `spike/out`, which is not packaged-app-safe (asar is read-only).
- **QA:** every "Pass" above is on a developer machine; none is a pilot-readiness claim.
- **Security:** no encryption, no signing, no hardening was tested here; security gates S1–S3 are unaffected.
- **Product owner:** no scope or business rule was added.
