import type { UnitRow } from '../../contracts/services.js';
import { chainAppend } from '../../kernel/chain.js';
import type { Db } from '../../kernel/db.js';
import type { Caller, Ctx } from '../../kernel/modules.js';
import { productionDate } from '../../kernel/clock.js';
import { conflict } from '../../kernel/errors.js';

/**
 * The unit history: every fact about a serial unit (created, passed an operation, failed a test, repaired, scrapped,
 * completed, assembled into another unit, held, released, packed, shipped) and every material load on a station, as
 * one append-only hash-chained table. `trk_unit`, `trk_genealogy` and the load counters are projections of it.
 */
export const EVENT_KINDS = ['CREATE', 'PASS', 'FAIL', 'REPAIR', 'SCRAP', 'COMPLETE', 'ATTACH', 'HOLD', 'RELEASE', 'PACK', 'UNPACK', 'SHIP', 'LOAD', 'UNLOAD'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const EVENT_FIELDS = ['seq', 'id', 'kind', 'unit_id', 'serial', 'work_order_id', 'item_id', 'line_code', 'station', 'op_seq', 'op_code',
  'defect_code', 'detail', 'user_name', 'person_id', 'production_date', 'shift_code', 'occurred_at', 'command_id'] as const;

export const trkMigration = {
  id: '001_units',
  up: `
    CREATE TABLE trk_event (
      seq             INTEGER PRIMARY KEY,
      id              TEXT NOT NULL UNIQUE,
      kind            TEXT NOT NULL CHECK (kind IN (${EVENT_KINDS.map((k) => `'${k}'`).join(', ')})),
      unit_id         TEXT,
      serial          TEXT,
      work_order_id   TEXT,
      item_id         TEXT,
      line_code       TEXT,
      station         TEXT,
      op_seq          INTEGER,
      op_code         TEXT,
      defect_code     TEXT,
      detail          TEXT,
      user_name       TEXT NOT NULL,
      person_id       TEXT,
      production_date TEXT NOT NULL,
      shift_code      TEXT,
      occurred_at     TEXT NOT NULL,
      command_id      TEXT NOT NULL,
      prev_hash       TEXT NOT NULL,
      hash            TEXT NOT NULL
    );
    CREATE INDEX trk_event_unit ON trk_event(unit_id, seq);
    CREATE INDEX trk_event_day ON trk_event(production_date, kind);
    CREATE INDEX trk_event_station ON trk_event(station, occurred_at);
    CREATE INDEX trk_event_wo ON trk_event(work_order_id, kind);
    CREATE TRIGGER trk_event_immutable BEFORE UPDATE ON trk_event BEGIN SELECT RAISE(ABORT, 'trk: the unit history is append-only'); END;
    CREATE TRIGGER trk_event_no_delete BEFORE DELETE ON trk_event BEGIN SELECT RAISE(ABORT, 'trk: the unit history is append-only'); END;

    CREATE TABLE trk_unit (
      id            TEXT PRIMARY KEY,
      serial        TEXT NOT NULL UNIQUE,
      item_id       TEXT NOT NULL,
      work_order_id TEXT NOT NULL,
      line_code     TEXT NOT NULL,
      status        TEXT NOT NULL CHECK (status IN ('wip', 'repair', 'completed', 'scrapped', 'consumed', 'packed', 'shipped')),
      op_seq        INTEGER,
      op_code       TEXT,
      last_station  TEXT,
      held          INTEGER NOT NULL DEFAULT 0 CHECK (held >= 0),
      fail_op_seq   INTEGER,
      parent_id     TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      completed_at  TEXT,
      version       INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX trk_unit_wo ON trk_unit(work_order_id, status);
    CREATE INDEX trk_unit_line ON trk_unit(line_code, status, op_seq);
    CREATE INDEX trk_unit_parent ON trk_unit(parent_id);

    -- what went into a unit: another unit (a key part with its own serial) or a material lot loaded on the station
    CREATE TABLE trk_genealogy (
      parent_id     TEXT NOT NULL,
      child_id      TEXT,
      kind          TEXT NOT NULL CHECK (kind IN ('unit', 'part', 'lot')),   -- a unit made here, a bought-in serial part, a material lot
      item_id       TEXT NOT NULL,
      lot_no        TEXT,
      qty           INTEGER NOT NULL,
      op_code       TEXT NOT NULL,
      station       TEXT NOT NULL,
      verified      INTEGER NOT NULL,
      event_seq     INTEGER NOT NULL,
      at            TEXT NOT NULL
    );
    CREATE INDEX trk_gen_parent ON trk_genealogy(parent_id);
    CREATE INDEX trk_gen_child ON trk_genealogy(child_id);
    CREATE INDEX trk_gen_lot ON trk_genealogy(item_id, lot_no);

    -- a material lot loaded on a station (a reel on a feeder, a pallet of back covers at the line side)
    CREATE TABLE trk_load (
      id           TEXT PRIMARY KEY,
      station      TEXT NOT NULL,
      line_code    TEXT NOT NULL,
      item_id      TEXT NOT NULL,
      lot_no       TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      verified     INTEGER NOT NULL,
      loaded_at    TEXT NOT NULL,
      loaded_by    TEXT NOT NULL,
      unloaded_at  TEXT,
      unloaded_by  TEXT
    );
    CREATE UNIQUE INDEX trk_load_one_open ON trk_load(station, item_id) WHERE unloaded_at IS NULL;
    -- how many units of each work order took material from a load (its consumption is booked when it is unloaded)
    CREATE TABLE trk_load_use (
      load_id       TEXT NOT NULL,
      work_order_id TEXT NOT NULL,
      units         INTEGER NOT NULL,
      qty           INTEGER NOT NULL,
      booked        INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (load_id, work_order_id)
    );

    -- supplier lots registered here (only when manufacturing owns its materials; else they come from accounting)
    CREATE TABLE trk_material_lot (
      item_id      TEXT NOT NULL,
      lot_no       TEXT NOT NULL,
      supplier     TEXT,
      supplier_lot TEXT,
      qty          INTEGER NOT NULL CHECK (qty > 0),
      expires_on   TEXT,
      received_at  TEXT NOT NULL,
      received_by  TEXT NOT NULL,
      PRIMARY KEY (item_id, lot_no)
    );
  `,
};

export const trkMigration2 = {
  id: '002_part_replacement',
  up: `
    -- a key part replaced at repair: the old genealogy row stays (history), marked removed by the repair fact
    ALTER TABLE trk_genealogy ADD COLUMN removed_seq INTEGER;
  `,
};

export interface EventIn {
  kind: EventKind;
  unit?: { id: string; serial: string; work_order_id: string; item_id: string; line_code: string } | null;
  station?: string | null;
  line_code?: string | null;
  work_order_id?: string | null;
  item_id?: string | null;
  op_seq?: number | null;
  op_code?: string | null;
  defect_code?: string | null;
  detail?: Record<string, unknown> | null;
  commandId: string;
  productionDate?: string;
  shift?: string;
  person?: { id: string } | undefined;
}

export const today = (ctx: Ctx) => productionDate(ctx.clock.now(), ctx.config.timeZone, ctx.config.productionDayStart);

export async function event(ctx: Ctx, t: Db, caller: Caller, e: EventIn): Promise<number> {
  return chainAppend(t, 'trk_event', EVENT_FIELDS, {
    id: ctx.clock.newId(), kind: e.kind, unit_id: e.unit?.id ?? null, serial: e.unit?.serial ?? null,
    work_order_id: e.work_order_id ?? e.unit?.work_order_id ?? null, item_id: e.item_id ?? e.unit?.item_id ?? null,
    line_code: e.line_code ?? e.unit?.line_code ?? null, station: e.station ?? null, op_seq: e.op_seq ?? null, op_code: e.op_code ?? null,
    defect_code: e.defect_code ?? null, detail: e.detail ? JSON.stringify(e.detail) : null, user_name: caller.name, person_id: e.person?.id ?? null,
    production_date: e.productionDate ?? today(ctx), shift_code: e.shift ?? null, occurred_at: ctx.clock.now().toISOString(), command_id: e.commandId,
  });
}

/** Optimistic write of the unit projection: a unit changed by another command meanwhile is refused, never overwritten. */
export async function setUnit(ctx: Ctx, t: Db, u: UnitRow, set: Partial<Pick<UnitRow, 'status' | 'op_seq' | 'op_code' | 'last_station' | 'held' | 'fail_op_seq' | 'parent_id' | 'completed_at'>>) {
  const next = { ...u, ...set };
  const r = await t.run(`UPDATE trk_unit SET status = ?, op_seq = ?, op_code = ?, last_station = ?, held = ?, fail_op_seq = ?, parent_id = ?, completed_at = ?,
    updated_at = ?, version = version + 1 WHERE id = ? AND version = ?`,
  [next.status, next.op_seq, next.op_code, next.last_station, next.held, next.fail_op_seq, next.parent_id, next.completed_at, ctx.clock.now().toISOString(), u.id, u.version]);
  if (r.changes !== 1) conflict('unit.changed', `unit ${u.serial} changed meanwhile; scan it again`);
  Object.assign(u, next, { version: u.version + 1 });
}
