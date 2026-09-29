import { formatQty, parseQty, type DemandPlanV1, type ItemV1, type PartyV1, type PurchaseOrderV1, type SalesOrderV1, type StockPositionV1 } from '@eco/contracts';
import { z } from 'zod';
import type { SnapshotResult } from '../../contracts/services.js';
import type { Db } from '../../kernel/db.js';
import { conflict, fail, notFound } from '../../kernel/errors.js';
import type { Ctx, RouteKit } from '../../kernel/modules.js';

/**
 * Read-only mirrors of accounting's commercial truth: parties, sales orders, the approved demand plans, stock balances,
 * purchase orders, and the planning parameters of an item. They are what planning (MPS/MRP) works from.
 *
 * Rules (docs/ecosystem/02-truth-ownership.md, plan 20-GMES WP-G1):
 *  - accepted only when accounting owns items here (ownership.item = 'mizan'), and only from Mizan;
 *  - a snapshot is applied only when its version is newer (re-delivery and reordering are harmless);
 *  - references (customer, item, warehouse) are stored AS CARRIED (id and code): a snapshot that names an item this plant
 *    has not received yet is NOT refused, planning reports it as an exception (`unknown_item`) — nothing is lost, nothing
 *    waits for a retry;
 *  - quantities are kept in x1000 integers and never rounded (ADR-018).
 */
export const commercialMigration = {
  id: '004_commercial_mirrors',
  up: `
    CREATE TABLE mdm_party (
      id          TEXT PRIMARY KEY,
      code        TEXT NOT NULL,
      name_en     TEXT NOT NULL,
      name_ar     TEXT NOT NULL,
      roles       TEXT NOT NULL,             -- 'customer', 'supplier' or 'customer,supplier'
      country     TEXT,
      active      INTEGER NOT NULL,
      version     INTEGER NOT NULL,
      origin_key  TEXT NOT NULL,
      mirrored_at TEXT NOT NULL
    );
    CREATE INDEX mdm_party_code ON mdm_party(code);

    -- How an item is planned and bought: from accounting's snapshot, or edited here when manufacturing owns items.
    CREATE TABLE mdm_item_planning (
      item_id                 TEXT PRIMARY KEY,
      material_type           TEXT NOT NULL CHECK (material_type IN ('raw', 'semi', 'finished', 'packaging', 'service')),
      procurement             TEXT NOT NULL CHECK (procurement IN ('buy', 'make')),
      lead_time_days          INTEGER NOT NULL,
      moq                     INTEGER NOT NULL,
      lot_rule                TEXT NOT NULL CHECK (lot_rule IN ('lot_for_lot', 'fixed', 'multiple')),
      lot_size                INTEGER NOT NULL,
      safety_stock            INTEGER NOT NULL,
      default_supplier_id     TEXT,
      default_supplier_code   TEXT,
      expedite_lead_time_days INTEGER,
      updated_at              TEXT NOT NULL
    );

    CREATE TABLE mdm_sales_order (
      id                 TEXT PRIMARY KEY,
      code               TEXT NOT NULL,
      customer_id        TEXT NOT NULL,
      customer_code      TEXT NOT NULL,
      order_date         TEXT NOT NULL,
      status             TEXT NOT NULL CHECK (status IN ('open', 'closed', 'cancelled')),
      priority           INTEGER NOT NULL,
      customer_reference TEXT,
      ship_to            TEXT,
      version            INTEGER NOT NULL,
      origin_key         TEXT NOT NULL,
      mirrored_at        TEXT NOT NULL
    );
    CREATE INDEX mdm_so_status ON mdm_sales_order(status, customer_code);
    CREATE TABLE mdm_sales_order_line (
      so_id          TEXT NOT NULL REFERENCES mdm_sales_order(id) ON DELETE CASCADE,
      line_no        INTEGER NOT NULL,
      item_id        TEXT NOT NULL,
      item_code      TEXT NOT NULL,
      qty            INTEGER NOT NULL,
      uom            TEXT NOT NULL,
      requested_date TEXT NOT NULL,
      promised_date  TEXT,
      delivered_qty  INTEGER NOT NULL,
      PRIMARY KEY (so_id, line_no)
    );
    CREATE INDEX mdm_sol_item ON mdm_sales_order_line(item_id);

    CREATE TABLE mdm_demand_plan (
      id          TEXT PRIMARY KEY,
      code        TEXT NOT NULL,
      cycle       TEXT NOT NULL,
      status      TEXT NOT NULL CHECK (status IN ('approved', 'superseded')),
      approved_at TEXT NOT NULL,
      version     INTEGER NOT NULL,
      mirrored_at TEXT NOT NULL
    );
    CREATE TABLE mdm_demand_plan_line (
      plan_id   TEXT NOT NULL REFERENCES mdm_demand_plan(id) ON DELETE CASCADE,
      item_id   TEXT NOT NULL,
      item_code TEXT NOT NULL,
      period    TEXT NOT NULL,
      qty       INTEGER NOT NULL,
      PRIMARY KEY (plan_id, item_id, period)
    );

    CREATE TABLE mdm_stock (
      id             TEXT PRIMARY KEY,
      item_id        TEXT NOT NULL,
      item_code      TEXT NOT NULL,
      warehouse_id   TEXT NOT NULL,
      warehouse_code TEXT NOT NULL,
      on_hand        INTEGER NOT NULL,
      reserved       INTEGER NOT NULL,
      uom            TEXT NOT NULL,
      as_of          TEXT NOT NULL,
      version        INTEGER NOT NULL,
      mirrored_at    TEXT NOT NULL,
      UNIQUE (item_id, warehouse_id)
    );

    CREATE TABLE mdm_purchase_order (
      id            TEXT PRIMARY KEY,
      code          TEXT NOT NULL,
      supplier_id   TEXT NOT NULL,
      supplier_code TEXT NOT NULL,
      order_date    TEXT NOT NULL,
      status        TEXT NOT NULL CHECK (status IN ('draft', 'open', 'closed', 'cancelled')),
      version       INTEGER NOT NULL,
      origin_key    TEXT NOT NULL,
      mirrored_at   TEXT NOT NULL
    );
    CREATE TABLE mdm_purchase_order_line (
      po_id            TEXT NOT NULL REFERENCES mdm_purchase_order(id) ON DELETE CASCADE,
      line_no          INTEGER NOT NULL,
      item_id          TEXT NOT NULL,
      item_code        TEXT NOT NULL,
      qty              INTEGER NOT NULL,
      received_qty     INTEGER NOT NULL,
      uom              TEXT NOT NULL,
      expected_date    TEXT NOT NULL,
      warehouse_id     TEXT NOT NULL,
      warehouse_code   TEXT NOT NULL,
      requisition_id   TEXT,
      requisition_code TEXT,
      PRIMARY KEY (po_id, line_no)
    );
    CREATE INDEX mdm_pol_item ON mdm_purchase_order_line(item_id, expected_date);
  `,
};

export type CommercialKind = 'party' | 'sales_order' | 'demand_plan' | 'stock_position' | 'purchase_order';
type Snapshot = PartyV1 | SalesOrderV1 | DemandPlanV1 | StockPositionV1 | PurchaseOrderV1;

const TABLE: Record<CommercialKind, string> = {
  party: 'mdm_party', sales_order: 'mdm_sales_order', demand_plan: 'mdm_demand_plan', stock_position: 'mdm_stock', purchase_order: 'mdm_purchase_order',
};

/** Accepted only from accounting, only while accounting owns items, and only when the version is newer. */
export async function applyCommercial(ctx: Ctx, t: Db, kind: CommercialKind, s: Snapshot): Promise<SnapshotResult> {
  if (ctx.config.ownership.item !== 'mizan') fail('mdm.not_mirror', `this installation has no accounting owner (ownership.item = ${ctx.config.ownership.item}): ${kind} snapshots are refused`);
  if (s.origin.app !== 'mizan') fail('mdm.wrong_owner', `${kind} snapshot from ${s.origin.app}, but it is owned by mizan`);
  const cur = await t.get<{ version: number }>(`SELECT version FROM ${TABLE[kind]} WHERE id = ?`, [s.id]);
  if (cur && cur.version >= s.version) return cur.version === s.version ? 'unchanged' : 'stale';
  const now = ctx.clock.now().toISOString();

  if (kind === 'party') {
    const p = s as PartyV1;
    await t.run(
      `INSERT INTO mdm_party (id, code, name_en, name_ar, roles, country, active, version, origin_key, mirrored_at)
       VALUES (:id, :code, :en, :ar, :roles, :country, :active, :v, :key, :now)
       ON CONFLICT(id) DO UPDATE SET code = :code, name_en = :en, name_ar = :ar, roles = :roles, country = :country, active = :active, version = :v, mirrored_at = :now`,
      { id: p.id, code: p.code, en: p.name.en, ar: p.name.ar, roles: [...p.roles].sort().join(','), country: p.country ?? null, active: p.active ? 1 : 0, v: p.version, key: p.origin.key, now },
    );
  } else if (kind === 'sales_order') {
    const o = s as SalesOrderV1;
    await t.run(
      `INSERT INTO mdm_sales_order (id, code, customer_id, customer_code, order_date, status, priority, customer_reference, ship_to, version, origin_key, mirrored_at)
       VALUES (:id, :code, :cid, :ccode, :date, :status, :prio, :ref, :ship, :v, :key, :now)
       ON CONFLICT(id) DO UPDATE SET code = :code, customer_id = :cid, customer_code = :ccode, order_date = :date, status = :status, priority = :prio,
         customer_reference = :ref, ship_to = :ship, version = :v, mirrored_at = :now`,
      { id: o.id, code: o.code, cid: o.customer.id, ccode: o.customer.code, date: o.order_date, status: o.status, prio: o.priority, ref: o.customer_reference ?? null, ship: o.ship_to ?? null, v: o.version, key: o.origin.key, now },
    );
    await t.run('DELETE FROM mdm_sales_order_line WHERE so_id = ?', [o.id]);   // a snapshot is the full state: lines are replaced
    for (const l of o.lines) {
      await t.run(
        `INSERT INTO mdm_sales_order_line (so_id, line_no, item_id, item_code, qty, uom, requested_date, promised_date, delivered_qty)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [o.id, l.line_no, l.item.id, l.item.code, parseQty(l.qty), l.uom, l.requested_date, l.promised_date ?? null, parseQty(l.delivered_qty)],
      );
    }
  } else if (kind === 'demand_plan') {
    const d = s as DemandPlanV1;
    await t.run(
      `INSERT INTO mdm_demand_plan (id, code, cycle, status, approved_at, version, mirrored_at) VALUES (:id, :code, :cycle, :status, :at, :v, :now)
       ON CONFLICT(id) DO UPDATE SET code = :code, cycle = :cycle, status = :status, approved_at = :at, version = :v, mirrored_at = :now`,
      { id: d.id, code: d.code, cycle: d.cycle, status: d.status, at: d.approved_at, v: d.version, now },
    );
    await t.run('DELETE FROM mdm_demand_plan_line WHERE plan_id = ?', [d.id]);
    for (const l of d.lines) {
      await t.run('INSERT OR REPLACE INTO mdm_demand_plan_line (plan_id, item_id, item_code, period, qty) VALUES (?, ?, ?, ?, ?)', [d.id, l.item.id, l.item.code, l.period, parseQty(l.qty)]);
    }
  } else if (kind === 'stock_position') {
    const p = s as StockPositionV1;
    await t.run(
      `INSERT INTO mdm_stock (id, item_id, item_code, warehouse_id, warehouse_code, on_hand, reserved, uom, as_of, version, mirrored_at)
       VALUES (:id, :iid, :icode, :wid, :wcode, :onhand, :res, :uom, :asof, :v, :now)
       ON CONFLICT(id) DO UPDATE SET item_id = :iid, item_code = :icode, warehouse_id = :wid, warehouse_code = :wcode, on_hand = :onhand,
         reserved = :res, uom = :uom, as_of = :asof, version = :v, mirrored_at = :now`,
      { id: p.id, iid: p.item.id, icode: p.item.code, wid: p.warehouse.id, wcode: p.warehouse.code, onhand: parseQty(p.on_hand), res: parseQty(p.reserved), uom: p.uom, asof: p.as_of, v: p.version, now },
    );
  } else {
    const o = s as PurchaseOrderV1;
    await t.run(
      `INSERT INTO mdm_purchase_order (id, code, supplier_id, supplier_code, order_date, status, version, origin_key, mirrored_at)
       VALUES (:id, :code, :sid, :scode, :date, :status, :v, :key, :now)
       ON CONFLICT(id) DO UPDATE SET code = :code, supplier_id = :sid, supplier_code = :scode, order_date = :date, status = :status, version = :v, mirrored_at = :now`,
      { id: o.id, code: o.code, sid: o.supplier.id, scode: o.supplier.code, date: o.order_date, status: o.status, v: o.version, key: o.origin.key, now },
    );
    await t.run('DELETE FROM mdm_purchase_order_line WHERE po_id = ?', [o.id]);
    for (const l of o.lines) {
      await t.run(
        `INSERT INTO mdm_purchase_order_line (po_id, line_no, item_id, item_code, qty, received_qty, uom, expected_date, warehouse_id, warehouse_code, requisition_id, requisition_code)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [o.id, l.line_no, l.item.id, l.item.code, parseQty(l.qty), parseQty(l.received_qty), l.uom, l.expected_date, l.warehouse.id, l.warehouse.code, l.requisition?.id ?? null, l.requisition?.code ?? null],
      );
    }
  }
  return 'applied';
}

/** The planning block of an item snapshot (owner: accounting): stored beside the item, or removed when the snapshot has none. */
export async function applyItemPlanning(ctx: Ctx, t: Db, s: ItemV1): Promise<void> {
  if (!s.planning) {
    await t.run('DELETE FROM mdm_item_planning WHERE item_id = ?', [s.id]);
    return;
  }
  const p = s.planning;
  await t.run(
    `INSERT INTO mdm_item_planning (item_id, material_type, procurement, lead_time_days, moq, lot_rule, lot_size, safety_stock, default_supplier_id, default_supplier_code, expedite_lead_time_days, updated_at)
     VALUES (:id, :mt, :proc, :lead, :moq, :rule, :size, :safety, :sid, :scode, :exp, :now)
     ON CONFLICT(item_id) DO UPDATE SET material_type = :mt, procurement = :proc, lead_time_days = :lead, moq = :moq, lot_rule = :rule, lot_size = :size,
       safety_stock = :safety, default_supplier_id = :sid, default_supplier_code = :scode, expedite_lead_time_days = :exp, updated_at = :now`,
    {
      id: s.id, mt: p.material_type, proc: p.procurement, lead: p.lead_time_days, moq: parseQty(p.moq), rule: p.lot_rule, size: parseQty(p.lot_size), safety: parseQty(p.safety_stock),
      sid: p.default_supplier?.id ?? null, scode: p.default_supplier?.code ?? null, exp: p.expedite_lead_time_days ?? null, now: ctx.clock.now().toISOString(),
    },
  );
}

// ------------------------------------------------------------------ read routes (and the item planning edit for a fallback owner)
const zDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const qty = (n: number) => formatQty(n);

const zPlanningInput = z.object({
  materialType: z.enum(['raw', 'semi', 'finished', 'packaging', 'service']),
  procurement: z.enum(['buy', 'make']),
  leadTimeDays: z.number().int().min(0).max(730),
  moq: z.string().default('0'),
  lotRule: z.enum(['lot_for_lot', 'fixed', 'multiple']),
  lotSize: z.string().default('0'),
  safetyStock: z.string().default('0'),
  defaultSupplierCode: z.string().trim().max(64).optional(),
  expediteLeadTimeDays: z.number().int().min(0).max(730).optional(),
});

export function commercialRoutes({ http, require }: RouteKit, ctx: Ctx) {
  http.get('/api/parties', async (req) => {
    require(req, 'mdm.items.read');
    const q = z.object({ role: z.enum(['customer', 'supplier']).optional() }).parse(req.query);
    const rows = await ctx.db.all<Record<string, unknown> & { roles: string }>('SELECT * FROM mdm_party ORDER BY code');
    return q.role ? rows.filter((r) => r.roles.split(',').includes(q.role!)) : rows;
  });
  http.get('/api/customers', async (req) => {
    require(req, 'mdm.items.read');
    const rows = await ctx.db.all<{ roles: string }>('SELECT * FROM mdm_party ORDER BY code');
    return rows.filter((r) => r.roles.split(',').includes('customer'));
  });

  http.get('/api/item-planning', async (req) => {
    require(req, 'mdm.items.read');
    const rows = await ctx.db.all<Record<string, number | string | null>>(
      `SELECT i.id item_id, i.code item_code, i.name_en, i.name_ar, p.material_type, p.procurement, p.lead_time_days, p.moq, p.lot_rule, p.lot_size,
              p.safety_stock, p.default_supplier_code, p.expedite_lead_time_days
       FROM mdm_item i LEFT JOIN mdm_item_planning p ON p.item_id = i.id ORDER BY i.code`);
    return rows.map((r) => ({ ...r, moq: r.moq === null ? null : qty(r.moq as number), lot_size: r.lot_size === null ? null : qty(r.lot_size as number), safety_stock: r.safety_stock === null ? null : qty(r.safety_stock as number) }));
  });
  // Only a fallback owner edits planning parameters; with Mizan they arrive with the item.
  http.put('/api/items/:id/planning', async (req) => {
    require(req, 'mdm.items.write');
    if (ctx.config.ownership.item !== 'gmes') conflict('mdm.not_owner', 'Planning parameters are owned by accounting (Mizan) in this installation: change them there');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const input = zPlanningInput.parse(req.body);
    return ctx.db.tx(async (t) => {
      const item = await t.get<{ id: string }>('SELECT id FROM mdm_item WHERE id = ?', [id]);
      if (!item) notFound('item', id);
      let supplier: { id: string; code: string } | undefined;
      if (input.defaultSupplierCode) {
        supplier = await t.get<{ id: string; code: string }>("SELECT id, code FROM mdm_party WHERE code = ? AND roles LIKE '%supplier%'", [input.defaultSupplierCode]);
        if (!supplier) fail('planning.unknown_supplier', `supplier ${input.defaultSupplierCode} is not known here`);
      }
      const snapshotLike = {
        id, planning: {
          material_type: input.materialType, procurement: input.procurement, lead_time_days: input.leadTimeDays, moq: input.moq, lot_rule: input.lotRule,
          lot_size: input.lotSize, safety_stock: input.safetyStock, default_supplier: supplier, expedite_lead_time_days: input.expediteLeadTimeDays,
        },
      } as unknown as ItemV1;
      await applyItemPlanning(ctx, t, snapshotLike);
      return { id };
    });
  });

  http.get('/api/sales-orders', async (req) => {
    require(req, 'mdm.items.read');
    const q = z.object({ status: z.enum(['open', 'closed', 'cancelled']).optional(), customer: z.string().optional() }).parse(req.query);
    const where: string[] = [];
    const p: Record<string, string> = {};
    if (q.status) (where.push('o.status = :status'), (p.status = q.status));
    if (q.customer) (where.push('o.customer_code = :customer'), (p.customer = q.customer));
    const rows = await ctx.db.all<Record<string, number | string | null>>(
      `SELECT o.id, o.code, o.customer_code, o.order_date, o.status, o.priority, o.customer_reference, o.ship_to, o.version, o.mirrored_at,
              (SELECT COUNT(*) FROM mdm_sales_order_line l WHERE l.so_id = o.id) lines,
              (SELECT COALESCE(SUM(l.qty - l.delivered_qty), 0) FROM mdm_sales_order_line l WHERE l.so_id = o.id) open_qty,
              (SELECT MIN(COALESCE(l.promised_date, l.requested_date)) FROM mdm_sales_order_line l WHERE l.so_id = o.id AND l.qty > l.delivered_qty) next_due
       FROM mdm_sales_order o ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.order_date DESC, o.code DESC`, p);
    return rows.map((r) => ({ ...r, open_qty: qty(r.open_qty as number) }));
  });
  http.get('/api/sales-orders/:id', async (req) => {
    require(req, 'mdm.items.read');
    const id = (req.params as { id: string }).id;
    const o = await ctx.db.get<{ id: string } & Record<string, unknown>>('SELECT * FROM mdm_sales_order WHERE id = ? OR code = ?', [id, id]);
    if (!o) return notFound('sales order', id);
    const lines = await ctx.db.all<Record<string, number | string | null>>('SELECT * FROM mdm_sales_order_line WHERE so_id = ? ORDER BY line_no', [o.id]);
    return { ...o, lines: lines.map((l) => ({ ...l, qty: qty(l.qty as number), delivered_qty: qty(l.delivered_qty as number), open_qty: qty((l.qty as number) - (l.delivered_qty as number)) })) };
  });
  http.get('/api/demand-plans', async (req) => {
    require(req, 'mdm.items.read');
    return ctx.db.all('SELECT id, code, cycle, status, approved_at, version, mirrored_at, (SELECT COUNT(*) FROM mdm_demand_plan_line l WHERE l.plan_id = mdm_demand_plan.id) lines FROM mdm_demand_plan ORDER BY cycle DESC, approved_at DESC');
  });
  http.get('/api/demand-plans/:id', async (req) => {
    require(req, 'mdm.items.read');
    const id = (req.params as { id: string }).id;
    const d = await ctx.db.get<{ id: string } & Record<string, unknown>>('SELECT * FROM mdm_demand_plan WHERE id = ? OR code = ?', [id, id]);
    if (!d) return notFound('demand plan', id);
    const lines = await ctx.db.all<Record<string, number | string>>('SELECT item_id, item_code, period, qty FROM mdm_demand_plan_line WHERE plan_id = ? ORDER BY item_code, period', [d.id]);
    return { ...d, lines: lines.map((l) => ({ ...l, qty: qty(l.qty as number) })) };
  });
  http.get('/api/stock', async (req) => {
    require(req, 'mdm.items.read');
    const q = z.object({ item: z.string().optional(), warehouse: z.string().optional() }).parse(req.query);
    const where: string[] = [];
    const p: Record<string, string> = {};
    if (q.item) (where.push('item_code = :item'), (p.item = q.item));
    if (q.warehouse) (where.push('warehouse_code = :wh'), (p.wh = q.warehouse));
    const rows = await ctx.db.all<Record<string, number | string>>(`SELECT * FROM mdm_stock ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY item_code, warehouse_code`, p);
    return rows.map((r) => ({ ...r, on_hand: qty(r.on_hand as number), reserved: qty(r.reserved as number), available: qty((r.on_hand as number) - (r.reserved as number)) }));
  });
  http.get('/api/purchase-orders', async (req) => {
    require(req, 'mdm.items.read');
    const q = z.object({ open: z.enum(['0', '1']).optional(), from: zDay.optional(), to: zDay.optional() }).parse(req.query);
    const lines = await ctx.db.all<Record<string, number | string | null>>(
      `SELECT o.id po_id, o.code po_code, o.supplier_code, o.status, o.order_date, l.line_no, l.item_code, l.qty, l.received_qty, l.uom, l.expected_date, l.warehouse_code, l.requisition_code
       FROM mdm_purchase_order_line l JOIN mdm_purchase_order o ON o.id = l.po_id
       WHERE (:open IS NULL OR :open = '0' OR (o.status = 'open' AND l.qty > l.received_qty)) AND (:from IS NULL OR l.expected_date >= :from) AND (:to IS NULL OR l.expected_date <= :to)
       ORDER BY l.expected_date, o.code, l.line_no`, { open: q.open ?? null, from: q.from ?? null, to: q.to ?? null });
    return lines.map((l) => ({ ...l, qty: qty(l.qty as number), received_qty: qty(l.received_qty as number), open_qty: qty((l.qty as number) - (l.received_qty as number)) }));
  });
}
