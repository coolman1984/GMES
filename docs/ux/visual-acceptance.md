# Visual acceptance — the application shell (UX phase)

The finish line is not "the page works". It is: **HR-System looks like a polished commercial HR product, and GMES
immediately feels like a serious manufacturing execution system inspired by the real G-MES working environment.**
Business features stay frozen until the owner approves this shell (owner's instruction, 2026-09-28).

How to review: open the screenshots in `docs/ux/screenshots/` (desktop 1600×900, taken from the running servers with a
real browser), then the live screens. Every item below is checked on every screenshot set; a ✗ is fixed before the
next set. Items marked **G-MES ref** are compared side by side with the owner's real G-MES screenshots once they arrive
(sensitive data hidden) — until then they are checked against the documented G-MES experience
(`opening-nerp-tcode`: GMES_SKILL.md, PROJECT_EXPERIENCE.md §5–9; GMES `docs/design/05`, `06`).

## 1. Shell and navigation
| # | Check | GMES | HR |
|---|---|---|---|
| 1.1 | Dark top application bar: product mark + name, company/plant, screen search, theme, help, notifications, user | ✓ | ✓ |
| 1.2 | Collapsible left menu tree, groups with icons, active screen marked, filter box, collapses to an icon rail | ✓ | ✓ |
| 1.3 | Screen search by **code or name** (Ctrl+K), recent screens first, keyboard only | ✓ | ✓ |
| 1.4 | MDI tabs: several screens open, each keeps its state, close / close others / close all, Alt+1…9, a limit with a message | ✓ | ✓ |
| 1.5 | Breadcrumb + screen code on every screen (**G-MES ref**: the code is the address, `[ P1112UM00 > P1112WM00 ]`) | ✓ | ✓ |
| 1.6 | Status bar: connection (observed, not assumed), company, user, clock, version, language | ✓ | ✓ |
| 1.7 | Favourites (star on the screen) appear at the top of the menu | ✓ | ✓ |
| 1.8 | No Samsung/G-MES logo, name, icon or asset anywhere; our own marks and accent colours | ✓ | ✓ |

## 2. The standard screen (conditions → Inquiry → grid → details)
| # | Check | GMES | HR |
|---|---|---|---|
| 2.1 | One toolbar per screen: the screen's actions on the start side, standard ones (Inquiry F5, Reset, Export Ctrl+E, Columns, Print) on the end side | ✓ | ✓ |
| 2.2 | Collapsible condition panel, required conditions marked * and a red edge; Inquiry refuses to run without them (never "0 rows" silently — **G-MES ref** gotcha #12) | ✓ | ✓ |
| 2.3 | Collapsed conditions show their values as chips | ✓ | ✓ |
| 2.4 | Saved filters: save, apply, default, delete (per person) | ✓ | ✓ |
| 2.5 | Result bar: applied conditions, row count, query time and duration, quick filter, export | ✓ | ✓ |
| 2.6 | Master–detail: selected row's details on the side, resizable divider (remembered) | ✓ | ✓ |
| 2.7 | Every empty grid says why ("set the conditions…", "nothing matches…"), loading is visible | ✓ | ✓ |

## 3. Dense grid
| # | Check | GMES | HR |
|---|---|---|---|
| 3.1 | Row 26 px, text 12.5 px, header 28 px; about 20 rows visible at 1600×900 with the conditions open, more when collapsed (**G-MES ref**: density — may need 22–24 px rows after the comparison) | ✓ | ✓ |
| 3.2 | Frozen key columns, sort (Shift for several), resize, hide, reorder, "Columns…" dialog, layout remembered per person | ✓ | ✓ |
| 3.3 | Totals row (sums, count) that follows the filter (**G-MES ref**: LINE SUM rows are totals, not data — gotcha #28) | ✓ | ✓ |
| 3.4 | Codes and numbers in a monospace/tabular face, numbers right-aligned, codes stay left-to-right in Arabic | ✓ | ✓ |
| 3.5 | Status = colour + icon + word (never colour alone); production colours fixed everywhere | ✓ | ✓ |
| 3.6 | Keyboard: arrows, Page Up/Down, Enter opens, Space selects, Ctrl+A | ✓ | ✓ |
| 3.7 | Virtual rows (only the visible rows are drawn; checked with 486 rows); export writes **all** filtered rows, not the visible ones (**G-MES ref** gotcha #9) | ✓ | ✓ |
| 3.8 | Multi-select with bulk actions enabled only when they apply | ✓ | ✓ |

## 4. Dialogs, notifications, forms
| # | Check | GMES | HR |
|---|---|---|---|
| 4.1 | Add/edit dialogs grouped in sections, required marks, errors shown inside the dialog in plain words | ✓ | ✓ |
| 4.2 | Confirmation for anything destructive, danger colour, says what will happen | ✓ | ✓ |
| 4.3 | Toasts for results; kept ones appear in the notification bell | ✓ | ✓ |
| 4.4 | Esc closes; focus stays inside the dialog | ✓ | ✓ |

## 5. Languages, themes, density
| # | Check | GMES | HR |
|---|---|---|---|
| 5.1 | Arabic mirrors the whole shell (menu right, tabs, grid, dialogs); codes and numbers stay left-to-right | ✓ | ✓ |
| 5.2 | Every text in both dictionaries (test), no English left in Arabic screens except codes and data | ✓ | ✓ |
| 5.3 | Light and dark themes from the same tokens; dark keeps statuses readable | ✓ | ✓ |
| 5.4 | Compact / comfortable density, per person | ✓ | ✓ |

## 6. Shop floor and boards (GMES)
| # | Check | |
|---|---|---|
| 6.1 | Office / Station / Board modes: same screens, different frame | ✓ |
| 6.2 | Station: scan field first, buttons ≥ 64 px (96 px), text ≥ 20 px, colour + icon + big words for every reaction | ✓ |
| 6.3 | Station: a lost connection is a full-width red bar, recording is blocked (never silent storage) | ✓ |
| 6.4 | Station: reasons as big icon buttons (scrap, stop) | ✓ |
| 6.5 | Board: readable across the hall (60 px numbers), dark high contrast, line state first, hourly plan vs actual, last stoppages | ✓ |

## 7. Honesty and safety
| # | Check | GMES | HR |
|---|---|---|---|
| 7.1 | Screens with invented data carry a "Sample data" badge (test) and say "nothing was saved" | ✓ | n/a (real data) |
| 7.2 | No server value is ever parsed as HTML (test, planted bug) | ✓ | ✓ |
| 7.3 | Strict Content-Security-Policy: scripts from the product's own server only (test, planted bug) | ✓ | ✓ |

## Known gaps (not hidden)
- Colours, spacing and type sizes are ours, derived from the documented G-MES philosophy; the side-by-side comparison
  with real G-MES screenshots (§ **G-MES ref** items) waits for the owner's redacted screenshots (design doc 06 §6.6).
- GMES screens run on sample data; wiring them to the server is the first task after approval.
- HR's attendance screen shows the migrated attendance application inside the shell; its inner look is the locked
  engine's (`dashboard.html` may not be changed — HR-System CLAUDE.md), so it does not follow the tokens yet.
- Fonts are the system's (Segoe UI on Windows); no font files are shipped yet.

## Screenshot sets
| Set | Date | Where | Notes |
|---|---|---|---|
| 1 | 2026-09-28 | reviewed in the session | first build: found the totals row transparent under frozen columns, stretched chart text, the address ignored on start, preferences read before the store was named, truncated headers |
| 2 | 2026-09-28 | reviewed in the session | all set-1 findings fixed; Arabic dark, station and board modes, dialogs, palette added |
| 3 | 2026-09-28 | `docs/ux/screenshots/` | the set sent to the owner for approval |
