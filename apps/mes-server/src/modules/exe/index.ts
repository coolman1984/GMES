import { z } from 'zod';
import { formatQty, parseQty, QuantityError } from '@eco/contracts';
import type { ExeService, MirrorItem } from '../../contracts/services.js';
import { productionDate } from '../../kernel/clock.js';
import { runCommand } from '../../kernel/commands.js';
import type { Db } from '../../kernel/db.js';
import { AppError, conflict, fail, notFound } from '../../kernel/errors.js';
import type { AppModule, Caller, Ctx } from '../../kernel/modules.js';
import { boardRoutes } from './boards.js';
import { append, verify, type TxnType } from './ledger.js';

/**
 * Execution core: work orders and the facts of production (consume, complete, scrap, close).
 *
 * Each command, in ONE transaction: validates → appends a ledger line → updates the work order
 * (a projection of the ledger) → publishes the matching eco event. Quantities are integers in
 * thousandths (ADR-018). Conservation is enforced: completed + scrapped never exceeds planned.
 * Manufacturing never values anything: cost belongs to accounting.
 */

const zQty = z.string().transform((v, c) => {
  try {
    const n = parseQty(v);
    if (n <= 0) throw new QuantityError('qty.range', 'must be greater than zero');
    return n;
  } catch (e) {
    if (!(e instanceof QuantityError)) throw e;
    c.addIssue({ code: 'custom', message: `${e.code}: ${e.message}` });
    return z.NEVER;
  }
});
const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const zPerson = z.object({ id: z.string().uuid(), code: z.string().min(1).max(64) }).optional();
const zOperational = {
  commandId: z.string(),
  productionDate: zDate.optional(),
  shift: z.string().min(1).max(20).optional(),
  person: zPerson,
  /** The station where the work is booked: its skill requirements are checked against HR's qualifications. */
  station: z.string().trim().min(1).max(64).optional(),
};

const zCreate = z.object({
  ...zOperational, code: z.string().trim().min(1).max(40).optional(), itemId: z.string(), plannedQty: zQty, warehouseId: z.string(),
  /** The line it runs on (a line of the plant model) and its priority (1 highest). */
  line: z.string().trim().min(1).max(40).optional(), priority: z.number().int().min(1).max(3).optional(),
  dueDate: zDate.optional(),
});
type CreateInput = z.infer<typeof zCreate> & { plannedOrderId?: string; pegging?: unknown };

/** Releases a work order (the route and planning both come here), inside the caller's transaction. */
async function createWorkOrder(ctx: Ctx, t: Db, caller: Caller, input: CreateInput): Promise<{ id: string; code: string }> {
  input.person = await ctx.services.get('mdm').resolvePerson(t, input.person, { station: input.station, date: input.productionDate ?? today(ctx) });
  const mdm = ctx.services.get('mdm');
  const item = await mdm.item(input.itemId, t);
  if (!item.active) fail('item.inactive', `item ${item.code} is not active`);
  if (item.kind !== 'product') fail('item.not_product', `a service (${item.code}) cannot be produced`);
  const wh = await mdm.warehouse(input.warehouseId, t);
  if (!wh.active) fail('warehouse.inactive', `warehouse ${wh.code} is not active`);
  const id = ctx.clock.newId();
  const code = input.code ?? (await nextCode(t));
  if (await t.get('SELECT 1 FROM exe_work_order WHERE code = ?', [code])) conflict('wo.code_taken', `work order ${code} exists`);
  const pdate = input.productionDate ?? today(ctx);
  if (input.line) {
    const line = await mdm.plantNode(input.line, t);
    if (!line || line.type !== 'line') fail('line.unknown', `${input.line} is not a line of the plant model`);
    if (!line!.active) conflict('line.inactive', `line ${input.line} is inactive`);
  }
  // the approved engineering of the moment is frozen into the order (a later revision never changes a running order)
  const eng = ctx.services.has('eng') ? ctx.services.get('eng') : null;
  const routing = eng ? await eng.approvedRouting(item.id, t) : undefined;
  const bom = eng ? await eng.approvedBom(item.id, t) : undefined;
  if (routing && !input.line) fail('wo.line_required', `${item.code} follows a routing: say on which line it runs`);
  await t.run(
    `INSERT INTO exe_work_order (id, code, item_id, warehouse_id, planned_qty, status, production_date, created_at, line_code, shift_code, priority, routing_id, bom_id, due_date, planned_order_id, pegging)
     VALUES (?, ?, ?, ?, ?, 'released', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, code, item.id, wh.id, input.plannedQty, pdate, ctx.clock.now().toISOString(), input.line ?? null, input.shift ?? null, input.priority ?? 2,
      routing?.id ?? null, bom?.id ?? null, input.dueDate ?? null, input.plannedOrderId ?? null, input.pegging === undefined ? null : JSON.stringify(input.pegging)],
  );
  await line(ctx, t, caller, 'RELEASE', input, { work_order_id: id, item_id: item.id, warehouse_id: wh.id, qty: input.plannedQty, production_date: pdate });
  return { id, code };
}
const zConsume = z.object({ ...zOperational, itemId: z.string(), qty: zQty, warehouseId: z.string(), lotNo: z.string().trim().min(1).max(64).optional() });
const zComplete = z.object({ ...zOperational, qty: zQty, lotNo: z.string().trim().min(1).max(64).optional() });
const zScrap = z.object({ ...zOperational, qty: zQty, reasonCode: z.string().trim().min(1).max(40) });
const zClose = z.object({ ...zOperational });

export interface WorkOrderRow {
  id: string;
  code: string;
  item_id: string;
  warehouse_id: string;
  planned_qty: number;
  completed_qty: number;
  scrapped_qty: number;
  status: 'released' | 'completed' | 'closed';
  production_date: string;
  version: number;
  line_code: string | null;
  shift_code: string | null;
  priority: number;
  routing_id: string | null;
  bom_id: string | null;
  created_at: string;
}

export const exeModule: AppModule = {
  id: 'exe',
  dependsOn: ['system', 'mdm', 'eco'],
  scopes: ['exe.orders.read', 'exe.orders.write', 'exe.ledger.read'],
  migrations: [
    {
      id: '001_work_orders_ledger',
      up: `
        CREATE TABLE exe_work_order (
          id              TEXT PRIMARY KEY,
          code            TEXT NOT NULL UNIQUE,
          item_id         TEXT NOT NULL REFERENCES mdm_item(id),
          warehouse_id    TEXT NOT NULL REFERENCES mdm_warehouse(id),
          planned_qty     INTEGER NOT NULL CHECK (planned_qty > 0),
          completed_qty   INTEGER NOT NULL DEFAULT 0 CHECK (completed_qty >= 0),
          scrapped_qty    INTEGER NOT NULL DEFAULT 0 CHECK (scrapped_qty >= 0),
          status          TEXT NOT NULL CHECK (status IN ('released', 'completed', 'closed')),
          production_date TEXT NOT NULL,
          version         INTEGER NOT NULL DEFAULT 1,
          created_at      TEXT NOT NULL,
          CHECK (completed_qty + scrapped_qty <= planned_qty)          -- conservation, enforced by the database too
        );

        CREATE TABLE exe_ledger (
          seq             INTEGER PRIMARY KEY,
          id              TEXT NOT NULL UNIQUE,
          txn_type        TEXT NOT NULL CHECK (txn_type IN ('RELEASE', 'CONSUME', 'COMPLETE', 'SCRAP', 'CLOSE')),
          command_id      TEXT NOT NULL,
          work_order_id   TEXT NOT NULL REFERENCES exe_work_order(id),
          item_id         TEXT,
          warehouse_id    TEXT,
          qty             INTEGER NOT NULL,
          lot_no          TEXT,
          reason_code     TEXT,
          user_name       TEXT NOT NULL,
          person_id       TEXT,
          production_date TEXT NOT NULL,
          shift_code      TEXT,
          occurred_at     TEXT NOT NULL,
          prev_hash       TEXT NOT NULL,
          hash            TEXT NOT NULL
        );
        CREATE INDEX exe_ledger_wo ON exe_ledger(work_order_id, seq);
        CREATE TRIGGER exe_ledger_immutable BEFORE UPDATE ON exe_ledger
        BEGIN SELECT RAISE(ABORT, 'exe: the production ledger is append-only'); END;
        CREATE TRIGGER exe_ledger_no_delete BEFORE DELETE ON exe_ledger
        BEGIN SELECT RAISE(ABORT, 'exe: the production ledger is append-only'); END;
      `,
    },
    {
      id: '002_line_shift_priority',
      up: `
        -- where and when a work order is planned to run (the plant model's line code, the shift, 1 = highest priority)
        ALTER TABLE exe_work_order ADD COLUMN line_code TEXT;
        ALTER TABLE exe_work_order ADD COLUMN shift_code TEXT;
        ALTER TABLE exe_work_order ADD COLUMN priority INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3);
        CREATE INDEX exe_work_order_day ON exe_work_order(production_date);
        CREATE INDEX exe_work_order_line ON exe_work_order(line_code, status);
      `,
    },
    {
      id: '003_routing_bom',
      up: `
        -- the APPROVED engineering revisions the order was released with (frozen revisions: the reference is the snapshot)
        ALTER TABLE exe_work_order ADD COLUMN routing_id TEXT;
        ALTER TABLE exe_work_order ADD COLUMN bom_id TEXT;
        CREATE INDEX exe_ledger_day ON exe_ledger(production_date, txn_type);
      `,
    },
    {
      id: '004_ledger_station',
      up: `
        -- the station where the work was booked (its qualification was checked there); older lines have none
        ALTER TABLE exe_ledger ADD COLUMN station_code TEXT;
      `,
    },
    {
      id: '005_plan_link',
      up: `
        -- the date the order must be finished (from planning) and the planned order it was released from
        ALTER TABLE exe_work_order ADD COLUMN due_date TEXT;
        ALTER TABLE exe_work_order ADD COLUMN planned_order_id TEXT;
        ALTER TABLE exe_work_order ADD COLUMN pegging TEXT;
      `,
    },
  ],

  setup(ctx) {
    const service: ExeService = {
      workOrder: async (id, t) => (await (t ?? ctx.db).get<WorkOrderRow>('SELECT * FROM exe_work_order WHERE id = ?', [id])) ?? notFound('work_order', id),
      workOrderByCode: async (code, t) => (t ?? ctx.db).get<WorkOrderRow>('SELECT * FROM exe_work_order WHERE code = ?', [code]),
      complete: (t, caller, id, input) => complete(ctx, t, caller, id, input),
      scrap: (t, caller, id, input) => scrap(ctx, t, caller, id, input),
      consume: (t, caller, id, input) => consume(ctx, t, caller, id, input),
      create: (t, caller, input) => createWorkOrder(ctx, t, caller, { ...input, plannedQty: input.qty }),
    };
    ctx.services.provide('exe', service);
  },

  routes(kit, ctx) {
    const { http, require } = kit;
    boardRoutes(kit, ctx);

    // The work orders of a period, with what the ledger says about each (the inquiry screen EXE3010).
    http.get('/api/work-orders', async (req) => {
      require(req, 'exe.orders.read');
      const q = z.object({
        from: zDate.optional(), to: zDate.optional(), status: z.enum(['released', 'completed', 'closed']).optional().or(z.literal('')),
        line: z.string().optional(), item: z.string().optional(), code: z.string().optional(), shift: z.string().optional(),
      }).parse(req.query);
      const where: string[] = [];
      const params: string[] = [];
      if (q.from) { where.push('w.production_date >= ?'); params.push(q.from); }
      if (q.to) { where.push('w.production_date <= ?'); params.push(q.to); }
      if (q.status) { where.push('w.status = ?'); params.push(q.status); }
      if (q.line) { where.push('w.line_code = ?'); params.push(q.line); }
      if (q.shift) { where.push('w.shift_code = ?'); params.push(q.shift); }
      if (q.code) { where.push('w.code LIKE ?'); params.push('%' + q.code.trim() + '%'); }
      const rows = await ctx.db.all<WorkOrderRow & { first_at: string | null; last_at: string | null }>(
        `SELECT w.*, (SELECT MIN(occurred_at) FROM exe_ledger l WHERE l.work_order_id = w.id AND l.txn_type IN ('COMPLETE', 'SCRAP', 'CONSUME')) first_at,
                (SELECT MAX(occurred_at) FROM exe_ledger l WHERE l.work_order_id = w.id AND l.txn_type IN ('COMPLETE', 'SCRAP', 'CLOSE')) last_at
         FROM exe_work_order w ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY w.production_date DESC, w.code DESC LIMIT 5001`, params);
      if (rows.length > 5000) fail('query.too_wide', 'More than 5000 work orders match: narrow the production days or add a condition');
      const mdm = ctx.services.get('mdm');
      const items = new Map<string, MirrorItem>();
      for (const r of rows) if (!items.has(r.item_id)) items.set(r.item_id, await mdm.item(r.item_id));
      const text = (q.item ?? '').trim().toLowerCase();
      return rows
        .filter((r) => { const i = items.get(r.item_id)!; return !text || (i.code + ' ' + i.name_en + ' ' + i.name_ar).toLowerCase().includes(text); })
        .map((r) => { const i = items.get(r.item_id)!; return { ...present(r), item: { id: i.id, code: i.code, name_en: i.name_en, name_ar: i.name_ar, uom: i.base_uom, tracking: i.tracking }, first_at: r.first_at, last_at: r.last_at }; });
    });

    http.post('/api/work-orders', async (req) => {
      const caller = require(req, 'exe.orders.write');
      const input = zCreate.parse(req.body);
      const { result, replayed } = await runCommand(ctx, caller, { id: input.commandId, type: 'CreateWorkOrder', request: req.body }, (t) => createWorkOrder(ctx, t, caller, input));
      return { ...result, replayed };
    });

    http.get('/api/work-orders/:id', async (req) => {
      require(req, 'exe.orders.read');
      const { id } = req.params as { id: string };
      const wo = await ctx.db.get<WorkOrderRow>('SELECT * FROM exe_work_order WHERE id = ?', [id]);
      if (!wo) return notFound('work_order', id);
      const lines = await ctx.db.all('SELECT seq, txn_type, item_id, warehouse_id, qty, lot_no, reason_code, user_name, person_id, production_date, shift_code, station_code, occurred_at FROM exe_ledger WHERE work_order_id = ? ORDER BY seq', [id]);
      return { ...present(wo), ledger: lines.map((l: any) => ({ ...l, qty: formatQty(l.qty) })) };
    });

    http.post('/api/work-orders/:id/consume', async (req) => {
      const caller = require(req, 'exe.orders.write');
      const { id } = req.params as { id: string };
      const input = zConsume.parse(req.body);
      const { result, replayed } = await runCommand(ctx, caller, { id: input.commandId, type: 'ConsumeMaterial', request: { id, ...(req.body as object) } }, async (t) => {
        input.person = await ctx.services.get('mdm').resolvePerson(t, input.person, { station: input.station, date: input.productionDate ?? today(ctx) });
        return consume(ctx, t, caller, id, input);
      });
      return { ...result, replayed };
    });

    http.post('/api/work-orders/:id/complete', async (req) => {
      const caller = require(req, 'exe.orders.write');
      const { id } = req.params as { id: string };
      const input = zComplete.parse(req.body);
      const { result, replayed } = await runCommand(ctx, caller, { id: input.commandId, type: 'ReportCompletion', request: { id, ...(req.body as object) } }, async (t) => {
        input.person = await ctx.services.get('mdm').resolvePerson(t, input.person, { station: input.station, date: input.productionDate ?? today(ctx) });
        const wo = await openOrder(t, id);
        if (wo.routing_id && ctx.services.has('trk') && (await ctx.services.get('mdm').item(wo.item_id, t)).tracking === 'serial') {
          conflict('wo.unit_tracked', `${wo.code} follows a routing unit by unit: its output is booked by scanning each serial at its stations`);
        }
        return complete(ctx, t, caller, id, input);
      });
      return { ...result, replayed };
    });

    http.post('/api/work-orders/:id/scrap', async (req) => {
      const caller = require(req, 'exe.orders.write');
      const { id } = req.params as { id: string };
      const input = zScrap.parse(req.body);
      const { result, replayed } = await runCommand(ctx, caller, { id: input.commandId, type: 'RecordScrap', request: { id, ...(req.body as object) } }, async (t) => {
        input.person = await ctx.services.get('mdm').resolvePerson(t, input.person, { station: input.station, date: input.productionDate ?? today(ctx) });
        return scrap(ctx, t, caller, id, input);
      });
      return { ...result, replayed };
    });

    http.post('/api/work-orders/:id/close', async (req) => {
      const caller = require(req, 'exe.orders.write');
      const { id } = req.params as { id: string };
      const input = zClose.parse(req.body);
      const { result, replayed } = await runCommand(ctx, caller, { id: input.commandId, type: 'CloseWorkOrder', request: { id, ...(req.body as object) } }, async (t) => {
        input.person = await ctx.services.get('mdm').resolvePerson(t, input.person, { station: input.station, date: input.productionDate ?? today(ctx) });
        const wo = await t.get<WorkOrderRow>('SELECT * FROM exe_work_order WHERE id = ?', [id]);
        if (!wo) return notFound('work_order', id);
        if (wo.status === 'closed') conflict('wo.closed', `work order ${wo.code} is already closed`);
        const product = await ctx.services.get('mdm').item(wo.item_id, t);
        await bump(t, wo, { status: 'closed' });
        const pdate = input.productionDate ?? today(ctx);
        const seq = await line(ctx, t, caller, 'CLOSE', input, { work_order_id: wo.id, item_id: product.id, warehouse_id: null, qty: 0, production_date: pdate });
        const ev = await ctx.services.get('eco').publish(t, {
          type: 'mes.work_order.closed.v1', subject: `work_order/${wo.id}`, correlation: `work_order/${wo.id}`, causation: input.commandId,
          data: {
            work_order: { ...woRef(wo, product), completed_qty: formatQty(wo.completed_qty), scrapped_qty: formatQty(wo.scrapped_qty) },
            ...operational(caller, input, pdate, seq),
          },
        });
        return { ledgerSeq: seq, eventId: ev.id, status: 'closed' };
      });
      return { ...result, replayed };
    });

    // The production ledger itself, filtered (EXE3030): what was consumed, produced, scrapped, released and closed.
    http.get('/api/ledger', async (req) => {
      require(req, 'exe.ledger.read');
      const q = z.object({ from: zDate, to: zDate, type: z.enum(['RELEASE', 'CONSUME', 'COMPLETE', 'SCRAP', 'CLOSE']).optional().or(z.literal('')),
        line: z.string().optional(), wo: z.string().optional(), lot: z.string().optional(), limit: z.coerce.number().int().min(1).max(20000).default(5000) }).parse(req.query);
      const where = ['l.production_date >= ?', 'l.production_date <= ?'];
      const p: (string | number)[] = [q.from, q.to];
      if (q.type) { where.push('l.txn_type = ?'); p.push(q.type); }
      if (q.line) { where.push('w.line_code = ?'); p.push(q.line); }
      if (q.wo) { where.push('w.code LIKE ?'); p.push('%' + q.wo.trim() + '%'); }
      if (q.lot) { where.push('l.lot_no LIKE ?'); p.push('%' + q.lot.trim().toUpperCase() + '%'); }
      const rows = await ctx.db.all<any>(`SELECT l.seq, l.txn_type, l.qty, l.lot_no, l.reason_code, l.user_name, l.production_date, l.shift_code, l.occurred_at,
          w.code wo_code, w.line_code, i.code item_code, i.name_en, i.name_ar, i.base_uom, h.code wh_code
        FROM exe_ledger l JOIN exe_work_order w ON w.id = l.work_order_id LEFT JOIN mdm_item i ON i.id = l.item_id LEFT JOIN mdm_warehouse h ON h.id = l.warehouse_id
        WHERE ${where.join(' AND ')} ORDER BY l.seq DESC LIMIT ${q.limit + 1}`, p);
      if (rows.length > q.limit) fail('query.too_wide', `More than ${q.limit} lines match: narrow the production days or add a condition`);
      return rows.map((r) => ({ ...r, qty: formatQty(r.qty) }));
    });

    http.get('/api/ledger/verify', async (req) => {
      require(req, 'exe.ledger.read');
      return verify(ctx.db);
    });
  },

  async health(ctx) {
    const v = await verify(ctx.db);
    // Projection check: the work orders must equal what the ledger says.
    const drift = await ctx.db.get<{ n: number }>(
      `SELECT COUNT(*) n FROM exe_work_order w WHERE
         w.completed_qty <> (SELECT COALESCE(SUM(qty), 0) FROM exe_ledger l WHERE l.work_order_id = w.id AND l.txn_type = 'COMPLETE')
      OR w.scrapped_qty  <> (SELECT COALESCE(SUM(qty), 0) FROM exe_ledger l WHERE l.work_order_id = w.id AND l.txn_type = 'SCRAP')`,
    );
    return [
      { id: 'ledger_chain', ok: v.ok, details: { lines: v.lines, firstBadSeq: v.firstBadSeq } },
      { id: 'orders_match_ledger', ok: drift!.n === 0, details: { ordersOutOfStep: drift!.n } },
    ];
  },
};

// ------------------------------------------------------------------ the three quantity facts, inside the caller's transaction
type BookingIn = { commandId: string; productionDate?: string; shift?: string; person?: { id: string; code: string }; station?: string };

async function consume(ctx: Ctx, t: Db, caller: Caller, id: string, input: BookingIn & { itemId: string; qty: number; warehouseId: string; lotNo?: string }) {
  const wo = await openOrder(t, id);
  const mdm = ctx.services.get('mdm');
  const item = await mdm.item(input.itemId, t);
  if (!item.active) fail('item.inactive', `item ${item.code} is not active`);
  if (!item.stock_tracked) fail('item.not_stocked', `${item.code} carries no stock, so it cannot be consumed from a warehouse`);
  if (item.tracking !== 'none' && !input.lotNo) fail('lot.required', `${item.code} is tracked by ${item.tracking}: scan the lot`);
  const wh = await mdm.warehouse(input.warehouseId, t);
  const pdate = input.productionDate ?? today(ctx);
  const seq = await line(ctx, t, caller, 'CONSUME', input, {
    work_order_id: wo.id, item_id: item.id, warehouse_id: wh.id, qty: input.qty, lot_no: input.lotNo ?? null, production_date: pdate,
  });
  const product = await mdm.item(wo.item_id, t);
  const ev = await ctx.services.get('eco').publish(t, {
    type: 'mes.material.consumed.v1', subject: `work_order/${wo.id}`, correlation: `work_order/${wo.id}`, causation: input.commandId,
    data: {
      work_order: woRef(wo, product), item: { id: item.id, code: item.code }, qty: formatQty(input.qty), uom: item.base_uom,
      warehouse: { id: wh.id, code: wh.code }, ...(input.lotNo ? { lot_no: input.lotNo } : {}),
      ...operational(caller, input, pdate, seq),
    },
  });
  return { ledgerSeq: seq, eventId: ev.id };
}

async function complete(ctx: Ctx, t: Db, caller: Caller, id: string, input: BookingIn & { qty: number; lotNo?: string }) {
  const wo = await openOrder(t, id);
  conserve(wo, input.qty);
  const product = await ctx.services.get('mdm').item(wo.item_id, t);
  if (product.tracking === 'serial' && input.qty !== 1000) fail('serial.one_at_a_time', `${product.code} is serialised: report one unit per serial`);
  if (product.tracking !== 'none' && !input.lotNo) fail('lot.required', `${product.code} is tracked by ${product.tracking}: give the lot/serial`);
  const wh = await ctx.services.get('mdm').warehouse(wo.warehouse_id, t);
  const completed = wo.completed_qty + input.qty;
  const isFinal = completed + wo.scrapped_qty === wo.planned_qty;
  await bump(t, wo, { completed_qty: completed, status: isFinal ? 'completed' : 'released' });
  const pdate = input.productionDate ?? today(ctx);
  const seq = await line(ctx, t, caller, 'COMPLETE', input, {
    work_order_id: wo.id, item_id: product.id, warehouse_id: wh.id, qty: input.qty, lot_no: input.lotNo ?? null, production_date: pdate,
  });
  const ev = await ctx.services.get('eco').publish(t, {
    type: 'mes.production.completed.v1', subject: `work_order/${wo.id}`, correlation: `work_order/${wo.id}`, causation: input.commandId,
    data: {
      work_order: { ...woRef(wo, product), completed_qty_after: formatQty(completed), scrapped_qty: formatQty(wo.scrapped_qty), is_final: isFinal },
      item: { id: product.id, code: product.code }, qty: formatQty(input.qty), uom: product.base_uom, warehouse: { id: wh.id, code: wh.code },
      ...(input.lotNo ? { lot_no: input.lotNo } : {}), ...operational(caller, input, pdate, seq),
    },
  });
  return { ledgerSeq: seq, eventId: ev.id, status: isFinal ? 'completed' : 'released' };
}

async function scrap(ctx: Ctx, t: Db, caller: Caller, id: string, input: BookingIn & { qty: number; reasonCode: string }) {
  const wo = await openOrder(t, id);
  conserve(wo, input.qty);
  const product = await ctx.services.get('mdm').item(wo.item_id, t);
  const scrapped = wo.scrapped_qty + input.qty;
  const done = wo.completed_qty + scrapped === wo.planned_qty;
  await bump(t, wo, { scrapped_qty: scrapped, status: done ? 'completed' : 'released' });
  const pdate = input.productionDate ?? today(ctx);
  const seq = await line(ctx, t, caller, 'SCRAP', input, {
    work_order_id: wo.id, item_id: product.id, warehouse_id: null, qty: input.qty, reason_code: input.reasonCode, production_date: pdate,
  });
  const ev = await ctx.services.get('eco').publish(t, {
    type: 'mes.production.scrapped.v1', subject: `work_order/${wo.id}`, correlation: `work_order/${wo.id}`, causation: input.commandId,
    data: { work_order: woRef(wo, product), qty: formatQty(input.qty), uom: product.base_uom, reason_code: input.reasonCode, ...operational(caller, input, pdate, seq) },
  });
  return { ledgerSeq: seq, eventId: ev.id, status: done ? 'completed' : 'released' };
}

function today(ctx: Ctx) {
  return productionDate(ctx.clock.now(), ctx.config.timeZone, ctx.config.productionDayStart);
}

async function nextCode(t: Db) {
  const n = (await t.get<{ n: number }>('SELECT COUNT(*) n FROM exe_work_order'))!.n + 1;
  return `WO-${String(n).padStart(6, '0')}`;
}

async function openOrder(t: Db, id: string): Promise<WorkOrderRow> {
  const wo = await t.get<WorkOrderRow>('SELECT * FROM exe_work_order WHERE id = ?', [id]);
  if (!wo) return notFound('work_order', id);
  if (wo.status !== 'released') conflict('wo.not_open', `work order ${wo.code} is ${wo.status}: nothing more can be booked on it`);
  return wo;
}

function conserve(wo: WorkOrderRow, qty: number) {
  const room = wo.planned_qty - wo.completed_qty - wo.scrapped_qty;
  if (qty > room) {
    conflict('wo.over_complete', `only ${formatQty(room)} of ${wo.code} is still open (planned ${formatQty(wo.planned_qty)})`, { open: formatQty(room) });
  }
}

async function bump(t: Db, wo: WorkOrderRow, set: Partial<Pick<WorkOrderRow, 'completed_qty' | 'scrapped_qty' | 'status'>>) {
  const r = await t.run(
    `UPDATE exe_work_order SET completed_qty = :c, scrapped_qty = :s, status = :st, version = version + 1 WHERE id = :id AND version = :v`,
    { c: set.completed_qty ?? wo.completed_qty, s: set.scrapped_qty ?? wo.scrapped_qty, st: set.status ?? wo.status, id: wo.id, v: wo.version },
  );
  if (r.changes !== 1) throw new AppError(409, 'wo.changed', `work order ${wo.code} changed meanwhile; retry`);
}

async function line(
  ctx: Ctx, t: Db, caller: Caller, type: TxnType, input: { commandId: string; shift?: string; station?: string; person?: { id: string } },
  f: { work_order_id: string; item_id: string | null; warehouse_id: string | null; qty: number; production_date: string; lot_no?: string | null; reason_code?: string | null },
) {
  return append(t, ctx.clock.newId(), {
    txn_type: type, command_id: input.commandId, work_order_id: f.work_order_id, item_id: f.item_id, warehouse_id: f.warehouse_id, qty: f.qty,
    lot_no: f.lot_no ?? null, reason_code: f.reason_code ?? null, user_name: caller.name, person_id: input.person?.id ?? null,
    production_date: f.production_date, shift_code: input.shift ?? null, station_code: input.station ?? null, occurred_at: ctx.clock.now().toISOString(),
  });
}

const woRef = (wo: WorkOrderRow, product: MirrorItem) => ({
  id: wo.id, code: wo.code, item: { id: product.id, code: product.code }, planned_qty: formatQty(wo.planned_qty),
});

const operational = (caller: Caller, input: { shift?: string; station?: string; person?: { id: string; code: string } }, pdate: string, seq: number) => ({
  production_date: pdate, ...(input.shift ? { shift: input.shift } : {}), ...(input.station ? { station: input.station } : {}),
  performed_by: { user: caller.name, ...(input.person ? { person: input.person } : {}) }, ledger_seq: seq,
});

const present = (wo: WorkOrderRow) => ({
  ...wo, planned_qty: formatQty(wo.planned_qty), completed_qty: formatQty(wo.completed_qty), scrapped_qty: formatQty(wo.scrapped_qty),
  open_qty: formatQty(wo.planned_qty - wo.completed_qty - wo.scrapped_qty),
});
