# HISTORY

كل bug أو اكتشاف أو تغيير في قرار يتسجل هنا بالشكل: **Symptom / Cause / Fix / Lesson**.

## Phase 0 — Design (2026-09-27)
- **What:** أول نسخة من وثائق التصميم (`docs/design/01..08`) وسجل القرارات (`docs/adr`).
- **Why:** قرار المالك: لا كود قبل البحث والتصميم.
- **Open:** كل الـADRs "مقترحة" لحد ما تجارب المرحلة 0 (S1–S8) تثبتها بالأرقام.

## Phase E0 — The manufacturing core becomes part of an ecosystem (2026-09-27)
- **Symptom (design gap):** the first design treated manufacturing as a standalone program. The owner's
  other systems (Mizan accounting, Space Planner 3D, BAMS, G-MES automation) would each keep their own copy
  of items, warehouses, people and stations.
- **Discovery:** studied every branch of the four repositories. `Mr.Ayman-HR` is BAMS (break-area
  management), not HR: nobody owns people/shifts/attendance today. Mizan and Space Planner are TypeScript
  on Node with local SQLite. Space Planner's server accepts 127.0.0.1 only, on purpose. Mizan already
  exposes everything a first integration needs (stock adjustments with a counter account and a reference).
- **Fix:** ecosystem documents E1–E7 (ownership, contracts, identity, scenarios, risks, reuse); ADR-014..020
  (TypeScript; no multi-writer merge for production; feed/inbox/acks; global ids; ×1000 quantities;
  interim costing through Mizan adjustments; Mizan's AppModule shape). Design docs 01/03/04/08 amended in place.
- **Lesson:** read the neighbours before designing a piece: the real names, stacks and gaps of the other
  systems changed the language, the id scheme, the quantity scale and the integration style.

## Phase E1 — First real integration slice: manufacturing kernel + Mizan link (2026-09-27)
- **What:** `packages/eco-contracts` (envelope, item/warehouse snapshots, consumed/completed/scrapped/closed facts,
  acks; JSON Schemas generated), `apps/mes-server` (single-writer SQLite port, idempotent commands, hash-chained
  ledger, work orders, outbox/feed/inbox/acks, ownership enforcement), `apps/link-mizan` (Mizan's agent through
  Mizan's unchanged public API). 35 automated tests: 10 end-to-end against a real Mizan process; 8 planted bugs all caught.
- **Discovery — Mizan health:** a fresh Mizan reports `system.backup` not ok until its first backup. The
  end-to-end setup takes a backup like a real installation; the test then demands every Mizan check green.
- **Discovery — work in progress:** a WIP account with subtype `inventory` would break Mizan's valuation check
  (inventory accounts = stock value). The link refuses to start in that case (test: "refuses to start…").
- **Bug caught in review — fingerprint:** `JSON.stringify(obj, Object.keys(obj).sort())` uses the key list for
  EVERY level, so nested `name.en/ar` were dropped and a renamed item would never have been re-sent. Replaced by a
  recursive stable stringify; S1 renames an item in Mizan and checks manufacturing sees it.
- **Discovery — mutation testing:** two planted bugs survived the first green run. (1) "final completion does not
  take the remainder" was an *equivalent* mutation: on a final completion the open quantity equals the reported one,
  so the proportional share already is the remainder; replaced by "cost share ignores scrap", which the new
  scrap-before-completion test catches. (2) "transient failures advance the cursor" survived because the outage
  test only broke Mizan before the feed was read; S4b now drops the network in the middle of the feed.
- **Lesson:** green is not evidence until a planted bug turns it red; and an outage test must cut the line at
  the step that matters, not just at the first call.

## Phase E2 — HR-System becomes the owner of the workforce; manufacturing connected (2026-09-27)
- **Correction:** `Mr.Ayman-HR` is BAMS, not HR. The owner's real HR system was located by scanning 32 repositories:
  `coolman1984/Department-automation` ("HR Attendance Control"). It was migrated WITH its history into
  `coolman1984/HR-System` (main = source branch `58a2298`, a strict +5/-0 fast-forward of its main). Source untouched.
- **Proof of equivalence:** a golden file produced from the ORIGINAL checkout; the migrated tree gives 0 differences
  over five scenarios. All original tests pass (four need `PYTHONPATH=vendor.zip`, as the author had openpyxl installed).
- **Contracts:** `eco.employee.v1` (no personal data) and `eco.attendance_day.v1`; identity UUIDv5 of the HR code, equal
  in Python and TypeScript (tested). Drafts `eco.person.v1`/`eco.shift_pattern.v1` superseded before ever being built.
- **Boundary:** manufacturing mirrors HR read-only and checks every person a command names (`ownership.person = 'hr'`);
  `'none'` keeps the old unchecked behaviour as the rollback switch. There was no worker master table to replace —
  only an unchecked `person` reference; nothing was deleted.
- **Bug found in the test harness:** the first HR end-to-end run timed out because the HR publisher was started with
  a SYNCHRONOUS child process while the manufacturing server lived in the same Node process — the server could not
  answer. Fixed by starting it asynchronously. **Lesson:** never block the event loop that serves the system under test.
- **Discovery (mutation testing, HR side):** "event id no longer derived from (type, entity, version)" survived — the
  no-duplicate guarantee comes from resending the STORED envelope, not from the id formula. Replaced by the real
  danger ("a resend rebuilds the envelope with a fresh id"), which is caught; the code comment now states the true reason.
- **Found in HR, pinned not fixed:** re-uploading the same attendance bytes with new employee/roster/leave files is
  treated as a duplicate and the new files are ignored; HR's `.gitignore` did not exclude `data/` (fixed: safety only).

