# MISHKAT — project rules (ACTIVE since 2026-11-20)

## What this is
MISHKAT (مِشكاة): Quranic association management. Release 1 = Windows desktop (offline, system of record) + guardian web portal (mobile-first, read-only, one-way publish). Pilot: 200+ students, two branches (men's/women's), one PC.

## Stack (ADR-003, approved 2026-11-20; spike S1–S4 in progress)
TypeScript end-to-end: one UI stack for the desktop shell (Electron default, Tauri candidate) and the guardian portal; pure TypeScript `domain` package that imports nothing; SQLite locally (WAL, STRICT, foreign keys on); PostgreSQL + row-level security for the portal. Details in `docs/SYSTEM_ARCHITECTURE.md`.

## Current phase
**Phase 1 (foundation) started 2026-11-20** on the user's instruction "اخدم كلش تو اخدم" (treated as go-ahead for G0). Product code lives in `packages/*` and `apps/*`; Phase 1 scope per `docs/IMPLEMENTATION_ROADMAP.md`. Still open and NOT to be invented: OD-005/006/007/012/013/018/029. Spike leftovers (pilot PC, printer, silent update, signing) remain tracked in `docs/SPIKE_REPORT.md`.

(Historical) Phase 0 (spike) scope: The user approved the discovery phase and tooling installation for the spike on 2026-11-20. Scope of what is allowed now:
- Throwaway spike code in `spike/` only (S1–S4). It is not product code and must not be reused without review.
- No product code (`apps/`, `packages/`) until the spike report is reviewed and the user approves gate G0 (see `docs/IMPLEMENTATION_ROADMAP.md`).
- Install only what the spike needs, inside `spike/`. No global/system changes without asking.
Source of truth for scope: `docs/PRD.md`; unresolved items: `docs/OPEN_DECISIONS.md`.

## Rules
1. Never invent business, legal, or product rules. Record them as `OD-###` with options and a recommendation.
2. Never claim tests passed without running them. Never hide failures.
3. Do not install packages, change system configuration, or overwrite files without inspection/approval (approval for spike tooling given; it does not extend beyond the spike).
4. Mark changing technology facts `VERIFY` and check before relying on them. Legal topics: flag for professional review, never assert compliance.
5. IDs: `REQ-###`, `BR-###`, `OD-###`, `RISK-###`, `NFR-###`; ADR for every significant technical decision.
6. Every document: Definition of Done at top; sections Confirmed / Recommended / Unresolved / Future; closing cross-role review.
7. Documents in English; Arabic UI terms live in `docs/GLOSSARY.md`.

## Product invariants (must be domain-tested)
- One active enrollment per student per academic year; transfers keep history.
- Attendance references a valid enrollment and session.
- Memorization progress = union of ranges, never summed counts; exact Surah/Ayah references.
- Financial/academic corrections use explicit correction records, not silent edits.
- Tenant and branch data never leak (branch-scoped by default, OD-003).
- Licence lapse never locks access to the association's data.
- Audit log is not editable by ordinary users.

## Schema must be sync-ready from the first migration
UUID (prefer v7) keys, `tenant_id` on tenant-owned tables, version/`updated_at`/`updated_by`, soft deletes with tombstones, no auto-increment ids.

## Brand tokens
Primary Emerald `#064E3B` · Deep Green `#003527` · Archival Brass `#B48E43` · Persian Teal `#0F766E` · Warm Ivory `#F4F5F0` · White `#FFFFFF` · Text `#0F172A` / `#334155`.
Fonts: Noto Sans Arabic (Arabic UI, body 16.5px; chosen by the pilot owner 2026-11-20 over IBM Plex Sans Arabic), IBM Plex Sans (Latin and digits), a separate Quran-text font for ayat.
**Brass fails contrast as small text on light backgrounds (2.78:1 on Ivory)** — decoration only; use brass-ink `#8A6A2B` for text on light, `#C9A55B` on dark. See `docs/DESIGN_SYSTEM.md`.

## Design
Arabic-first RTL, dense but readable, premium institutional. Avoid generic dashboards, excess cards, random gradients, ornamentation. Approved prototype: `docs/prototype/index.html`.
