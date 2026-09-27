# Rules for anyone (human or AI) changing this repository

This is the **manufacturing piece** of an ecosystem of products sold to small and mid-sized factories:
Mizan (accounting, `coolman1984/Accounting-sys`), Space Planner (3D layout, `coolman1984/3D-Modeling`),
a future people/HR app, and the G-MES automation knowledge base (`coolman1984/opening-nerp-tcode`).
Read `README.md`, then `docs/ecosystem/02-truth-ownership.md` and `docs/adr/README.md` before any structural change.

## Never
- Read or write another application's database. Integration is `@eco/contracts` events over HTTP only.
- Create master data owned by another app (items, warehouses when Mizan owns them). No "temporary" copies.
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
| `apps/mes-server` | Manufacturing kernel: `kernel/` (db port, commands, clock), `contracts/` (sockets between modules), `modules/` (system, mdm, eco, exe) |
| `apps/link-mizan` | Mizan's agent: mirrors items/warehouses, applies manufacturing facts through Mizan's existing API |
| `scripts/fetch-mizan.sh` | The pinned real Mizan the end-to-end tests run against |
| `scripts/mutations.mjs` | Planted bugs every test run must catch |

A module imports only `kernel/`, `contracts/`, `@eco/contracts` and its own folder (`test/boundaries.test.ts`).

## Definition of done
1. `npm run typecheck` and `npm test` pass — with `ECO_E2E_REQUIRED=1` and a Mizan checkout (`sh scripts/fetch-mizan.sh`).
2. `node scripts/mutations.mjs` reports every planted bug caught; a new rule gets a new mutation.
3. `HISTORY.md` entry (Symptom / Cause / Fix / Lesson) for every bug or discovery, in the same commit.
4. An ADR in `docs/adr/README.md` for every structural choice, with the alternatives rejected.
5. Ecosystem docs (`docs/ecosystem/*`) updated when ownership, contracts, ids or scenarios change.
6. Never touch the other repositories from here; propose changes there, in their own rules.
