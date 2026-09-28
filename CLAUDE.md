# Rules for anyone (human or AI) changing this repository

This is the **manufacturing piece** of an ecosystem of products sold to small and mid-sized factories:
Mizan (accounting, `coolman1984/Accounting-sys`), Space Planner (3D layout, `coolman1984/3D-Modeling`),
HR-System (people, shifts, attendance, payroll data, `coolman1984/HR-System`), and the G-MES automation knowledge
base (`coolman1984/opening-nerp-tcode`). BAMS (`coolman1984/Mr.Ayman-HR`) is a separate product, not HR.
Read `README.md`, then `docs/ecosystem/02-truth-ownership.md` and `docs/adr/README.md` before any structural change.

## Never
- Read or write another application's database. Integration is `@eco/contracts` events over HTTP only.
- Create master data owned by another app (items, warehouses when Mizan owns them; employees, shifts, attendance — always HR). No "temporary" copies.
- Merge production facts from several writers (BAMS-style counters). One plant server owns the ledger (ADR-015).
- Store or compute a money value in manufacturing. Cost belongs to accounting (a test enforces it).
- Round a quantity silently. Refuse what cannot be carried exactly (ADR-018).
- UPDATE or DELETE a ledger line or a published event. Corrections are new facts.
- Change a published contract in place. Additive change = same version; breaking change = new `vN`.
- Import code from the G-MES automation project into the product.

## Structure
| Path | What |
|---|---|
| `packages/eco-contracts` | Ecosystem contracts (zod) → generated JSON Schemas in `schemas/` (run `npm run schemas`) |
| `apps/mes-server` | Manufacturing kernel: `kernel/` (db port, commands, clock, hash-chained fact tables), `contracts/` (sockets between modules), `modules/` (system, mdm, eng, eco, oee, exe, trk, …) |
| `apps/mes-web` | The screens (`screens/<CODE>.js`, shared builders in `views.js`), served by `mes-server` (`src/web.ts`); every screen reads the server |
| `packages/eco-ui` | The ecosystem's one interface kit (tokens, shell, grid, dialogs); HR-System copies it unchanged (ADR-029) |
| `apps/link-mizan` | Mizan's agent: mirrors items/warehouses, applies manufacturing facts through Mizan's existing API |
| `Start-GMES.bat` → `scripts/start.ps1` | One-click start: checks Node, installs, creates `data/config.json`, starts the server, opens the browser (ADR-031) |
| `scripts/new-key.ps1` | Creates an API key (printed once, stored as a hash) |
| `scripts/test.ps1` | The definition of done in one command (typecheck, all tests against the pinned real apps, planted bugs) |
| `scripts/fetch-mizan.ps1` | The pinned real Mizan the end-to-end tests run against |
| `scripts/fetch-hr.ps1` | The pinned real HR-System (Python) the HR end-to-end test runs against |
| `scripts/mutations.mjs` | Planted bugs every test run must catch |

A module imports only `kernel/`, `contracts/`, `@eco/contracts` and its own folder (`test/boundaries.test.ts`).

## Definition of done
1. `npm run typecheck` and `npm test` pass — with `ECO_E2E_REQUIRED=1`, a Mizan checkout (`scripts/fetch-mizan.ps1`) and an HR-System checkout (`scripts/fetch-hr.ps1`, needs Python 3.10+). `scripts/test.ps1` does all of it.
2. `node scripts/mutations.mjs` reports every planted bug caught; a new rule gets a new mutation.
3. `HISTORY.md` entry (Symptom / Cause / Fix / Lesson) for every bug or discovery, in the same commit.
4. An ADR in `docs/adr/README.md` for every structural choice, with the alternatives rejected.
5. Ecosystem docs (`docs/ecosystem/*`) updated when ownership, contracts, ids or scenarios change.
6. Never touch the other repositories from here; propose changes there, in their own rules.
7. Tooling is PowerShell only (`.ps1`, plus the `.bat` that merely calls it). No `.sh` scripts: the owner works on Windows.
