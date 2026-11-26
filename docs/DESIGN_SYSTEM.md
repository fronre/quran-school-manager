# DESIGN_SYSTEM.md

**Accountable role:** UX/UI Designer + Design Systems Engineer · **Status:** Batch 4 draft · **Date:** 2026-11-20

**Definition of Done:** the identity (concept, logo, color, type) is defined and validated; every token has a name and value; components have states and rules; RTL, Arabic numerals, Quran-text, accessibility, print, and the portal's mobile patterns are specified; the **interactive prototype** (`docs/prototype/index.html`) demonstrates it with sample data; nothing here is implemented code; approval items are listed.

**Status legend:** **C** Confirmed (from your brief) · **R** Recommended (my design decision, needs your approval) · **U** Unresolved (named OD) · **F** Future.

**Assets:** [prototype/index.html](prototype/index.html) (open in a browser; screens: login, home, students, attendance, student profile, parent portal on a phone, design-system sheet) · [brand/mishkat-mark.svg](brand/mishkat-mark.svg) · [brand/mishkat-mark-reversed.svg](brand/mishkat-mark-reversed.svg).

---

## 1. Concept: "السجلّ المضيء" (the illuminated register)

MISHKAT is a **register** (attendance books, enrollment lists, memorization logs) kept by people who serve a **light**. The name itself is the niche that holds a lamp. The design therefore has one idea, spent in one place:

- **The niche (محراب / مشكاة) is the only large curved shape.** It appears in the logo, on the login screen, in the empty-state illustration, and as the crown shape of the avatar and the guardian portal's tabs.
- **Everything else is a quiet ledger:** ivory ground, white sheets, 1 px hairlines, a 2 px brass rule that marks the head of each table, tabular numerals, dense but breathable rows.
- **The single "signature" data visual** is the **surah map**: 114 small cells, shaded by how much of each surah a student has memorized. It is information, not decoration.

What we deliberately avoid (from the brief and from generic-design traps): uniform rounded "cards" for everything, soft grey shadows, gradients, decorative charts, ornamental arabesque, eyebrow labels over every heading, motion for its own sake. Radii are small (4 px controls, 6 px panels); shadow is used only for floating layers.

## 2. Logo (R — needs your approval)

| Element | Specification |
|---|---|
| Mark | A tall niche arch (thick frame) containing a small oil lamp; the **flame is the only brass element**. Geometric, solid, readable at 20 px |
| Meaning | *مِشكاة*: a niche that holds a lamp. Light in a protected place; knowledge kept and passed on |
| Wordmark | "مشكاة" (Arabic, IBM Plex Sans Arabic Bold) + "MISHKAT" (IBM Plex Sans, wide letter-spacing) |
| Versions | Light background (emerald frame, brass flame) · dark background (ivory frame, light-brass flame) · on brass (deep-green frame, white flame) |
| Clear space | Equal to the flame's width around the mark |
| Minimum size | Mark 20 px / 6 mm; lockup 120 px wide |
| Don'ts | No rotation, shadow, outline, gradient, other colors, stretching; no flame without the niche |
| Production note | The wordmark is live text in the prototype. For distribution, **convert to outlines after the typeface files are fixed** (OD-029). Files provided: `brand/mishkat-mark.svg` and `brand/mishkat-mark-reversed.svg` |

Login-screen text: the fragment **«كَمِشْكَاةٍ فِيهَا مِصْبَاحٌ»** (Surah An-Nur, verse 35) in the Quran font. **It must be proofread by a qualified person before release, and the owner must decide whether Quranic text belongs in the brand** (OD-029).

## 3. Color

### 3.1 Tokens

| Token | Value | Use |
|---|---|---|
| `--em` Emerald | `#064E3B` | Primary action, headings, active controls |
| `--deep` Deep green | `#003527` | Sidebar, login brand panel, portal header |
| `--brass` Brass | `#B48E43` | **Decoration only:** rules, flame, large icons |
| `--brass-ink` Brass ink | `#8A6A2B` | **Brass-colored text on light** |
| `--brass-lt` Light brass | `#C9A55B` | Text/icons/active marker **on deep green**, accent button background |
| `--teal` Persian teal | `#0F766E` | Links, focus ring, info |
| `--ivory` Ivory | `#F4F5F0` | App background |
| `--white` | `#FFFFFF` | Working sheets, inputs |
| `--ink` | `#0F172A` | Primary text |
| `--ink2` | `#334155` | Secondary text |
| `--ink3` | `#566377` | Helper text (≥ 13 px) |
| `--line` / `--line-2` | `#DADDD0` / `#C9CEBF` | Hairlines, dividers |
| `--line-strong` | `#6B7C73` | Input and control borders (≥ 3:1 for UI components) |
| `--zebra` / `--hover` | `#FAFAF6` / `#EEF1EA` | Table row tint / hover |
| `--ok` `--bad` `--warn` | `#166534` `#B42318` `#92400E` | Semantic text and fills |
| Tints | ok `#E6F2EA` · bad `#FBEAE8` · warn `#FBF0E1` · teal `#E1F0EE` · brass `#F4ECD9` | Badge/banner backgrounds |

Sidebar text: `#CFE3DA` (10.17:1 on deep green); sidebar secondary `#9FB8AC` (6.45:1).

### 3.2 Contrast, measured (WCAG 2.1; AA = 4.5:1 text, 3:1 large text and UI components)

| Pair | Ratio | Verdict |
|---|---|---|
| Brass `#B48E43` on Ivory | 2.78 | **Fails** — never as text on light |
| Brass on White | 3.05 | Large text/graphics only |
| Brass on Emerald `#064E3B` | 3.19 | Large text/graphics only |
| Brass on Deep green `#003527` | 4.48 | Just below AA for small text |
| **Brass ink `#8A6A2B`** on Ivory / White | **4.59 / 5.03** | **Passes** — use for brass text on light |
| **Light brass `#C9A55B`** on Deep green | **5.86** | **Passes** — use on dark |
| Teal `#0F766E` on Ivory / White | 5.00 / 5.47 | Passes |
| Emerald on Ivory | 8.87 | Passes |
| White on Emerald / Teal / Danger / Success | 9.72 / 5.47 / 6.57 / 7.13 | Passes |
| `--ink` / `--ink2` on Ivory | 16.29 / 9.45 | Passes |
| `--ink3 #566377` on Ivory / White | 5.56 / 6.09 | Passes (original `#64748B` gave 4.34 on Ivory: **rejected**) |
| Status text on its tint (ok / bad / warn / teal) | 6.20 / 5.65 / 6.30 / 4.67 | Passes |
| Brass-ink-dark `#6F5320` on brass tint | 6.08 | Passes |
| Control border `#6B7C73` on White / Ivory | 4.42 / 4.03 | Passes (≥ 3:1 for UI) |

**Rule:** every new text/background pair must be added to this table with its measured ratio before use. A build check validates the token pairs.

**Color is never the only signal:** status badges carry text and a dot; attendance cells carry a numeral plus a **shape** (square = present, circle = absent, triangle = late, diamond = excused) plus a label in the legend.

## 4. Typography

| Role | Family | Size / weight | Notes |
|---|---|---|---|
| Arabic UI | **Noto Sans Arabic** (changed 2026-11-20 from IBM Plex Sans Arabic after the pilot owner found the latter hard to read: small, tight letterforms) | Body **16.5**/1.7, 400 · medium 500 · headings 600 · wordmark 700 | Latin letters and digits fall back to IBM Plex Sans; then Segoe UI, Tahoma. **Font files bundled** with the app and portal (no runtime download); licenses `VERIFY` (both OFL expected). Compared against Cairo, Tajawal, Almarai, Noto Naskh, Readex Pro, Vazirmatn |
| Latin and numerals | **IBM Plex Sans** | Tabular lining numerals | Used for digits, times, codes; wrapped in an LTR-isolated inline element |
| Quran text | **Amiri Quran** (candidate; `VERIFY` license and suitability) | 28–32/2.0 | Separate from UI font; **no fallback to the UI font**; never altered, normalized, or truncated |
| Scale | Page title 26/600 · section 17/600 · body 15 · table 14.5 (**min 14**) · helper 13.5 (**min 13**) | | No text under 13 px; line length < 80 characters in prose |

**Numerals:** Western digits (0–9) by default (OD-020). Times, ids, phone numbers, percentages use the `num` treatment: tabular, lining, isolated LTR so "16:30 – 18:00" and "0550 12 34 56" never scramble inside RTL text. Hijri and Gregorian dates are both shown on the home header; Hijri is computed with a configurable ±1 day adjustment (ADR-013).

## 5. Layout and density

| Item | Spec |
|---|---|
| Reference | 1440×900; verified at 1366×768 and 1920×1080; minimum window 1100 px wide; high-DPI scaling (no pixel-snapped hairlines: use 1 px CSS borders) |
| Direction | RTL; use **logical properties** (`inline-start/end`) everywhere; never `left/right` in components |
| App shell | Sidebar on the **right** (248 px, deep green) · top bar 56 px (search, system status) · content padding 28/32 px |
| Sidebar | Logo + association + **branch scope switch** (الفرعان / الرجال / النساء) · navigation · role/user at the bottom. For branch-scoped roles, the other branch's switch is disabled and the data is absent (BR-014) |
| Spacing scale | 4 · 8 · 12 · 16 · 24 · 32 px |
| Radii | 4 px controls, 6 px panels, **999 px 999 px 0 0 only for the niche shape** |
| Elevation | None on content; floating layers only (menus, dialogs, toasts) |
| Density | Table rows 44–52 px; one density in release 1 (compact mode is Future) |
| Home layout | Left-aligned reading order follows RTL: main column (needs-action list, today's sessions) and a narrow status aside separated by a hairline, **not** a grid of cards |

## 6. Components

All components have: default, hover, focus-visible (2 px teal outline, 2 px offset), disabled, and error where relevant. Targets ≥ 36 px tall on desktop and ≥ 44 px on the portal.

| Component | Rules |
|---|---|
| **Button** | Primary (emerald, white text) · Secondary (white, emerald text, strong border) · Quiet · Accent (light brass, deep text, used once per screen at most) · Danger. **Label = the action** ("تأكيد الحضور"), and the confirmation message repeats the same verb ("تم تأكيد الحضور") |
| **Input / Select / Textarea** | 40 px, strong border, label above, helper text below, error = red border + message with icon; the error says what happened and how to fix it |
| **Segmented control (attendance)** | Four states: حاضر / متأخر / غائب / بعذر; selected state fills with the semantic color; keyboard 1–4; arrows move between rows |
| **Badge** | Text + dot, tinted background; semantic color per status (see §3). Never color-only |
| **Data grid** | Hairline rows, zebra tint, **2 px brass rule under the sticky header**, header text 14/600, sortable columns marked with an arrow, row hover tint, keyboard-selectable rows, checkbox column, footer with count and pagination, keyboard hints. 2,000-row performance budget (SYSTEM_ARCHITECTURE §10); virtualization only if profiling demands |
| **Filters bar** | Search, chips (branch), selects (status); active filters visible and clearable; empty-result state offered |
| **Banner** | Four tones (info, warning, success, error) with icon + bold lead sentence + one line of explanation; used inline, never as a toast for something that needs action |
| **Toast** | One line, bottom-start, auto-dismiss after ~2.6 s, repeats the action verb; not used for errors |
| **Dialog** | For irreversible actions only (restore, archive, purge); states consequence and what is kept; dangerous actions need a typed confirmation phrase |
| **Sticky action bar** | Attendance and forms: counts on one side, primary action on the other; Ctrl+Enter shortcut |
| **Surah map** | 114 cells, 5 shades of emerald/teal by proportion memorized (0, <25, <50, <75, ≥75 %; thresholds configurable), tooltip with the surah number and name, legend, `role="img"` with a text summary; **only new memorization that passed counts** (BR-035) |
| **Progress figures** | Large numeral + short label (e.g. ayat memorized, attendance %). No decorative donut charts |
| **Niche empty state** | Niche outline + icon + one-sentence explanation + the primary action (and import where relevant) |
| **Skeleton** | Neutral bars (no spinner for page loads); animation off with `prefers-reduced-motion` |
| **Status chips (top bar)** | "نسخة احتياطية موثّقة" and "N تغييراً لم يُنشر": informational, link to the corresponding screen |
| **Role/scope indicator** | Always visible; shows which branch(es) the current user can see |
| **Calendar strip (portal)** | Day numerals with shape markers (see §3.2) and a legend |

## 7. Writing (Arabic UX copy)

- **Address** the user with the plural polite imperative used in the prototype ("أدخلوا"، "وصّلوا"، "أعيدوا المحاولة"), consistently across the product.
- **Name things by what users call them:** الحلقة، الحصة، تأكيد الحضور، النشر للبوابة. Avoid technical words ("مزامنة", "قاعدة بيانات", "سيرفر") in the UI.
- **Errors never apologize and never blame:** *what happened → what is safe → what to do*. Example: "تعذّر إنشاء النسخة الاحتياطية. القرص الخارجي غير موصول. وصّلوه ثم أعيدوا المحاولة. بياناتكم الحالية سليمة."
- **Empty states are invitations**, with the next action as a button.
- **Reassure where trust matters:** login ("يعمل البرنامج دون إنترنت. بياناتكم محفوظة على هذا الجهاز"), license ("بياناتكم متاحة دائماً حتى لو انتهى الترخيص"), restore ("سنحفظ نسخة من الحالة الحالية أولاً").
- One term per concept; keep the **action verb the same** from button to message to log.

## 8. RTL and bidirectional text rules

1. `dir="rtl"` at the root; logical properties only.
2. Digits, times, ids, phone numbers, MB/KB values, and Latin words are wrapped in an **isolated LTR inline** element.
3. Icons that imply direction (arrows, "back", pagination) are mirrored; others are not.
4. Mixed ranges ("الملك: 1 – 15") are tested in screenshots; the range is composed in a fixed template, not concatenated ad hoc.
5. Quran text is rendered in its own block with the Quran font, never inside a truncated or justified container.
6. Excel exports and printouts keep RTL sheet direction.

## 9. Accessibility

WCAG 2.1 AA target: contrast per §3.2 · visible keyboard focus everywhere · all controls reachable by keyboard · logical tab order in RTL · labels programmatically associated · state not conveyed by color alone · live regions for counts that change (attendance totals) · text scalable to 200 % without loss · `prefers-reduced-motion` honored · portal touch targets ≥ 44 px · automated contrast and keyboard checks per release (NFR-008).

## 10. Keyboard map (desktop)

`Ctrl+K` global search · `Ctrl+Enter` confirm/save · `Ctrl+L` lock screen · `↑/↓` move between rows · `1/2/3/4` attendance states · `Enter` open · `Esc` close. Every shortcut is shown where it applies (footer or tooltip).

## 11. Print and PDF

- Templates use the same tokens in a **print stylesheet**: white background, ink text, brass rule retained, no sidebar, A4 portrait, 14 mm margins, repeated table headers, page numbers, association name and logo in the header, "printed by / date" in the footer.
- Attendance sheets: a blank, ruled roster with date columns for paper fallback.
- All data in templates is **escaped** (SEC-053). Arabic output verified on the pilot's printer (spike S3, RISK-016).

## 12. Parent portal (mobile) patterns

- **Header:** association name + logo; **child tabs** with a niche-shaped crown (the same shape language); one child at a time.
- **Order of content:** announcement (if any) → attendance (last ~4 weeks, day numerals with shapes) → memorized total → recent records → freshness line "آخر تحديث من الجمعية: …".
- **Honesty about staleness:** the portal always says when data was last published (BR-041) and that newer entries may not be visible yet.
- **No clutter:** no charts beyond the calendar strip; no ads, trackers, or social features.
- **Installable (PWA)**, offline shell with the last known data and its timestamp.
- Reading level: short sentences, no jargon, large numerals. Never shows another child, another branch, staff comments not marked shareable, documents, or other phone numbers (BR-040, BR-042).

## 13. Motion

Almost none. Allowed: focus and state transitions (≤ 120 ms), skeleton shimmer, toast appearance. No entrance animations, no parallax, nothing that moves without a user action. Everything stops with `prefers-reduced-motion`.

## 14. Implementation notes (for Phase 1)

- Tokens defined once (`tokens.json` → CSS variables for desktop and portal); a **contrast test** reads the token pairs and fails the build below threshold.
- One component library shared by desktop and portal (ADR-003); the HTML prototype becomes the first reference implementation and a **visual regression baseline** (screenshots at 1366/1440/1920 and 390 px).
- Icons: a single outline set at 1.6 px stroke (the prototype uses a small hand-drawn set; replace with a licensed set at implementation `VERIFY`).
- Fonts bundled as files with licenses recorded in the repository.
- Dark mode: **Future** (not release 1).

## 15. What the prototype demonstrates (and does not)

| Demonstrates | Does not |
|---|---|
| Visual identity, shell, tokens, contrast table, component states, 6 screens, RTL and number handling, branch-scope switching (role selector in the sidebar), attendance interaction (statuses, counts, confirm rule, keyboard), surah map, parent view | Real data, persistence, authorization, calendars computed correctly (the Hijri date is a sample), printing, accessibility audit, performance |

## 16. Approval checklist (needs you)

1. **Concept and logo** (niche + lamp, brass flame) — approve or ask for another direction.
2. **Wordmark** and typefaces (IBM Plex Sans Arabic / IBM Plex Sans) — Quran font candidate Amiri Quran pending license and proofreading.
3. **Brass rule:** brass is decoration; brass text uses `#8A6A2B` on light and `#C9A55B` on dark.
4. **Login verse:** keep, replace, or remove (OD-029).
5. **Branch switch in the sidebar** and the **home screen layout** (needs-action list + today's sessions + status aside).
6. **Surah map** as the progress visual.

## 17. Unresolved items

| ID | Item |
|---|---|
| OD-029 | Brand approval: logo, wordmark outlines, the login verse, font files and licenses (new) |
| OD-020 | Numerals and calendars defaults (assumed Western digits, Hijri + Gregorian) |
| OD-005 | Display-name policy on the portal (first name + family initial assumed) |
| OD-021 | Evaluation scale labels (the prototype uses ممتاز / جيد جداً / جيد / يحتاج مراجعة as samples) |

---

**Cross-role review (QA Automation Engineer):** the design system is testable: contrast pairs, focus order, RTL screenshots, and keyboard flows have automatic checks. The two that most often regress are **bidi scrambling of numbers** and **focus order in RTL**; both get visual-regression and keyboard tests from the first component.
