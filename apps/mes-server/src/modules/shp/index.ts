import { z } from 'zod';
import { formatQty } from '@eco/contracts';
import type { ShpService, UnitRow } from '../../contracts/services.js';
import { chainAppend, verifyChain } from '../../kernel/chain.js';
import { productionDate } from '../../kernel/clock.js';
import { runCommand } from '../../kernel/commands.js';
import type { Db } from '../../kernel/db.js';
import { conflict, fail, notFound } from '../../kernel/errors.js';
import type { AppModule, Caller, Ctx } from '../../kernel/modules.js';

/**
 * Shipping: palletizing, shipping orders, container loading and dispatch (SHP1010-SHP3010). ADR-036.
 *
 * * A packing specification per product says how many units make a pallet and how many pallets fill each container type.
 * * Palletizing: a finished unit is scanned onto the open pallet of its product on its line; the pallet closes by itself
 *   when full (or by hand when partial). One product per pallet.
 * * A shipping order lists products and quantities for a customer and destination (the customer is a name here: parties
 *   belong to accounting). Containers are opened on it (ISO 6346 number with its check digit) and pallets are loaded:
 *   only CLOSED pallets, of a product the order asks for, not more than ordered, not more than the container holds, with
 *   no unit on hold, and — when the plant inspects outgoing lots — with a PASSED outgoing inspection.
 * * Sealing the container dispatches it: its units become shipped, its pallets too, and `mes.shipment.dispatched.v1` is
 *   published for accounting (stock relief and invoice are accounting's). Every fact is in a hash-chained history.
 */
const EVENT_FIELDS = ['seq', 'id', 'kind', 'pallet', 'container', 'order_code', 'unit_id', 'serial', 'item_id', 'detail', 'user_name', 'production_date', 'at', 'command_id'] as const;
const KINDS = ['PALLET_OPEN', 'PACK', 'UNPACK', 'PALLET_CLOSE', 'CONTAINER_OPEN', 'LOAD', 'UNLOAD', 'DISPATCH'] as const;
export const CONTAINER_TYPES = ['20GP', '40GP', '40HC', 'TRUCK'] as const;
const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** ISO 6346: owner code (3 letters) + category (U, J or Z) + 6 digits + a check digit computed from the first ten. */
export function containerCheck(no: string): boolean {
  if (!/^[A-Z]{3}[UJZ]\d{7}$/.test(no)) return false;
  const letter = (c: string) => { let v = 10; for (let k = 65; k < c.charCodeAt(0); k++) { v++; if (v % 11 === 0) v++; } return v; };
  let sum = 0;
  for (let i = 0; i < 10; i++) { const c = no[i]!; sum += (/\d/.test(c) ? Number(c) : letter(c)) * 2 ** i; }
  return (sum % 11) % 10 === Number(no[10]);
}

interface Pallet { id: string; code: string; item_id: string; line_code: string; capacity: number; units: number; status: 'open' | 'closed' | 'loaded' | 'shipped'; container_id: string | null; version: number }
interface Order { id: string; code: string; customer: string; destination: string | null; ship_date: string; container_type: string; status: 'open' | 'loading' | 'shipped' | 'cancelled'; version: number }
interface Container { id: string; order_id: string; number: string; type: string; seal: string | null; status: 'loading' | 'dispatched'; truck: string | null; driver: string | null }

export const shpModule: AppModule = {
  id: 'shp',
  dependsOn: ['system', 'mdm', 'exe', 'eco', 'trk'],
  scopes: ['shp.read', 'shp.pack', 'shp.orders.write', 'shp.load'],
  migrations: [
    {
      id: '001_shipping',
      up: `
        CREATE TABLE shp_spec (
          item_id        TEXT PRIMARY KEY,
          per_pallet     INTEGER NOT NULL CHECK (per_pallet > 0),
          per_container  TEXT NOT NULL,          -- {"40HC": 18, "40GP": 16, "20GP": 8, "TRUCK": 12} pallets of this product
          version        INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE shp_pallet (
          id           TEXT PRIMARY KEY,
          code         TEXT NOT NULL UNIQUE,
          item_id      TEXT NOT NULL,
          line_code    TEXT NOT NULL,
          capacity     INTEGER NOT NULL CHECK (capacity > 0),
          units        INTEGER NOT NULL DEFAULT 0 CHECK (units >= 0 AND units <= capacity),
          status       TEXT NOT NULL CHECK (status IN ('open', 'closed', 'loaded', 'shipped')),
          container_id TEXT,
          opened_at    TEXT NOT NULL,
          opened_by    TEXT NOT NULL,
          closed_at    TEXT,
          closed_by    TEXT,
          version      INTEGER NOT NULL DEFAULT 1
        );
        CREATE UNIQUE INDEX shp_one_open_pallet ON shp_pallet(item_id, line_code) WHERE status = 'open';
        CREATE INDEX shp_pallet_container ON shp_pallet(container_id);
        CREATE TABLE shp_pallet_unit (
          unit_id    TEXT PRIMARY KEY,
          pallet_id  TEXT NOT NULL REFERENCES shp_pallet(id),
          packed_at  TEXT NOT NULL
        );
        CREATE INDEX shp_pallet_unit_pallet ON shp_pallet_unit(pallet_id);
        CREATE TABLE shp_order (
          id             TEXT PRIMARY KEY,
          code           TEXT NOT NULL UNIQUE,
          customer       TEXT NOT NULL,
          destination    TEXT,
          ship_date      TEXT NOT NULL,
          container_type TEXT NOT NULL,
          status         TEXT NOT NULL CHECK (status IN ('open', 'loading', 'shipped', 'cancelled')),
          note           TEXT,
          created_at     TEXT NOT NULL,
          created_by     TEXT NOT NULL,
          version        INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE shp_order_line (
          order_id  TEXT NOT NULL REFERENCES shp_order(id),
          item_id   TEXT NOT NULL,
          qty       INTEGER NOT NULL CHECK (qty > 0),     -- units
          PRIMARY KEY (order_id, item_id)
        );
        CREATE TABLE shp_container (
          id            TEXT PRIMARY KEY,
          order_id      TEXT NOT NULL REFERENCES shp_order(id),
          number        TEXT NOT NULL,
          type          TEXT NOT NULL,
          seal          TEXT,
          truck         TEXT,
          driver        TEXT,
          status        TEXT NOT NULL CHECK (status IN ('loading', 'dispatched')),
          opened_at     TEXT NOT NULL,
          opened_by     TEXT NOT NULL,
          dispatched_at TEXT,
          dispatched_by TEXT
        );
        CREATE UNIQUE INDEX shp_container_at_dock ON shp_container(number) WHERE status = 'loading';
        CREATE TABLE shp_event (
          seq             INTEGER PRIMARY KEY,
          id              TEXT NOT NULL UNIQUE,
          kind            TEXT NOT NULL CHECK (kind IN (${KINDS.map((k) => `'${k}'`).join(', ')})),
          pallet          TEXT,
          container       TEXT,
          order_code      TEXT,
          unit_id         TEXT,
          serial          TEXT,
          item_id         TEXT,
          detail          TEXT,
          user_name       TEXT NOT NULL,
          production_date TEXT NOT NULL,
          at              TEXT NOT NULL,
          command_id      TEXT NOT NULL,
          prev_hash       TEXT NOT NULL,
          hash            TEXT NOT NULL
        );
        CREATE INDEX shp_event_day ON shp_event(production_date, kind);
        CREATE TRIGGER shp_event_immutable BEFORE UPDATE ON shp_event BEGIN SELECT RAISE(ABORT, 'shp: the shipping history is append-only'); END;
        CREATE TRIGGER shp_event_no_delete BEFORE DELETE ON shp_event BEGIN SELECT RAISE(ABORT, 'shp: the shipping history is append-only'); END;
      `,
    },
    {
      id: '002_sales_order_link',
      up: `
        -- a shipping order made from accounting's sales order (plan 20-GMES WP-G5): the customer and each line's order line
        ALTER TABLE shp_order ADD COLUMN customer_party_id TEXT;
        ALTER TABLE shp_order ADD COLUMN customer_party_code TEXT;
        ALTER TABLE shp_order_line ADD COLUMN so_id TEXT;
        ALTER TABLE shp_order_line ADD COLUMN so_code TEXT;
        ALTER TABLE shp_order_line ADD COLUMN so_line_no INTEGER;
      `,
    },
  ],

  setup(ctx) {
    const service: ShpService = {
      async whereIs(unitId, t) {
        const r = await (t ?? ctx.db).get<{ pallet: string; container: string | null; shipment: string | null }>(
          `SELECT p.code pallet, c.number container, o.code shipment FROM shp_pallet_unit x JOIN shp_pallet p ON p.id = x.pallet_id
           LEFT JOIN shp_container c ON c.id = p.container_id LEFT JOIN shp_order o ON o.id = c.order_id WHERE x.unit_id = ?`, [unitId]);
        return r ? { box: null, pallet: r.pallet, container: r.container, shipment: r.shipment } : null;
      },
      async unitsIn(t, pallet) {
        return (await t.all<{ unit_id: string }>('SELECT x.unit_id FROM shp_pallet_unit x JOIN shp_pallet p ON p.id = x.pallet_id WHERE p.code = ?', [pallet.toUpperCase()])).map((r) => r.unit_id);
      },
    };
    ctx.services.provide('shp', service);
  },

  routes({ http, require }, ctx) {
    const today = () => productionDate(ctx.clock.now(), ctx.config.timeZone, ctx.config.productionDayStart);

    // ------------------------------------------------------------------ packing specifications (SHP1010)
    http.get('/api/pack-specs', async (req) => {
      require(req, 'shp.read');
      const rows = await ctx.db.all<any>(`SELECT i.id item_id, i.code, i.name_en, i.name_ar, i.tracking, s.per_pallet, s.per_container, s.version
        FROM mdm_item i LEFT JOIN shp_spec s ON s.item_id = i.id WHERE i.kind = 'product' AND i.active = 1 ORDER BY i.code`);
      return rows.map((r) => ({ ...r, per_container: r.per_container ? JSON.parse(r.per_container) : null }));
    });
    http.put('/api/pack-specs/:itemId', async (req) => {
      const caller = require(req, 'shp.orders.write');
      const { itemId } = req.params as { itemId: string };
      const input = z.object({ perPallet: z.number().int().min(1).max(10_000), perContainer: z.partialRecord(z.enum(CONTAINER_TYPES), z.number().int().min(1).max(200)), version: z.number().int().optional() }).parse(req.body);
      return ctx.db.tx(async (t) => {
        await ctx.services.get('mdm').item(itemId, t);
        const cur = await t.get<{ version: number }>('SELECT version FROM shp_spec WHERE item_id = ?', [itemId]);
        if (cur && input.version !== cur.version) conflict('spec.changed', 'the packing specification was changed meanwhile: reload it');
        await t.run(`INSERT INTO shp_spec (item_id, per_pallet, per_container) VALUES (?, ?, ?)
          ON CONFLICT(item_id) DO UPDATE SET per_pallet = excluded.per_pallet, per_container = excluded.per_container, version = version + 1`, [itemId, input.perPallet, JSON.stringify(input.perContainer)]);
        await ctx.services.get('sys').audit(t, caller.name, 'pack_spec.save', itemId, input);
        return { itemId };
      });
    });

    // ------------------------------------------------------------------ palletizing (SHP2010)
    http.post('/api/pallets/pack', async (req) => {
      const caller = require(req, 'shp.pack');
      const input = z.object({ commandId: z.string(), serial: z.string().trim().min(1).max(40), station: z.string().optional() }).parse(req.body);
      const { result, replayed } = await runCommand(ctx, caller, { id: input.commandId, type: 'PackUnit', request: req.body }, (t) => pack(ctx, t, caller, input, today()));
      return { ...result, replayed };
    });
    http.post('/api/pallets/:code/close', async (req) => {
      const caller = require(req, 'shp.pack');
      const code = (req.params as { code: string }).code.toUpperCase();
      const input = z.object({ commandId: z.string() }).parse(req.body);
      const { result, replayed } = await runCommand(ctx, caller, { id: input.commandId, type: 'ClosePallet', request: { code } }, async (t) => {
        const p = (await t.get<Pallet>('SELECT * FROM shp_pallet WHERE code = ?', [code])) ?? notFound('pallet', code);
        if (p.status !== 'open') conflict('pallet.not_open', `pallet ${code} is ${p.status}`);
        if (!p.units) conflict('pallet.empty', `pallet ${code} is empty`);
        await closePallet(ctx, t, caller, p, input.commandId, today(), 'partial');
        return { code, units: p.units };
      });
      return { ...result, replayed };
    });
    http.post('/api/pallets/:code/unpack', async (req) => {
      const caller = require(req, 'shp.pack');
      const code = (req.params as { code: string }).code.toUpperCase();
      const input = z.object({ commandId: z.string(), serial: z.string().trim().min(1).max(40), reason: z.string().trim().min(3).max(200) }).parse(req.body);
      const { result, replayed } = await runCommand(ctx, caller, { id: input.commandId, type: 'UnpackUnit', request: { code, ...input } }, async (t) => {
        const p = (await t.get<Pallet>('SELECT * FROM shp_pallet WHERE code = ?', [code])) ?? notFound('pallet', code);
        if (p.status === 'loaded' || p.status === 'shipped') conflict('pallet.loaded', `pallet ${code} is ${p.status}: unload it from the container first`);
        const u = (await ctx.services.get('trk').unit(input.serial.toUpperCase(), t)) ?? notFound('unit', input.serial);
        if (!(await t.get('SELECT 1 FROM shp_pallet_unit WHERE unit_id = ? AND pallet_id = ?', [u.id, p.id]))) conflict('pallet.not_on_it', `${u.serial} is not on pallet ${code}`);
        if (p.status === 'closed' && await t.get(`SELECT 1 FROM shp_pallet WHERE item_id = ? AND line_code = ? AND status = 'open' AND id <> ?`, [p.item_id, p.line_code, p.id])) {
          conflict('pallet.other_open', `another pallet of this product is open on ${p.line_code}: close it before re-opening ${code}`);
        }
        await t.run('DELETE FROM shp_pallet_unit WHERE unit_id = ?', [u.id]);   // the projection; the fact is in both histories
        await t.run(`UPDATE shp_pallet SET units = units - 1, status = 'open', closed_at = NULL, closed_by = NULL, version = version + 1 WHERE id = ?`, [p.id]);
        await ctx.services.get('trk').markUnpacked(t, caller, u.id, { commandId: input.commandId, box: code, reason: input.reason });
        await history(ctx, t, caller, { kind: 'UNPACK', pallet: code, unit_id: u.id, serial: u.serial, item_id: u.item_id, detail: { reason: input.reason } }, input.commandId, today());
        return { code, units: p.units - 1 };
      });
      return { ...result, replayed };
    });
    http.get('/api/pallets', async (req) => {
      require(req, 'shp.read');
      const q = z.object({ status: z.string().optional(), item: z.string().optional(), line: z.string().optional(), from: zDate.optional(), to: zDate.optional() }).parse(req.query);
      const where: string[] = [], p: string[] = [];
      if (q.status) { where.push('p.status = ?'); p.push(q.status); }
      if (q.item) { where.push('(i.code = ? OR i.id = ?)'); p.push(q.item, q.item); }
      if (q.line) { where.push('p.line_code = ?'); p.push(q.line); }
      if (q.from) { where.push('substr(p.opened_at, 1, 10) >= ?'); p.push(q.from); }
      if (q.to) { where.push('substr(p.opened_at, 1, 10) <= ?'); p.push(q.to); }
      const rows = await ctx.db.all<any>(`SELECT p.*, i.code item_code, i.name_en, i.name_ar, c.number container, o.code order_code
        FROM shp_pallet p JOIN mdm_item i ON i.id = p.item_id LEFT JOIN shp_container c ON c.id = p.container_id LEFT JOIN shp_order o ON o.id = c.order_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.opened_at DESC LIMIT 5000`, p);
      const qms = ctx.services.has('qms') ? ctx.services.get('qms') : null;
      for (const r of rows) r.oqc = qms ? await qms.oqcResult(ctx.db, r.code) : 'none';
      return rows;
    });
    http.get('/api/pallets/:code', async (req) => {
      require(req, 'shp.read');
      const code = (req.params as { code: string }).code.toUpperCase();
      const p = (await ctx.db.get<any>(`SELECT p.*, i.code item_code, i.name_en, i.name_ar, c.number container FROM shp_pallet p JOIN mdm_item i ON i.id = p.item_id
        LEFT JOIN shp_container c ON c.id = p.container_id WHERE p.code = ?`, [code])) ?? notFound('pallet', code);
      const units = await ctx.db.all(`SELECT u.serial, u.status, u.held, u.completed_at, w.code wo_code, x.packed_at FROM shp_pallet_unit x JOIN trk_unit u ON u.id = x.unit_id
        JOIN exe_work_order w ON w.id = u.work_order_id WHERE x.pallet_id = ? ORDER BY x.packed_at`, [p.id]);
      return { ...p, list: units, oqc: ctx.services.has('qms') ? await ctx.services.get('qms').oqcResult(ctx.db, code) : 'none' };
    });
    /** Finished goods not shipped yet: units finished but not on a pallet, and pallets by status, per product. */
    http.get('/api/fg-stock', async (req) => {
      require(req, 'shp.read');
      // products that ship (they have a packing specification); a main board waiting to be fitted is not finished goods
      const loose = await ctx.db.all<{ item_id: string; n: number }>(`SELECT u.item_id, COUNT(*) n FROM trk_unit u JOIN shp_spec s ON s.item_id = u.item_id
        WHERE u.status = 'completed' AND u.parent_id IS NULL GROUP BY u.item_id`);
      const pal = await ctx.db.all<{ item_id: string; status: string; pallets: number; units: number }>(`SELECT item_id, status, COUNT(*) pallets, SUM(units) units FROM shp_pallet
        WHERE status IN ('open', 'closed', 'loaded') GROUP BY item_id, status`);
      const items = new Map<string, any>();
      const get = async (id: string) => { if (!items.has(id)) { const i = await ctx.services.get('mdm').item(id); items.set(id, { item_id: id, code: i.code, name_en: i.name_en, name_ar: i.name_ar, loose: 0, open: 0, closed: 0, loaded: 0, pallets_closed: 0, pallets_loaded: 0 }); } return items.get(id); };
      for (const l of loose) (await get(l.item_id)).loose = l.n;
      for (const p of pal) { const r = await get(p.item_id); r[p.status] = p.units; if (p.status !== 'open') r['pallets_' + p.status] = p.pallets; }
      return [...items.values()].sort((a, b) => a.code.localeCompare(b.code));
    });

    // ------------------------------------------------------------------ shipping orders (SHP2020)
    const zLines = z.array(z.object({ itemId: z.string(), qty: z.number().int().min(1).max(10_000_000) })).min(1).max(50);
    http.get('/api/shipping-orders', async (req) => {
      require(req, 'shp.read');
      const q = z.object({ status: z.string().optional(), from: zDate.optional(), to: zDate.optional() }).parse(req.query);
      const where: string[] = [], p: string[] = [];
      if (q.status) { where.push('o.status = ?'); p.push(q.status); }
      if (q.from) { where.push('o.ship_date >= ?'); p.push(q.from); }
      if (q.to) { where.push('o.ship_date <= ?'); p.push(q.to); }
      return ctx.db.all(`SELECT o.*, (SELECT SUM(qty) FROM shp_order_line l WHERE l.order_id = o.id) ordered,
          (SELECT COUNT(*) FROM shp_pallet_unit x JOIN shp_pallet pl ON pl.id = x.pallet_id JOIN shp_container c ON c.id = pl.container_id WHERE c.order_id = o.id) loaded,
          (SELECT COUNT(*) FROM shp_container c WHERE c.order_id = o.id) containers,
          (SELECT COUNT(*) FROM shp_container c WHERE c.order_id = o.id AND c.status = 'dispatched') dispatched
        FROM shp_order o ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.ship_date DESC, o.code DESC LIMIT 2000`, p);
    });
    http.get('/api/shipping-orders/:id', async (req) => {
      require(req, 'shp.read');
      return orderView(ctx, ctx.db, (req.params as { id: string }).id);
    });
    http.post('/api/shipping-orders', async (req) => {
      const caller = require(req, 'shp.orders.write');
      const input = z.object({ customer: z.string().trim().min(1).max(200), destination: z.string().trim().max(200).optional(), shipDate: zDate, containerType: z.enum(CONTAINER_TYPES),
        note: z.string().trim().max(500).optional(), lines: zLines }).parse(req.body);
      return ctx.db.tx(async (t) => {
        const n = (await t.get<{ n: number }>('SELECT COUNT(*) n FROM shp_order'))!.n + 1;
        const id = ctx.clock.newId(), code = 'SO-' + String(n).padStart(6, '0');
        await t.run(`INSERT INTO shp_order (id, code, customer, destination, ship_date, container_type, status, note, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
          [id, code, input.customer, input.destination ?? null, input.shipDate, input.containerType, input.note ?? null, ctx.clock.now().toISOString(), caller.name]);
        await writeLines(ctx, t, id, input.lines);
        await ctx.services.get('sys').audit(t, caller.name, 'shipping_order.create', code, { customer: input.customer, lines: input.lines.length });
        return { id, code };
      });
    });
    // a shipping order for lines of a mirrored sales order: never more than what is still open on the order line
    http.post('/api/shipping-orders/from-sales-order', async (req) => {
      const caller = require(req, 'shp.orders.write');
      const input = z.object({ salesOrderId: z.string(), shipDate: zDate, containerType: z.enum(CONTAINER_TYPES), destination: z.string().trim().max(200).optional(),
        note: z.string().trim().max(500).optional(), lines: z.array(z.object({ lineNo: z.number().int().positive(), qty: z.number().int().min(1).max(10_000_000) })).min(1).max(50) }).parse(req.body);
      return ctx.db.tx(async (t) => {
        const so = (await t.get<{ id: string; code: string; customer_id: string; customer_code: string; status: string; ship_to: string | null }>(
          'SELECT id, code, customer_id, customer_code, status, ship_to FROM mdm_sales_order WHERE id = ? OR code = ?', [input.salesOrderId, input.salesOrderId])) ?? notFound('sales_order', input.salesOrderId);
        if (so.status !== 'open') conflict('sales.order_closed', `sales order ${so.code} is ${so.status}`);
        const soLines = await t.all<{ line_no: number; item_id: string; qty: number; delivered_qty: number }>('SELECT line_no, item_id, qty, delivered_qty FROM mdm_sales_order_line WHERE so_id = ?', [so.id]);
        const lines: { itemId: string; qty: number; lineNo: number }[] = [];
        for (const l of input.lines) {
          const sl = soLines.find((x) => x.line_no === l.lineNo) ?? fail('shp.no_order_line', `${so.code} has no line ${l.lineNo}`);
          const onOther = (await t.get<{ n: number | null }>(
            `SELECT SUM(l.qty) n FROM shp_order_line l JOIN shp_order o ON o.id = l.order_id WHERE l.so_id = ? AND l.so_line_no = ? AND o.status IN ('open', 'loading')`, [so.id, l.lineNo]))!.n ?? 0;
          const open = Math.floor((sl.qty - sl.delivered_qty) / 1000) - onOther;
          if (l.qty > open) conflict('shp.over_order', `${so.code} line ${l.lineNo}: only ${Math.max(0, open)} units are still open`, { open: Math.max(0, open) });
          lines.push({ itemId: sl.item_id, qty: l.qty, lineNo: l.lineNo });
        }
        const n = (await t.get<{ n: number }>('SELECT COUNT(*) n FROM shp_order'))!.n + 1;
        const id = ctx.clock.newId(), code = 'SO-' + String(n).padStart(6, '0');
        await t.run(`INSERT INTO shp_order (id, code, customer, destination, ship_date, container_type, status, note, created_at, created_by, customer_party_id, customer_party_code)
          VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
          [id, code, so.customer_code, input.destination ?? so.ship_to ?? null, input.shipDate, input.containerType, input.note ?? `from ${so.code}`, ctx.clock.now().toISOString(), caller.name, so.customer_id, so.customer_code]);
        await writeLines(ctx, t, id, lines);
        for (const l of lines) await t.run('UPDATE shp_order_line SET so_id = ?, so_code = ?, so_line_no = ? WHERE order_id = ? AND item_id = ?', [so.id, so.code, l.lineNo, id, l.itemId]);
        await ctx.services.get('sys').audit(t, caller.name, 'shipping_order.create', code, { salesOrder: so.code, lines: lines.length });
        return { id, code };
      });
    });
    http.put('/api/shipping-orders/:id', async (req) => {
      const caller = require(req, 'shp.orders.write');
      const { id } = req.params as { id: string };
      const input = z.object({ version: z.number().int(), customer: z.string().trim().min(1).max(200), destination: z.string().trim().max(200).optional(), shipDate: zDate,
        containerType: z.enum(CONTAINER_TYPES), note: z.string().trim().max(500).optional(), lines: zLines, cancel: z.boolean().optional() }).parse(req.body);
      return ctx.db.tx(async (t) => {
        const o = (await t.get<Order>('SELECT * FROM shp_order WHERE id = ?', [id])) ?? notFound('shipping_order', id);
        if (o.version !== input.version) conflict('order.changed', `${o.code} was changed meanwhile: reload it`);
        if (o.status === 'shipped' || o.status === 'cancelled') conflict('order.closed', `${o.code} is ${o.status}`);
        const loaded = await loadedByItem(t, id);
        if (input.cancel) {
          if ([...loaded.values()].some((v) => v > 0)) conflict('order.has_loads', `${o.code} has loaded pallets: unload them first`);
          await t.run(`UPDATE shp_order SET status = 'cancelled', version = version + 1 WHERE id = ?`, [id]);
        } else {
          for (const [item, q] of loaded) if (q > 0 && (input.lines.find((l) => l.itemId === item)?.qty ?? 0) < q) conflict('order.below_loaded', `the order cannot ask for less than what is already loaded (${q} units)`);
          await t.run('UPDATE shp_order SET customer = ?, destination = ?, ship_date = ?, container_type = ?, note = ?, version = version + 1 WHERE id = ?',
            [input.customer, input.destination ?? null, input.shipDate, input.containerType, input.note ?? null, id]);
          // The lines are a plan and are rewritten, but the commercial link of a line (the sales order and its line) is a fact about where the goods are
          // going: it is kept for every item that stays, and a sales-linked order takes no item that has no link (accounting refuses a dispatch line without one).
          const links = new Map((await t.all<{ item_id: string; so_id: string | null; so_code: string | null; so_line_no: number | null }>(
            'SELECT item_id, so_id, so_code, so_line_no FROM shp_order_line WHERE order_id = ?', [id])).map((r) => [r.item_id, r]));
          const linked = [...links.values()].some((r) => r.so_id);
          if (linked) for (const l of input.lines) if (!links.get(l.itemId)?.so_id) fail('order.linked_lines', `${o.code} ships a sales order: an item with no sales-order line cannot be added (make a new shipping order from the sales order)`);
          for (const l of input.lines) {        // a linked line still never asks for more than what is open on its sales-order line (other open shipping orders counted)
            const k = links.get(l.itemId);
            if (!k?.so_id) continue;
            const sl = await t.get<{ qty: number; delivered_qty: number }>('SELECT qty, delivered_qty FROM mdm_sales_order_line WHERE so_id = ? AND line_no = ?', [k.so_id, k.so_line_no]);
            if (!sl) return conflict('order.linked_line_missing', 'Refresh the sales-order mirror before changing this linked shipping line');
            const onOther = (await t.get<{ n: number | null }>(
              `SELECT SUM(l.qty) n FROM shp_order_line l JOIN shp_order x ON x.id = l.order_id WHERE l.so_id = ? AND l.so_line_no = ? AND x.status IN ('open', 'loading') AND x.id <> ?`, [k.so_id, k.so_line_no, id]))!.n ?? 0;
            const open = Math.floor((sl.qty - sl.delivered_qty) / 1000) - onOther;
            if (l.qty > open) conflict('shp.over_order', `${k.so_code} line ${k.so_line_no}: only ${Math.max(0, open)} units are still open`, { open: Math.max(0, open) });
          }
          await t.run('DELETE FROM shp_order_line WHERE order_id = ?', [id]);   // the order's current lines (a plan, not a fact)
          await writeLines(ctx, t, id, input.lines);
          for (const l of input.lines) {
            const k = links.get(l.itemId);
            if (k?.so_id) await t.run('UPDATE shp_order_line SET so_id = ?, so_code = ?, so_line_no = ? WHERE order_id = ? AND item_id = ?', [k.so_id, k.so_code, k.so_line_no, id, l.itemId]);
          }
        }
        await ctx.services.get('sys').audit(t, caller.name, input.cancel ? 'shipping_order.cancel' : 'shipping_order.change', o.code, input);
        return { id, version: o.version + 1 };
      });
    });

    // ------------------------------------------------------------------ containers and loading (SHP2030)
    http.post('/api/shipping-orders/:id/containers', async (req) => {
      const caller = require(req, 'shp.load');
      const { id } = req.params as { id: string };
      const input = z.object({ commandId: z.string(), number: z.string().trim().toUpperCase().max(20), type: z.enum(CONTAINER_TYPES).optional(), truck: z.string().trim().max(30).optional(),
        driver: z.string().trim().max(80).optional() }).parse(req.body);
      const { result, replayed } = await runCommand(ctx, caller, { id: input.commandId, type: 'OpenContainer', request: { id, ...input } }, async (t) => {
        const o = (await t.get<Order>('SELECT * FROM shp_order WHERE id = ? OR code = ?', [id, id])) ?? notFound('shipping_order', id);
        if (o.status === 'shipped' || o.status === 'cancelled') conflict('order.closed', `${o.code} is ${o.status}`);
        const type = input.type ?? o.container_type;
        if (type !== 'TRUCK' && !containerCheck(input.number)) fail('container.number', `${input.number} is not a valid container number (ISO 6346: 4 letters, 6 digits and the check digit)`);
        if (type === 'TRUCK' && !/^[A-Z0-9-]{3,20}$/.test(input.number)) fail('container.number', 'give the truck plate');
        if (await t.get(`SELECT 1 FROM shp_container WHERE number = ? AND status = 'loading'`, [input.number])) conflict('container.at_dock', `${input.number} is already being loaded`);
        const cid = ctx.clock.newId();
        await t.run(`INSERT INTO shp_container (id, order_id, number, type, truck, driver, status, opened_at, opened_by) VALUES (?, ?, ?, ?, ?, ?, 'loading', ?, ?)`,
          [cid, o.id, input.number, type, input.truck ?? null, input.driver ?? null, ctx.clock.now().toISOString(), caller.name]);
        if (o.status === 'open') await t.run(`UPDATE shp_order SET status = 'loading', version = version + 1 WHERE id = ?`, [o.id]);
        await history(ctx, t, caller, { kind: 'CONTAINER_OPEN', container: input.number, order_code: o.code, detail: { type, truck: input.truck ?? null } }, input.commandId, today());
        return { id: cid, number: input.number, type };
      });
      return { ...result, replayed };
    });
    http.get('/api/containers/:id', async (req) => {
      require(req, 'shp.read');
      return containerView(ctx, ctx.db, (req.params as { id: string }).id);
    });
    http.get('/api/containers', async (req) => {
      require(req, 'shp.read');
      const q = z.object({ status: z.string().optional(), from: zDate.optional(), to: zDate.optional() }).parse(req.query);
      const where: string[] = [], p: string[] = [];
      if (q.status) { where.push('c.status = ?'); p.push(q.status); }
      if (q.from) { where.push('substr(COALESCE(c.dispatched_at, c.opened_at), 1, 10) >= ?'); p.push(q.from); }
      if (q.to) { where.push('substr(COALESCE(c.dispatched_at, c.opened_at), 1, 10) <= ?'); p.push(q.to); }
      return ctx.db.all(`SELECT c.*, o.code order_code, o.customer, o.destination, (SELECT COUNT(*) FROM shp_pallet p WHERE p.container_id = c.id) pallets,
          (SELECT COALESCE(SUM(units), 0) FROM shp_pallet p WHERE p.container_id = c.id) units
        FROM shp_container c JOIN shp_order o ON o.id = c.order_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.opened_at DESC LIMIT 2000`, p);
    });
    http.post('/api/containers/:id/load', async (req) => {
      const caller = require(req, 'shp.load');
      const { id } = req.params as { id: string };
      const input = z.object({ commandId: z.string(), pallet: z.string().trim().toUpperCase().min(1).max(40) }).parse(req.body);
      const { result, replayed } = await runCommand(ctx, caller, { id: input.commandId, type: 'LoadPallet', request: { id, ...input } }, (t) => loadPallet(ctx, t, caller, id, input.pallet, input.commandId, today()));
      return { ...result, replayed };
    });
    http.post('/api/containers/:id/unload', async (req) => {
      const caller = require(req, 'shp.load');
      const { id } = req.params as { id: string };
      const input = z.object({ commandId: z.string(), pallet: z.string().trim().toUpperCase().min(1).max(40), reason: z.string().trim().min(3).max(200) }).parse(req.body);
      const { result, replayed } = await runCommand(ctx, caller, { id: input.commandId, type: 'UnloadPallet', request: { id, ...input } }, async (t) => {
        const c = (await t.get<Container>('SELECT * FROM shp_container WHERE id = ?', [id])) ?? notFound('container', id);
        if (c.status !== 'loading') conflict('container.dispatched', `container ${c.number} has left`);
        const p = (await t.get<Pallet>('SELECT * FROM shp_pallet WHERE code = ?', [input.pallet])) ?? notFound('pallet', input.pallet);
        if (p.container_id !== c.id) conflict('pallet.not_in_container', `pallet ${p.code} is not in ${c.number}`);
        await t.run(`UPDATE shp_pallet SET status = 'closed', container_id = NULL, version = version + 1 WHERE id = ?`, [p.id]);
        const o = (await t.get<Order>('SELECT * FROM shp_order WHERE id = ?', [c.order_id]))!;
        await history(ctx, t, caller, { kind: 'UNLOAD', pallet: p.code, container: c.number, order_code: o.code, item_id: p.item_id, detail: { reason: input.reason, units: p.units } }, input.commandId, today());
        return { pallet: p.code, container: c.number };
      });
      return { ...result, replayed };
    });
    http.post('/api/containers/:id/dispatch', async (req) => {
      const caller = require(req, 'shp.load');
      const { id } = req.params as { id: string };
      const input = z.object({ commandId: z.string(), seal: z.string().trim().toUpperCase().min(3).max(30) }).parse(req.body);
      const { result, replayed } = await runCommand(ctx, caller, { id: input.commandId, type: 'DispatchContainer', request: { id, ...input } }, (t) => dispatch(ctx, t, caller, id, input.seal, input.commandId, today()));
      return { ...result, replayed };
    });

    // ------------------------------------------------------------------ history (SHP3010)
    http.get('/api/shipping-events', async (req) => {
      require(req, 'shp.read');
      const q = z.object({ from: zDate, to: zDate, kind: z.string().optional() }).parse(req.query);
      return ctx.db.all(`SELECT seq, kind, pallet, container, order_code, serial, detail, user_name, production_date, at FROM shp_event
        WHERE production_date >= ? AND production_date <= ? ${q.kind ? 'AND kind = ?' : ''} ORDER BY seq DESC LIMIT 10000`, q.kind ? [q.from, q.to, q.kind] : [q.from, q.to]);
    });
    http.get('/api/shp/verify', async (req) => {
      require(req, 'shp.read');
      return verifyChain(ctx.db, 'shp_event', EVENT_FIELDS);
    });
  },

  async health(ctx) {
    const v = await verifyChain(ctx.db, 'shp_event', EVENT_FIELDS);
    // a pallet's count must equal the units on it, and a shipped pallet must hold only shipped units
    const count = await ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM shp_pallet p WHERE p.units <> (SELECT COUNT(*) FROM shp_pallet_unit x WHERE x.pallet_id = p.id)`);
    const ship = await ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM shp_pallet p JOIN shp_pallet_unit x ON x.pallet_id = p.id JOIN trk_unit u ON u.id = x.unit_id
      WHERE p.status = 'shipped' AND u.status <> 'shipped'`);
    return [
      { id: 'shipping_chain', ok: v.ok, details: { rows: v.rows, firstBadSeq: v.firstBadSeq } },
      { id: 'pallets_consistent', ok: count!.n === 0 && ship!.n === 0, details: { palletsMiscounted: count!.n, shippedPalletsWithUnitsNotShipped: ship!.n } },
    ];
  },
};

// ------------------------------------------------------------------ facts
async function history(ctx: Ctx, t: Db, caller: Caller, e: { kind: (typeof KINDS)[number]; pallet?: string | null; container?: string | null; order_code?: string | null; unit_id?: string | null; serial?: string | null; item_id?: string | null; detail?: unknown }, commandId: string, day: string) {
  return chainAppend(t, 'shp_event', EVENT_FIELDS, {
    id: ctx.clock.newId(), kind: e.kind, pallet: e.pallet ?? null, container: e.container ?? null, order_code: e.order_code ?? null, unit_id: e.unit_id ?? null, serial: e.serial ?? null,
    item_id: e.item_id ?? null, detail: e.detail ? JSON.stringify(e.detail) : null, user_name: caller.name, production_date: day, at: ctx.clock.now().toISOString(), command_id: commandId,
  });
}

async function pack(ctx: Ctx, t: Db, caller: Caller, input: { commandId: string; serial: string; station?: string }, day: string) {
  const trk = ctx.services.get('trk');
  const u = (await trk.unit(input.serial.toUpperCase(), t)) ?? notFound('unit', input.serial);
  if (await t.get('SELECT 1 FROM shp_pallet_unit WHERE unit_id = ?', [u.id])) conflict('unit.already_packed', `${u.serial} is already on a pallet`);
  if (u.parent_id) conflict('unit.fitted', `${u.serial} is a part fitted into another unit`);
  const spec = await t.get<{ per_pallet: number }>('SELECT per_pallet FROM shp_spec WHERE item_id = ?', [u.item_id]);
  if (!spec) conflict('pack.no_spec', 'this product has no packing specification (units per pallet): set it in SHP1010');
  let p = await t.get<Pallet>(`SELECT * FROM shp_pallet WHERE item_id = ? AND line_code = ? AND status = 'open'`, [u.item_id, u.line_code]);
  let opened = false;
  if (!p) {
    const stamp = day.slice(2).replace(/-/g, '');
    const n = (await t.get<{ n: number }>(`SELECT COUNT(*) n FROM shp_pallet WHERE code LIKE ?`, [`PLT${stamp}-%`]))!.n + 1;
    const id = ctx.clock.newId(), code = `PLT${stamp}-${String(n).padStart(4, '0')}`;
    await t.run(`INSERT INTO shp_pallet (id, code, item_id, line_code, capacity, status, opened_at, opened_by) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`,
      [id, code, u.item_id, u.line_code, spec!.per_pallet, ctx.clock.now().toISOString(), caller.name]);
    await history(ctx, t, caller, { kind: 'PALLET_OPEN', pallet: code, item_id: u.item_id, detail: { capacity: spec!.per_pallet, line: u.line_code } }, input.commandId, day);
    p = (await t.get<Pallet>('SELECT * FROM shp_pallet WHERE id = ?', [id]))!;
    opened = true;
  }
  await trk.markPacked(t, caller, u.id, { commandId: input.commandId, box: p.code, station: input.station });   // refuses a held or unfinished unit
  await t.run('INSERT INTO shp_pallet_unit (unit_id, pallet_id, packed_at) VALUES (?, ?, ?)', [u.id, p.id, ctx.clock.now().toISOString()]);
  const r = await t.run('UPDATE shp_pallet SET units = units + 1, version = version + 1 WHERE id = ? AND version = ?', [p.id, p.version]);
  if (r.changes !== 1) conflict('pallet.changed', `pallet ${p.code} changed meanwhile; scan again`);
  p.units++; p.version++;
  await history(ctx, t, caller, { kind: 'PACK', pallet: p.code, unit_id: u.id, serial: u.serial, item_id: u.item_id }, input.commandId, day);
  let closed = false;
  if (p.units === p.capacity) { await closePallet(ctx, t, caller, p, input.commandId, day, 'full'); closed = true; }
  return { pallet: p.code, units: p.units, capacity: p.capacity, opened, closed, serial: u.serial };
}

async function closePallet(ctx: Ctx, t: Db, caller: Caller, p: Pallet, commandId: string, day: string, why: 'full' | 'partial') {
  await t.run(`UPDATE shp_pallet SET status = 'closed', closed_at = ?, closed_by = ?, version = version + 1 WHERE id = ?`, [ctx.clock.now().toISOString(), caller.name, p.id]);
  await history(ctx, t, caller, { kind: 'PALLET_CLOSE', pallet: p.code, item_id: p.item_id, detail: { units: p.units, capacity: p.capacity, why } }, commandId, day);
}

async function writeLines(ctx: Ctx, t: Db, orderId: string, lines: { itemId: string; qty: number }[]) {
  const seen = new Set<string>();
  for (const l of lines) {
    const i = await ctx.services.get('mdm').item(l.itemId, t);
    if (i.kind !== 'product') fail('order.not_product', `${i.code} cannot be shipped`);
    if (seen.has(i.id)) fail('order.duplicate', `${i.code} is listed twice`);
    seen.add(i.id);
    await t.run('INSERT INTO shp_order_line (order_id, item_id, qty) VALUES (?, ?, ?)', [orderId, i.id, l.qty]);
  }
}

async function loadedByItem(t: Db, orderId: string): Promise<Map<string, number>> {
  const rows = await t.all<{ item_id: string; n: number }>(`SELECT p.item_id, SUM(p.units) n FROM shp_pallet p JOIN shp_container c ON c.id = p.container_id WHERE c.order_id = ? GROUP BY p.item_id`, [orderId]);
  return new Map(rows.map((r) => [r.item_id, r.n]));
}

async function loadPallet(ctx: Ctx, t: Db, caller: Caller, containerId: string, code: string, commandId: string, day: string) {
  const c = (await t.get<Container>('SELECT * FROM shp_container WHERE id = ?', [containerId])) ?? notFound('container', containerId);
  if (c.status !== 'loading') conflict('container.dispatched', `container ${c.number} has already left`);
  const o = (await t.get<Order>('SELECT * FROM shp_order WHERE id = ?', [c.order_id]))!;
  const p = (await t.get<Pallet>('SELECT * FROM shp_pallet WHERE code = ?', [code])) ?? notFound('pallet', code);
  if (p.status === 'open') conflict('pallet.open', `pallet ${code} is still open (${p.units}/${p.capacity}): close it first`);
  if (p.status !== 'closed') conflict('pallet.not_available', `pallet ${code} is already ${p.status}`);
  const line = await t.get<{ qty: number }>('SELECT qty FROM shp_order_line WHERE order_id = ? AND item_id = ?', [o.id, p.item_id]);
  const item = await ctx.services.get('mdm').item(p.item_id, t);
  if (!line) conflict('order.wrong_item', `${o.code} does not order ${item.code}`);
  const already = (await loadedByItem(t, o.id)).get(p.item_id) ?? 0;
  if (already + p.units > line!.qty) conflict('order.over', `${o.code} orders ${line!.qty} × ${item.code}; ${already} are loaded, this pallet has ${p.units}`, { open: line!.qty - already });
  // the container's room: every pallet takes 1/(pallets of its product per container type)
  const spec = async (itemId: string) => { const s = await t.get<{ per_container: string }>('SELECT per_container FROM shp_spec WHERE item_id = ?', [itemId]); return s ? JSON.parse(s.per_container)[c.type] as number | undefined : undefined; };
  const inside = await t.all<{ item_id: string; n: number }>('SELECT item_id, COUNT(*) n FROM shp_pallet WHERE container_id = ? GROUP BY item_id', [c.id]);
  let used = 0;
  for (const r of inside) { const cap = await spec(r.item_id); if (cap) used += r.n / cap; }
  const mine = await spec(p.item_id);
  if (mine && used + 1 / mine > 1 + 1e-9) conflict('container.full', `${c.number} (${c.type}) is full for ${item.code}`);
  // nothing on hold leaves, and an outgoing inspection must have passed when the plant has one
  const held = await t.get<{ n: number }>('SELECT COUNT(*) n FROM shp_pallet_unit x JOIN trk_unit u ON u.id = x.unit_id WHERE x.pallet_id = ? AND u.held > 0', [p.id]);
  if (held!.n) conflict('pallet.held', `${held!.n} units on pallet ${code} are on quality hold`);
  if (ctx.services.has('qms') && await t.get(`SELECT 1 FROM qms_plan WHERE stage = 'oqc' AND active = 1 AND (item_id IS NULL OR item_id = ?)`, [p.item_id])) {
    const r = await ctx.services.get('qms').oqcResult(t, code);
    if (r === 'none') conflict('pallet.no_oqc', `pallet ${code} has not passed its outgoing inspection (OQC)`);
    if (r === 'failed') conflict('pallet.oqc_failed', `pallet ${code} FAILED its outgoing inspection`);
  }
  await t.run(`UPDATE shp_pallet SET status = 'loaded', container_id = ?, version = version + 1 WHERE id = ?`, [c.id, p.id]);
  await history(ctx, t, caller, { kind: 'LOAD', pallet: code, container: c.number, order_code: o.code, item_id: p.item_id, detail: { units: p.units } }, commandId, day);
  const total = await t.get<{ pallets: number; units: number }>('SELECT COUNT(*) pallets, COALESCE(SUM(units), 0) units FROM shp_pallet WHERE container_id = ?', [c.id]);
  return { pallet: code, container: c.number, item: item.code, units: p.units, orderLoaded: already + p.units, orderQty: line!.qty, containerPallets: total!.pallets, containerUnits: total!.units, fill: Math.round((used + (mine ? 1 / mine : 0)) * 100) };
}

async function dispatch(ctx: Ctx, t: Db, caller: Caller, id: string, seal: string, commandId: string, day: string) {
  const c = (await t.get<Container>('SELECT * FROM shp_container WHERE id = ?', [id])) ?? notFound('container', id);
  if (c.status !== 'loading') conflict('container.dispatched', `container ${c.number} has already left`);
  const o = (await t.get<Order>('SELECT * FROM shp_order WHERE id = ?', [c.order_id]))!;
  const pallets = await t.all<Pallet>('SELECT * FROM shp_pallet WHERE container_id = ?', [c.id]);
  if (!pallets.length) conflict('container.empty', `container ${c.number} is empty`);
  const trk = ctx.services.get('trk');
  const lines = new Map<string, { item_id: string; warehouse_id: string; units: number; pallets: Set<string>; serials: string[] }>();
  for (const p of pallets) {
    const units = await t.all<UnitRow & { warehouse_id: string }>(`SELECT u.*, w.warehouse_id FROM shp_pallet_unit x JOIN trk_unit u ON u.id = x.unit_id JOIN exe_work_order w ON w.id = u.work_order_id WHERE x.pallet_id = ?`, [p.id]);
    await trk.markShipped(t, caller, units.map((u) => u.id), { commandId, shipment: o.code, container: c.number });   // refuses held units
    for (const u of units) {
      const k = u.item_id + '|' + u.warehouse_id;
      const l = lines.get(k) ?? { item_id: u.item_id, warehouse_id: u.warehouse_id, units: 0, pallets: new Set<string>(), serials: [] };
      l.units++; l.pallets.add(p.code); l.serials.push(u.serial);
      lines.set(k, l);
    }
    await t.run(`UPDATE shp_pallet SET status = 'shipped', version = version + 1 WHERE id = ?`, [p.id]);
  }
  const at = ctx.clock.now().toISOString();
  await t.run(`UPDATE shp_container SET status = 'dispatched', seal = ?, dispatched_at = ?, dispatched_by = ? WHERE id = ?`, [seal, at, caller.name, c.id]);
  const seq = await history(ctx, t, caller, { kind: 'DISPATCH', container: c.number, order_code: o.code, detail: { seal, pallets: pallets.length, units: [...lines.values()].reduce((a, l) => a + l.units, 0) } }, commandId, day);
  const mdm = ctx.services.get('mdm');
  const payloadLines = [];
  const soOf = new Map((await t.all<{ item_id: string; so_id: string | null; so_code: string | null; so_line_no: number | null }>('SELECT item_id, so_id, so_code, so_line_no FROM shp_order_line WHERE order_id = ?', [o.id])).map((r) => [r.item_id, r]));
  for (const l of lines.values()) {
    const i = await mdm.item(l.item_id, t), w = await mdm.warehouse(l.warehouse_id, t);
    const so = soOf.get(l.item_id);
    payloadLines.push({ item: { id: i.id, code: i.code }, qty: formatQty(l.units * 1000), uom: i.base_uom, warehouse: { id: w.id, code: w.code }, pallets: l.pallets.size, ...(i.tracking === 'serial' ? { serials: l.serials } : {}),
      ...(so?.so_id && so.so_code && so.so_line_no ? { sales_order: { id: so.so_id, code: so.so_code, line_no: so.so_line_no } } : {}) });
  }
  const party = (o as Order & { customer_party_id?: string | null; customer_party_code?: string | null });
  const ev = await ctx.services.get('eco').publish(t, {
    type: 'mes.shipment.dispatched.v1', subject: `shipment/${o.id}`, correlation: `shipment/${o.id}`, causation: commandId,
    data: { shipment: { id: o.id, code: o.code, customer: o.customer, ...(o.destination ? { destination: o.destination } : {}), ...(party.customer_party_id && party.customer_party_code ? { customer_party: { id: party.customer_party_id, code: party.customer_party_code } } : {}) }, container: { id: c.id, number: c.number, seal, type: c.type },
      lines: payloadLines, dispatched_at: at, production_date: day, performed_by: { user: caller.name }, shipping_seq: seq },
  });
  // the order is shipped when every line is fully loaded in dispatched containers
  const ordered = await t.all<{ item_id: string; qty: number }>('SELECT item_id, qty FROM shp_order_line WHERE order_id = ?', [o.id]);
  const gone = await t.all<{ item_id: string; n: number }>(`SELECT p.item_id, SUM(p.units) n FROM shp_pallet p JOIN shp_container k ON k.id = p.container_id WHERE k.order_id = ? AND k.status = 'dispatched' GROUP BY p.item_id`, [o.id]);
  const done = ordered.every((l) => (gone.find((g) => g.item_id === l.item_id)?.n ?? 0) >= l.qty);
  if (done) await t.run(`UPDATE shp_order SET status = 'shipped', version = version + 1 WHERE id = ?`, [o.id]);
  return { container: c.number, seal, pallets: pallets.length, units: payloadLines.reduce((a, l) => a + Number(l.qty), 0), eventId: ev.id, orderShipped: done };
}

async function orderView(ctx: Ctx, db: Db, id: string) {
  const o = (await db.get<Order & Record<string, unknown>>('SELECT * FROM shp_order WHERE id = ? OR code = ?', [id, id])) ?? notFound('shipping_order', id);
  const loaded = await loadedByItem(db, o.id);
  const shipped = new Map((await db.all<{ item_id: string; n: number }>(`SELECT p.item_id, SUM(p.units) n FROM shp_pallet p JOIN shp_container k ON k.id = p.container_id WHERE k.order_id = ? AND k.status = 'dispatched' GROUP BY p.item_id`, [o.id])).map((r) => [r.item_id, r.n]));
  const lines = await db.all<{ item_id: string; qty: number; so_id: string | null; so_code: string | null; so_line_no: number | null; code: string; name_en: string; name_ar: string }>(`SELECT l.item_id, l.qty, l.so_id, l.so_code, l.so_line_no, i.code, i.name_en, i.name_ar FROM shp_order_line l JOIN mdm_item i ON i.id = l.item_id WHERE l.order_id = ? ORDER BY i.code`, [o.id]);
  const containers = await db.all<any>(`SELECT c.*, (SELECT COUNT(*) FROM shp_pallet p WHERE p.container_id = c.id) pallets, (SELECT COALESCE(SUM(units), 0) FROM shp_pallet p WHERE p.container_id = c.id) units
    FROM shp_container c WHERE c.order_id = ? ORDER BY c.opened_at`, [o.id]);
  return { ...o, lines: lines.map((l) => ({ ...l, loaded: loaded.get(l.item_id) ?? 0, shipped: shipped.get(l.item_id) ?? 0 })), containers };
}

async function containerView(ctx: Ctx, db: Db, id: string) {
  const c = (await db.get<any>('SELECT c.*, o.code order_code, o.customer, o.destination FROM shp_container c JOIN shp_order o ON o.id = c.order_id WHERE c.id = ? OR c.number = ? ORDER BY c.opened_at DESC', [id, id])) ?? notFound('container', id);
  const pallets = await db.all<any>(`SELECT p.code, p.units, p.capacity, p.status, i.code item_code, i.name_en, i.name_ar FROM shp_pallet p JOIN mdm_item i ON i.id = p.item_id WHERE p.container_id = ? ORDER BY p.code`, [c.id]);
  const order = await orderView(ctx, db, c.order_id);
  return { ...c, pallets, order: { code: order.code, customer: order.customer, destination: order.destination, lines: order.lines } };
}
