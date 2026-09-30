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

## Phase E3 — Ecosystem infrastructure foundation (BAMS studied) + HR registry connected (2026-09-27)
- **Study:** BAMS (`Mr.Ayman-HR` @`5f5b3ce`, read only; 33 fast tests pass) documented as the infrastructure reference:
  capability matrix, pattern map, BAMS-vs-GMES comparison, gaps, common foundation and migration plan
  (`docs/ecosystem/08-infrastructure-foundation.md`, ADR-024..028).
- **Convergence, first step:** one canonical JSON + journal-hash format for the whole ecosystem (BAMS's, plus a
  domain prefix), with shared vectors generated in Python that the TypeScript implementation and HR-System both pass.
  **Lesson:** "both sort keys and drop spaces" was an assumption until vectors proved it; JS sorts keys by UTF-16
  unit and Python by code point, so the TS implementation sorts by code point explicitly.
- **Proof, not opinion:** `offline-merge-proof.test.ts` shows counter merging counts one serial twice and completes
  10 of a 5-unit order, LWW erases a fact, while the authoritative model refuses both. BAMS itself documents the same
  limit (two PCs restoring one backup apply a quantity difference twice).
- **Found in BAMS (not fixed there, never modified):** backups are integrity-checked but there is no periodic
  automated restore test — a gap for every app (ADR-028).
- **HR registry → manufacturing:** HR-System @`89e4d96` publishes employees from its own registry (department,
  position, site). The real end-to-end test shows the switch changes no identity and duplicates nobody.
  **Known seam:** three employees the registry rejects (termination before hire in the synthetic master) stay in
  manufacturing's mirror as last published by the attendance-derived path — absence is never deletion; HR must fix them.


## Phase F2 — HR-System security and recovery; the foundation takes its first shape (2026-09-27)
- **What:** HR-System @`8dcfe4f` (phase 2) has users, profiles and server-side permissions, device identity with
  clone detection, an Ed25519-signed append-only journal and audit in the ecosystem format (ADR-026), verified signed
  backups with an automatic restore rehearsal, compensating restore, and recovery of any one lost database file.
  `scripts/fetch-hr.sh` is pinned to it; `hr-e2e` passes unchanged (the registry's journal lines are now signed by
  the HR installation's device; nothing it publishes changed).
- **Symptom (plan was wrong):** E8.7 F2 said HR would sign "in Python with no external library, adopting BAMS's
  `ed25519.py`". The owner required the standard library first. **Cause:** the plan assumed bundling `cryptography`
  was impossible; it is possible with an embedded runtime (one `cryptography` + one `cffi` per architecture) and
  not with the customer's own Python (a `cffi` build per version × architecture). **Fix:** HR uses `cryptography`
  when it imports and passes the RFC 8032 vector, BAMS's file byte-for-byte (hash-pinned) otherwise; both are
  cross-checked with each other and with the OpenSSL command line (HR `docs/HR_SECURITY.md`, ADR-HR-002).
- **Discovery:** a broken `cryptography` (missing `cffi`) does not raise `ImportError`: it panics in Rust
  (`PanicException`, a `BaseException`). **Lesson:** "optional native dependency" code must survive a crash on
  import, and prove the backend with a known answer before trusting it. GMES's signed ledger (F3) must do the same.
- **Discovery:** a store that remembers only the NUMBER of the last journal line it applied cannot tell that the
  journal was replaced by an older backup (a new line re-grows the number). HR stores the line's hash too.
  **Lesson for F3:** GMES projections must record the hash of the last ledger line they folded.
- **Foundation, not yet extracted:** HR's `signing.py`, `canonical.py`, `Backups.verify`/`rehearse` and `Device` are
  the candidates for the shared foundation (E8.6). They stay in HR until GMES (F3) is their second user — extracting
  from one user fixes the wrong seams.

## Phase UX1 — The application shell before any new module (2026-09-28)
- **What:** owner's instruction: stop feature work; build the shell and a reusable design system first. `packages/eco-ui`
  (tokens light/dark, density, per-product accent; shell with menu tree, Ctrl+K screen search, MDI tabs, breadcrumb + code,
  standard toolbar, condition panel with saved filters, dense virtual grid, dialogs, notifications); `apps/mes-web` (GMES shell,
  EXE3010, MDM1010, SYS9010, EXE2020, DSH5010; office/station/board modes) served by `mes-server` (`src/web.ts`); HR-System
  carries the same kit unchanged (ADR-029). 9 new tests, 4 new planted bugs, all caught.
- **Symptom:** opening `/#EXE3010` showed only the start page. **Cause:** the home tab was opened first and rewrote the
  address to `#HOME` before the shell read it. **Fix:** `start()` reads the address before opening anything. **Lesson:** read
  the input before the first step that can change it (the same shape as G-MES gotcha #32: options rebuild the panel).
- **Symptom:** saved theme and language were ignored after a reload. **Cause:** preferences were read before the store was
  given its product name, so reads went to `eco:*` while writes went to `gmes:*`. **Fix:** `configure({ prefix })` first.
  **Lesson:** a preference that "does not stick" is usually read and written under two different names.
- **Symptom:** in the totals row, the first cells showed the last data row through them. **Cause:** frozen cells use
  `background: inherit` to follow the row colour; the totals row has no colour of its own, so they were transparent.
  **Fix:** frozen total cells take the totals colour explicitly. **Lesson:** `inherit` is only as good as the parent.
- **Symptom:** chart labels were stretched on wide cards. **Cause:** `preserveAspectRatio="none"` scaled text with the bars.
  **Fix:** uniform scaling and a wider default drawing. **Lesson:** never stretch an SVG that carries text.
- **Symptom:** the station's big buttons floated mid-screen. **Cause:** a hidden stop bar left a grid row template with
  one row too many. **Fix:** a flex column. **Lesson:** `hidden` items drop out of a grid; row templates do not know it.
- **Symptom (found by a browser run, not by review):** the quick filter found nothing for a value in a hidden column.
  **Cause:** it searched only visible columns. **Fix:** it searches every column. **Lesson:** a person who hid a column
  still expects to find by it; verify interactions in a real browser, not only screenshots.
- **Open:** the colours are still ours; the side-by-side comparison with real G-MES screenshots waits for the owner's
  redacted screenshots (`docs/ux/visual-acceptance.md`). The product name "GMES" is close to Samsung's "G-MES" while
  design doc 06 §6.1 asks for an own name — a decision for the owner.

## Phase W1 — HR's plan and qualifications reach the shop floor (2026-09-28)
- **What:** `eco.schedule_day.v1` and `eco.qualification.v1` (contracts + generated schemas); mirrors `mdm_schedule_day`,
  `mdm_qualification`; manufacturing's own `mdm_station_requirement` (`PUT /api/stations/<code>/requirements`, scope
  `mdm.stations.write`); commands may name a `station` and are refused with `person.not_qualified` when HR has not
  qualified the person validly at the level on that production day; `/api/workforce/status` shows the age of what HR
  sent; `/api/schedule?date=`. Tests: 2 in `hr-boundary`, 1 end to end with the real HR-System; 3 planted bugs (ADR-030).
- **Discovery (in HR, recorded there):** HR's standard-library validator refused the first contract with an `enum`;
  it fails loudly on unknown keywords by design and was taught `enum`. The generated schemas here are unchanged in form.

## Phase L1 — One-click start and a Windows-clean test run (2026-09-28)
- **What:** `Start-GMES.bat` -> `scripts/start.ps1` (Node check, `npm ci` only when `package-lock.json` changes, first-run
  `data/config.json`, start, wait for `/api/health`, open the browser, already-running detection, stop on close);
  `scripts/new-key.ps1`; `scripts/test.ps1` (the whole definition of done); `fetch-mizan.ps1` / `fetch-hr.ps1` replace the
  `.sh` scripts; CI calls them with `shell: pwsh`; PowerShell only for all tooling (ADR-031).
- **Symptom:** on a fresh Windows checkout `npm test` failed in `eco-contracts` (`contracts.test.ts`, schema comparison).
  **Cause:** git's `core.autocrlf=true` checked the generated `*.schema.json` out with CRLF; the test compares them byte for
  byte with LF output. **Fix:** `.gitattributes` (`* text=auto eol=lf`; `.bat`/`.ps1` stay CRLF). **Lesson:** a test that
  compares generated files byte for byte must pin the line endings of the files it compares.
- **Symptom:** `boundaries.test.ts` failed on Windows listing every module import as a violation. **Cause:** it compared
  `path.relative()` results (backslashes on Windows) with `/`-separated prefixes. **Fix:** the test normalises separators
  (the rule itself is unchanged). **Lesson:** compare paths in one normal form; the suite had only ever run on Linux.
- **Symptom:** the 6 HR end-to-end tests were "cancelled", not failed. **Cause:** they start `python3`, which on Windows is
  the Microsoft Store stub. **Fix:** `scripts/test.ps1` picks a real Python (`PYTHON` overrides). **Lesson:** "0 failed"
  is not "all passed" — read the cancelled/skipped counts (41 tests, 35 passing, 6 cancelled).
- **Symptom (found by running the launcher, not by reading it):** `start.ps1` refused a valid `port`. **Cause:** PowerShell 7
  reads JSON integers as `Int64`, and the check was `-isnot [int]`. **Fix:** parse with `[int]::TryParse`. **Lesson:**
  validate the value, not its runtime type.
- **Symptom:** testing the `.bat` with `cmd /c Start-GMES.bat` said "not recognized". **Cause:** this machine sets
  `NoDefaultCurrentDirectoryInExePath=1`, so `cmd` does not look in the current folder; a double-click passes the full path
  and is unaffected. **Lesson:** test the launcher the way it is really launched (full path).

## Phase A — The screens work on the server: people, plant model, work orders, station, boards (2026-09-28)
- **What (owner's decision, 2026-09-28: the shell is accepted, wire it):** sign-in with local accounts (scrypt passwords,
  HttpOnly SameSite=Strict session cookie, 12 h), first administrator created from the screen, forced password change,
  7 roles -> scopes, lock after 5 wrong passwords, append-only `sys_audit`; the plant model `mdm_plant_node`
  (plant > area > line > station > equipment, codes never change, deactivate-not-delete, optimistic version); work orders
  carry line / shift / priority and are listed from the ledger (`GET /api/work-orders`); the `oee` module keeps stoppages as
  append-only START/END facts; `GET /api/boards/plant` and `/api/boards/line/:code` read only the ledger (no OEE until cycle
  times exist; the hourly plan only from a line capacity). Screens: sign-in/setup, HOME, EXE3010, EXE2020, MDM1010, new
  MDM1020 (items and warehouses), SYS9010, DSH5010 — `data.js` (the sample data) is deleted (ADR-032).
  Tests: 14 new (users, plant, stoppages, boards) + 2 rewritten screen rules; 6 new planted bugs, 1 retired.
- **Symptom (found while writing, proved by a planted bug):** five wrong passwords never locked an account. **Cause:** the
  refusal was thrown inside the transaction that counted the failure, so the count was rolled back each time. **Fix:** commit
  the count, then refuse. **Lesson:** an error raised inside a transaction undoes everything the transaction wrote — including
  the record of the error.
- **Symptom (found by a browser run over CDP):** opening `/#HOME` showed the last restored tab instead of the start page.
  **Cause:** `createShell().start()` opened home first and the restored tabs after it. **Fix:** re-activate home when the
  address asks for it (eco-ui; HR-System must re-copy the kit). **Lesson:** the address is the user's intent; restoring state
  must not override it.
- **Symptom:** PowerShell string replacement silently emptied `${...}` in TypeScript template literals. **Cause:** `$` is
  interpolated in double-quoted PowerShell strings. **Fix:** source edits through the editor, not through shell strings.
  **Lesson:** never pass code containing `$` through a double-quoted shell string.
- **Open:** OEE needs cycle times (routing module); hold/release waits for QMS; the station books whole units (serial items
  one per scan); the plant name shown is the installation node until a settings screen exists.

## Kit — Mizan's look and grid ideas in eco-ui (2026-09-28, ADR-033)
- **What:** the opt-in `data-look="modern"` (Mizan's visual language, fonts carried in `src/fonts/`), per-column filters,
  grouping and presets in `grid()`, filter chips and presets in `screen()`, `donut`, `kpiStrip`, `healthBanner`, `steps`,
  `advice`, actions in the screen search. GMES stays on the classic look; HR-System re-copies the kit and uses modern.
- **Discovery:** a grouped grid mixes group headers with rows, so the row index the grid used for clicks, keys and selection
  (an index into the visible rows) no longer pointed at a row. **Fix:** the grid draws "lines" (headers + rows); `cursor` and
  `data-i` count lines, `view` stays the rows only (count, export, select-all). **Lesson:** when a list starts to hold two
  kinds of item, rename the index it is addressed by, or every old caller silently addresses the wrong kind.
- **Discovery:** the kit's light "modern" tokens come after the dark classic ones in the file; with equal specificity the
  light values would win in dark mode. **Fix:** the dark modern block uses one more attribute (`[data-look][data-theme]`) and
  redefines every colour. **Lesson:** in a token file, order is a rule too: write down which block must win and why.

## Phase B1 — Engineering and the serial flow of a television plant (2026-09-28)
- **What (owner's order: finish GMES with a realistic TV plant):** `eng` module (routings, bills of materials as frozen
  revisions, production shifts and calendar, units of measure), `trk` module (serial units along their routing, repair loop,
  key parts, material lots on stations, genealogy, WIP, traceability both ways), `kernel/chain.ts` (hash-chained fact tables),
  `/api/ledger` (the production ledger, filtered). Screens: EXE2010 release plan, EXE2020 serial mode, EXE3020 unit history,
  EXE3030 transactions, WIP3010/3020, TRC2010/3010/3020, MDM1030/1040/1050/1060 (ADR-034). 11 new tests, 10 new planted bugs.
- **Symptom (found by the new test, before any demo):** a finished order booked 0.004 screws instead of 4. **Cause:** the
  backflush divided by 1000 a quantity that was already in thousandths (units are a count, `qty_per` is in thousandths).
  **Fix:** `units * qty_per`. **Lesson:** when two numbers in one formula carry different scales, name the scale in the code;
  a planted bug now reintroduces the division and must be caught.
- **Discovery (design):** the last unit of an order makes the order `completed`, after which the ledger refuses consumption.
  Booking material only when a lot is unloaded would therefore lose it for finished orders. **Fix:** everything a work order
  used is booked just BEFORE its final unit (lots used from station loads, and backflushed BOM lines); a planted bug moves the
  booking after the final fact and is caught.
- **Symptom (found in a real browser, not by the tests):** most new inquiry screens showed "Cannot read properties of undefined
  (reading 'length')". **Cause:** the shared screen builder passed `presets: undefined` to the grid, which replaced the grid's
  default `[]` (a spread of an options object copies undefined values). **Fix:** pass the key only when defined. **Lesson:** a
  default in `{ ...defaults, ...opts }` is lost to an explicit `undefined`; screens are opened in a real browser before a push.
- **Symptom:** in the browser run the whole application slid sideways after about ten tabs. **Cause:** the tab strip called
  `scrollIntoView`, which also scrolls every scrollable ancestor — an `overflow: hidden` frame can still be scrolled that way.
  **Fix (eco-ui):** the tab strip scrolls itself only. HR-System must re-copy the kit. **Lesson:** `scrollIntoView` is not local.

## Phase B2 — Quality: codes, plans, inspections, holds, repair, yield (2026-09-28)
- **What:** `qms` module (ADR-035) — defect and repair codes, inspection plans with limits and AQL, append-only hash-chained
  inspections, ISO 2859-1 sampling, holds on a unit / serial list / work order / material lot / pallet with a recall count,
  releases signed with the person's password (new `sys` service: electronic signature and audit), repair with part
  replacement (genealogy keeps the removed part), first-pass yield / rolled throughput yield and Pareto from the unit history.
  Screens QMS1010, QMS1020, QMS2010, QMS2020, QMS2030 (new: repair), QMS4010. 8 tests, 9 planted bugs.
- **Symptom (found in the browser):** after adding the quality screens the whole application stayed blank on the sign-in
  page. **Cause:** one missing parenthesis in QMS2010; a JavaScript module with a syntax error fails to load, and the shell
  imports every screen, so ONE bad screen blanks everything. The screen tests read the files as text and never parsed them.
  **Fix:** a test parses every screen file as a module; a planted bug breaks a screen's syntax and must be caught.
  **Lesson:** in a no-build front end the parser is the compiler: test that the code parses, not only what it contains.
- **Discovery:** the first quality tests failed on serial numbers like "T01": the tracking module requires 4-40 characters
  (a scanner misread of 3 characters is more likely than a real serial). Kept; tests use realistic serials.

## Phase B3 — Packing, pallets, shipping orders, container loading (2026-09-28)
- **What:** `shp` module (ADR-036): packing specifications, palletizing (auto-close when full, unpack with reason), shipping
  orders, containers with ISO 6346 check digits, loading checks (closed, OQC passed, not held, ordered, room left), sealing
  and dispatch; new contract `mes.shipment.dispatched.v1` (additive; `link-mizan` skips it today with `eco.not_consumed`,
  checked). Screens SHP1010, SHP2010 (palletizing station), SHP2020, SHP2030 (loading dock), SHP3010 (shipments, packing
  list). Traceability now answers "which container, which customer" for any serial or lot. 4 tests, planted bugs.
- **Discovery:** zod 4's `z.record(z.enum(...), …)` requires EVERY key of the enum; a packing specification naming only the
  container types a plant uses was refused. **Fix:** `z.partialRecord`. **Lesson:** read the validation library's semantics
  for maps; exhaustive and partial records are different types.
- **Discovery:** "finished goods waiting" listed main boards (finished at SMD but components, never shipped on their own).
  **Fix:** only products with a packing specification are finished goods for shipping.

## Phase B4 — OEE, reports, handover, labels, plant board, system screens (2026-09-28)
- **What:** OEE per ISO 22400 from the facts (ADR-037) with the plant's own stop reasons; `rpt` module (daily production,
  scrap and rework, shift handover with append-only notes and a signed receipt); `lbl` module (ZPL templates, printers on
  TCP 9100, print and reprint-with-reason log, browser preview with Code 128); backups with a rehearsal (`ops.ts`); device
  keys. Screens OEE2010, OEE4010, OEE4020, RPT4010, RPT4020, RPT4030, LBL1010, LBL2010, DSH5020, SYS9020, SYS9030, SYS9040,
  SYS9060, SYS9070, SYS9090, SYS9100; the line board shows real OEE. 9 tests, 10 planted bugs.
- **Symptom:** the first OEE of the floor test gave 24 minutes of downtime for a 12-minute stop. **Cause:** the line and one
  of its stations were stopped over the same minutes, and each stoppage was added on its own. **Fix:** downtime is the union
  of the stop intervals; a planned stop wins over an unplanned one at the same moment. **Lesson:** time is not additive
  across overlapping records — any duration summed from facts must be merged first.
- **Discovery:** the old floor test asserted "no OEE until cycle times exist"; the line there HAS a capacity (800 per shift),
  which is a known pace, so OEE is knowable and is now asserted exactly (A 95.2 %, P 1.3 %, Q 80 %).
- **Symptom (parse test):** RPT4010 failed to parse with one parenthesis too many. **Cause:** a nested element tree written by
  hand. **Fix:** counted per line and corrected; the parse test caught it before any browser did. **Lesson:** the parse test
  earned its keep on its first day.
- **Discovery:** `VACUUM INTO` works on the read-only connection: it copies the committed snapshot and never blocks the
  single writer, so a backup does not stop the line.
- **Discovery:** a test cannot `import` a `.js` browser module from a package without `"type": "module"` (Node reads it as
  CommonJS); the barcode test loads the screen file as the browser does, through a `data:` URL, so it tests the real file.

## Follow-up — the station is kept, and a screen hears "activated" once (2026-09-28, review of PR #3)
- **Symptom (review):** a booking checked the person's qualification at a station, then forgot the station: the ledger
  line and the published fact did not carry it, so nobody could later see where the work was done or audit the check.
  **Cause:** `station` was added to the command for the check only. **Fix:** ledger column `station_code` (migration
  `004_ledger_station`, after B1's `003_routing_bom`) and an optional `station` in the four production facts (additive: same `v1`). **Lesson:** a value a
  decision was based on is part of the fact; record it with the fact.
- **Discovery:** the ledger's hash chain covers a fixed field list; adding a field to it would have changed the hash of
  every line already written and made `verify()` call the whole history tampered. **Fix:** fields added later join the hash
  only when set (`LATER_FIELDS` in `exe/ledger.ts`), so a line without a station hashes exactly as before, and a station,
  once written, is sealed. A test pins the old formula. **Lesson:** a new field in a hash chain must not change old links.
- **Symptom (review, confirmed in a real browser):** opening a screen called its `onActivate` twice (B: 2 on open, 3 after
  one return). **Cause:** `activate()` called it right after the build, and so did the promise that shows the built screen.
  **Fix:** an entry is `ready` only once shown; `activate()` calls `onActivate` only for a ready screen. Now 1, then 2.
  **Lesson:** when two paths can finish one job, give the job to exactly one of them. HR-System must re-copy the kit.
- 4 new planted bugs (station in ledger, station in fact, old hashes unchanged, one activation).


## Follow-up — the operator station fits a ceramic line (2026-09-30, the ceramic pitch)
- **Symptom:** preparing a demo for a ceramic-tile factory, the operator station (EXE2020) could not record a tile
  line's day. A tile work order with a routing opened in unit-by-unit (serial) mode although tiles are a lot item; the
  "Good ×N" button refused a lot item ("scan the lot") with no way to give the lot, so the shade/caliber lot could only
  be booked one piece per scan; scrap was one piece per press, with electronics and moulding reasons only.
- **Cause:** the screen chose serial mode from `routing_id` alone, while the server refuses a quantity booking only for
  a serialised item on a routing (`wo.unit_tracked`); the quantity dialog asked for the quantity only; scrap reasons
  are lists per area code and there was no ceramic list.
- **Fix:** serial mode only when the item is serialised (the server's own rule); "Good ×N" asks for the lot after the
  quantity when the item is tracked; the scrap dialog carries a quantity (1 unless changed); a ceramic list for area
  `CER` (kiln crack, lamination, shade, caliber, chipped edge, downgraded to second grade). Texts in both languages.
  Test: every scrap reason of every list has a name in both languages, and the serial rule matches the server's.
  Two planted bugs (the old serial rule; a missing reason name) are caught.
- **Lesson:** a screen that decides a mode must use the same rule as the server that enforces it; here the server was
  right and the screen had a simpler, wrong copy. Lists shown as `t("scrap." + code)` escape the static "every key
  exists" test: dynamic keys need their own test.
