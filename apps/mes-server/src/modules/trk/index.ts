import { z } from 'zod';
import { formatQty, parseQty, QuantityError } from '@eco/contracts';
import type { TrkService, UnitRow } from '../../contracts/services.js';
import { verifyChain } from '../../kernel/chain.js';
import { runCommand } from '../../kernel/commands.js';
import type { Db } from '../../kernel/db.js';
import { conflict, fail, notFound } from '../../kernel/errors.js';
import type { AppModule, Ctx } from '../../kernel/modules.js';
import { load, repair, scan, scrapUnit, stationOf, unitBySerial, unload } from './flow.js';
import { EVENT_FIELDS, event, setUnit, today, trkMigration, trkMigration2 } from './store.js';
import { applyGoodsReceipt, receivingMigration, receivingRoutes } from './receiving.js';

/**
 * Tracking: serial units along their routing, key parts and material lots, the WIP, and traceability both ways
 * (EXE2020 in serial mode, EXE3020 unit history, WIP3010/WIP3020, TRC2010/TRC3010/TRC3020). ADR-034.
 */
const zPerson = z.object({ id: z.string().uuid(), code: z.string().min(1).max(64) }).optional();
const zOperational = { commandId: z.string(), productionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), shift: z.string().min(1).max(20).optional(), person: zPerson };
const zQty = z.string().transform((v, c) => {
  try { const n = parseQty(v); if (n <= 0) throw new QuantityError('qty.range', 'must be greater than zero'); return n; }
  catch (e) { if (!(e instanceof QuantityError)) throw e; c.addIssue({ code: 'custom', message: `${e.code}: ${e.message}` }); return z.NEVER; }
});

export const trkModule: AppModule = {
  id: 'trk',
  dependsOn: ['system', 'mdm', 'eng', 'exe'],
  scopes: ['trk.units.read', 'trk.units.write', 'trk.materials.write', 'trk.repair.write'],
  migrations: [trkMigration, trkMigration2, receivingMigration],

  setup(ctx) {
    const service: TrkService = {
      unit: (serial, t) => unitBySerial(t ?? ctx.db, serial),
      applyGoodsReceipt: (t, gr) => applyGoodsReceipt(ctx, t, gr),
      unitById: (id, t) => (t ?? ctx.db).get<UnitRow>('SELECT * FROM trk_unit WHERE id = ?', [id]),
      async unitsOf(t, target) {
        if (target.workOrderId) return t.all<UnitRow>(`SELECT * FROM trk_unit WHERE work_order_id = ? AND status NOT IN ('scrapped', 'consumed') ORDER BY serial`, [target.workOrderId]);
        const out: UnitRow[] = [];
        for (const s of target.serials ?? []) { const u = await unitBySerial(t, s); if (u && u.status !== 'scrapped' && u.status !== 'consumed') out.push(u); }
        return out;
      },
      async hold(t, caller, ids, ref) {
        let n = 0;
        for (const id of ids) {
          const u = (await t.get<UnitRow>('SELECT * FROM trk_unit WHERE id = ?', [id])) ?? notFound('unit', id);
          await event(ctx, t, caller, { commandId: ref.commandId, kind: 'HOLD', unit: u, op_seq: u.op_seq, op_code: u.op_code, detail: { hold: ref.holdId, reason: ref.reason } });
          await setUnit(ctx, t, u, { held: u.held + 1 });
          n++;
        }
        return n;
      },
      async release(t, caller, ids, ref) {
        let n = 0;
        for (const id of ids) {
          const u = (await t.get<UnitRow>('SELECT * FROM trk_unit WHERE id = ?', [id])) ?? notFound('unit', id);
          if (u.held < 1) continue;
          await event(ctx, t, caller, { commandId: ref.commandId, kind: 'RELEASE', unit: u, op_seq: u.op_seq, op_code: u.op_code, detail: { hold: ref.holdId } });
          await setUnit(ctx, t, u, { held: u.held - 1 });
          n++;
        }
        return n;
      },
      async markPacked(t, caller, id, ref) {
        const u = (await t.get<UnitRow>('SELECT * FROM trk_unit WHERE id = ?', [id])) ?? notFound('unit', id);
        if (u.held > 0) conflict('unit.held', `${u.serial} is on quality hold`);
        if (u.status !== 'completed') conflict('unit.not_packable', `${u.serial} is ${u.status}: only a finished unit is packed`);
        await event(ctx, t, caller, { commandId: ref.commandId, kind: 'PACK', unit: u, station: ref.station ?? null, detail: { box: ref.box } });
        await setUnit(ctx, t, u, { status: 'packed' });
      },
      async markUnpacked(t, caller, id, ref) {
        const u = (await t.get<UnitRow>('SELECT * FROM trk_unit WHERE id = ?', [id])) ?? notFound('unit', id);
        if (u.status !== 'packed') conflict('unit.not_packed', `${u.serial} is ${u.status}`);
        await event(ctx, t, caller, { commandId: ref.commandId, kind: 'UNPACK', unit: u, detail: { box: ref.box, reason: ref.reason } });
        await setUnit(ctx, t, u, { status: 'completed' });
      },
      async markShipped(t, caller, ids, ref) {
        for (const id of ids) {
          const u = (await t.get<UnitRow>('SELECT * FROM trk_unit WHERE id = ?', [id])) ?? notFound('unit', id);
          if (u.held > 0) conflict('unit.held', `${u.serial} is on quality hold`);
          if (u.status !== 'packed') conflict('unit.not_packed', `${u.serial} is ${u.status}: only packed units are shipped`);
          await event(ctx, t, caller, { commandId: ref.commandId, kind: 'SHIP', unit: u, detail: { shipment: ref.shipment, container: ref.container } });
          await setUnit(ctx, t, u, { status: 'shipped' });
        }
      },
      async scrapUnit(t, caller, serial, ref) { await scrapUnit(ctx, t, caller, { commandId: ref.commandId, serial, reasonCode: ref.reasonCode }); },
      async toRepair(t, caller, id, ref) {
        const u = (await t.get<UnitRow>('SELECT * FROM trk_unit WHERE id = ?', [id])) ?? notFound('unit', id);
        if (u.status !== 'wip') conflict('unit.not_in_process', `${u.serial} is ${u.status}`);
        await event(ctx, t, caller, { commandId: ref.commandId, kind: 'FAIL', unit: u, op_seq: u.op_seq, op_code: u.op_code, defect_code: ref.defectCode, detail: { by: 'quality' } });
        await setUnit(ctx, t, u, { status: 'repair', fail_op_seq: u.op_seq });
      },
    };
    ctx.services.provide('trk', service);
  },

  routes(kit, ctx) {
    const { http, require } = kit;
    receivingRoutes(kit, ctx);
    const person = (t: Db, p: { id: string; code: string } | undefined, at: { station?: string; date: string }) => ctx.services.get('mdm').resolvePerson(t, p, at);

    // ------------------------------------------------------------------ the station (EXE2020, serial mode)
    http.post('/api/units/scan', async (req) => {
      const caller = require(req, 'trk.units.write');
      const input = z.object({ ...zOperational, station: z.string().trim().min(1), serial: z.string().trim().min(1).max(40), workOrderId: z.string().optional(),
        result: z.enum(['pass', 'fail']).default('pass'), defectCode: z.string().trim().min(1).max(40).optional(),
        parts: z.array(z.object({ serial: z.string().trim().min(1).max(40), itemId: z.string().optional() })).max(20).optional() }).parse(req.body);
      const { result, replayed } = await runCommand(ctx, caller, { id: input.commandId, type: 'ScanUnit', request: req.body }, async (t) => {
        input.person = await person(t, input.person, { station: input.station, date: input.productionDate ?? today(ctx) });
        return scan(ctx, t, caller, input);
      });
      return { ...result, replayed };
    });
    http.post('/api/units/:serial/repair', async (req) => {
      const caller = require(req, 'trk.repair.write');
      const input = z.object({ ...zOperational, station: z.string().optional(), cause: z.string().trim().min(1).max(60), action: z.string().trim().min(1).max(60),
        defectCode: z.string().trim().max(40).optional(),
        replace: z.object({ oldSerial: z.string().trim().min(1).max(40), newSerial: z.string().trim().min(1).max(40) }).optional() }).parse(req.body);
      const serial = (req.params as { serial: string }).serial;
      const { result, replayed } = await runCommand(ctx, caller, { id: input.commandId, type: 'RepairUnit', request: { serial, ...(req.body as object) } }, async (t) => {
        input.person = await person(t, input.person, { station: input.station, date: input.productionDate ?? today(ctx) });
        return repair(ctx, t, caller, { ...input, serial });
      });
      return { ...result, replayed };
    });
    http.post('/api/units/:serial/scrap', async (req) => {
      const caller = require(req, 'trk.units.write');
      const input = z.object({ ...zOperational, station: z.string().optional(), reasonCode: z.string().trim().min(1).max(40) }).parse(req.body);
      const serial = (req.params as { serial: string }).serial;
      const { result, replayed } = await runCommand(ctx, caller, { id: input.commandId, type: 'ScrapUnit', request: { serial, ...(req.body as object) } }, async (t) => {
        input.person = await person(t, input.person, { station: input.station, date: input.productionDate ?? today(ctx) });
        return scrapUnit(ctx, t, caller, { ...input, serial });
      });
      return { ...result, replayed };
    });

    // ------------------------------------------------------------------ material on stations
    http.get('/api/stations/:code/loads', async (req) => {
      require(req, 'trk.units.read');
      const code = (req.params as { code: string }).code;
      const open = await ctx.db.all(`SELECT l.*, i.code item_code, i.name_en, i.name_ar,
          (SELECT COALESCE(SUM(units), 0) FROM trk_load_use u WHERE u.load_id = l.id) units
        FROM trk_load l JOIN mdm_item i ON i.id = l.item_id WHERE l.station = ? AND l.unloaded_at IS NULL ORDER BY i.code`, [code]);
      const where = await ctx.db.tx((t) => stationOf(ctx, t, code)).catch(() => null);
      // what the running order's BOM expects at this station, so the screen can say what is missing
      let expected: { item_id: string; code: string; name_en: string; name_ar: string; scan: string }[] = [];
      if (where) {
        const wo = await ctx.db.get<{ bom_id: string | null }>(`SELECT bom_id FROM exe_work_order WHERE line_code = ? AND status = 'released' AND bom_id IS NOT NULL ORDER BY priority, production_date, code LIMIT 1`, [where.line.code]);
        if (wo?.bom_id) expected = (await ctx.services.get('eng').bom(wo.bom_id)).lines.filter((l) => l.op_code === where.op && l.scan !== 'none')
          .map((l) => ({ item_id: l.component_id, code: l.component_code, name_en: l.name_en, name_ar: l.name_ar, scan: l.scan }));
      }
      return { open, expected };
    });
    http.get('/api/loads', async (req) => {
      require(req, 'trk.units.read');
      const q = z.object({ line: z.string().optional(), all: z.enum(['1']).optional() }).parse(req.query);
      const where = [q.all ? '1 = 1' : 'l.unloaded_at IS NULL'];
      const p: string[] = [];
      if (q.line) { where.push('l.line_code = ?'); p.push(q.line); }
      return ctx.db.all(`SELECT l.*, i.code item_code, i.name_en, i.name_ar, (SELECT COALESCE(SUM(units), 0) FROM trk_load_use u WHERE u.load_id = l.id) units
        FROM trk_load l JOIN mdm_item i ON i.id = l.item_id WHERE ${where.join(' AND ')} ORDER BY l.loaded_at DESC LIMIT 3000`, p);
    });
    http.post('/api/stations/:code/loads', async (req) => {
      const caller = require(req, 'trk.materials.write');
      const input = z.object({ commandId: z.string(), itemId: z.string(), lotNo: z.string().trim().min(1).max(64), warehouseId: z.string() }).parse(req.body);
      const station = (req.params as { code: string }).code;
      const { result, replayed } = await runCommand(ctx, caller, { id: input.commandId, type: 'LoadMaterial', request: { station, ...(req.body as object) } }, (t) => load(ctx, t, caller, { ...input, station }));
      return { ...result, replayed };
    });
    http.post('/api/loads/:id/unload', async (req) => {
      const caller = require(req, 'trk.materials.write');
      const input = z.object({ ...zOperational }).parse(req.body);
      const loadId = (req.params as { id: string }).id;
      const { result, replayed } = await runCommand(ctx, caller, { id: input.commandId, type: 'UnloadMaterial', request: { loadId, ...(req.body as object) } }, (t) => unload(ctx, t, caller, { ...input, loadId }));
      return { ...result, replayed };
    });

    // ------------------------------------------------------------------ supplier lots (TRC2010)
    http.get('/api/material-lots', async (req) => {
      require(req, 'trk.units.read');
      const q = z.object({ item: z.string().optional(), lot: z.string().optional() }).parse(req.query);
      const rows = await ctx.db.all<any>(`SELECT m.*, i.code item_code, i.name_en, i.name_ar, i.base_uom,
          (SELECT COUNT(*) FROM trk_genealogy g WHERE g.item_id = m.item_id AND g.lot_no = m.lot_no) used_in,
          (SELECT COUNT(*) FROM trk_load l WHERE l.item_id = m.item_id AND l.lot_no = m.lot_no AND l.unloaded_at IS NULL) loaded_now
        FROM trk_material_lot m JOIN mdm_item i ON i.id = m.item_id ORDER BY m.received_at DESC LIMIT 2000`);
      const it = (q.item ?? '').toLowerCase(), lot = (q.lot ?? '').toLowerCase();
      return rows.filter((r) => (!it || (r.item_code + ' ' + r.name_en + ' ' + r.name_ar).toLowerCase().includes(it)) && (!lot || (r.lot_no + ' ' + (r.supplier_lot ?? '')).toLowerCase().includes(lot)))
        .map((r) => ({ ...r, qty: formatQty(r.qty) }));
    });
    http.post('/api/material-lots', async (req) => {
      const caller = require(req, 'trk.materials.write');
      if (ctx.config.ownership.item !== 'gmes') conflict('mdm.not_owner', 'Material receipts are recorded by accounting (Mizan) in this installation; a lot scanned here is marked "not verified"');
      const input = z.object({ itemId: z.string(), lotNo: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9._-]{1,63}$/), qty: zQty, supplier: z.string().trim().max(80).optional(),
        supplierLot: z.string().trim().max(64).optional(), expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.body);
      return ctx.db.tx(async (t) => {
        const item = await ctx.services.get('mdm').item(input.itemId, t);
        if (await t.get('SELECT 1 FROM trk_material_lot WHERE item_id = ? AND lot_no = ?', [item.id, input.lotNo])) conflict('lot.exists', `lot ${input.lotNo} of ${item.code} is already registered`);
        await t.run('INSERT INTO trk_material_lot (item_id, lot_no, supplier, supplier_lot, qty, expires_on, received_at, received_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [item.id, input.lotNo, input.supplier ?? null, input.supplierLot ?? null, input.qty, input.expiresOn ?? null, ctx.clock.now().toISOString(), caller.name]);
        // loads of this lot made before it was registered become verified
        await t.run('UPDATE trk_load SET verified = 1 WHERE item_id = ? AND lot_no = ?', [item.id, input.lotNo]);
        return { itemId: item.id, lotNo: input.lotNo };
      });
    });

    // ------------------------------------------------------------------ units: list and history (EXE3020)
    http.get('/api/units', async (req) => {
      require(req, 'trk.units.read');
      const q = z.object({ wo: z.string().optional(), line: z.string().optional(), status: z.string().optional(), op: z.string().optional(), serial: z.string().optional(),
        held: z.enum(['1']).optional(), limit: z.coerce.number().int().min(1).max(5000).default(500) }).parse(req.query);
      const where: string[] = [], p: string[] = [];
      if (q.wo) { where.push('(u.work_order_id = ? OR w.code = ?)'); p.push(q.wo, q.wo); }
      if (q.line) { where.push('u.line_code = ?'); p.push(q.line); }
      if (q.status) { where.push('u.status = ?'); p.push(q.status); }
      if (q.op) { where.push('u.op_code = ?'); p.push(q.op); }
      if (q.serial) { where.push('u.serial LIKE ?'); p.push('%' + q.serial.trim().toUpperCase() + '%'); }
      if (q.held) where.push('u.held > 0');
      return ctx.db.all(`SELECT u.*, w.code wo_code, i.code item_code, i.name_en, i.name_ar FROM trk_unit u JOIN exe_work_order w ON w.id = u.work_order_id JOIN mdm_item i ON i.id = u.item_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY u.updated_at DESC LIMIT ${q.limit}`, p);
    });
    http.get('/api/units/:serial', async (req) => {
      require(req, 'trk.units.read');
      return unitHistory(ctx, (req.params as { serial: string }).serial);
    });

    // ------------------------------------------------------------------ WIP (WIP3010 / WIP3020)
    http.get('/api/wip', async (req) => {
      require(req, 'trk.units.read');
      const q = z.object({ line: z.string().optional() }).parse(req.query);
      const rows = await ctx.db.all<{ line_code: string; work_order_id: string; op_seq: number | null; op_code: string | null; status: string; held: number; n: number; oldest: string }>(
        `SELECT line_code, work_order_id, op_seq, op_code, status, CASE WHEN held > 0 THEN 1 ELSE 0 END held, COUNT(*) n, MIN(updated_at) oldest FROM trk_unit
         WHERE status IN ('wip', 'repair') ${q.line ? 'AND line_code = ?' : ''} GROUP BY line_code, work_order_id, op_seq, op_code, status, CASE WHEN held > 0 THEN 1 ELSE 0 END`, q.line ? [q.line] : []);
      const orders = new Map<string, any>();
      for (const r of rows) if (!orders.has(r.work_order_id)) {
        const wo = await ctx.services.get('exe').workOrder(r.work_order_id);
        const item = await ctx.services.get('mdm').item(wo.item_id);
        const route = wo.routing_id ? (await ctx.services.get('eng').routing(wo.routing_id)).operations : [];
        orders.set(r.work_order_id, { id: wo.id, code: wo.code, line: wo.line_code, item: { code: item.code, name_en: item.name_en, name_ar: item.name_ar },
          planned: wo.planned_qty / 1000, completed: wo.completed_qty / 1000, scrapped: wo.scrapped_qty / 1000, route: route.map((o) => ({ seq: o.seq, code: o.code, name_en: o.name_en, name_ar: o.name_ar, kind: o.kind })),
          at: {} as Record<string, { queued: number; repair: number; held: number; oldest: string }> });
      }
      for (const r of rows) {
        const o = orders.get(r.work_order_id);
        const k = r.op_code ?? '?';
        const cell = (o.at[k] ??= { queued: 0, repair: 0, held: 0, oldest: r.oldest });
        if (r.held) cell.held += r.n; else if (r.status === 'repair') cell.repair += r.n; else cell.queued += r.n;
        if (r.oldest < cell.oldest) cell.oldest = r.oldest;
      }
      return [...orders.values()].sort((a, b) => (a.line ?? '').localeCompare(b.line ?? '') || a.code.localeCompare(b.code));
    });
    http.get('/api/wip/ageing', async (req) => {
      require(req, 'trk.units.read');
      const q = z.object({ hours: z.coerce.number().min(0).max(24 * 60).default(4), line: z.string().optional() }).parse(req.query);
      const before = new Date(ctx.clock.now().getTime() - q.hours * 3600_000).toISOString();
      return ctx.db.all(`SELECT u.serial, u.status, u.held, u.line_code, u.op_code, u.last_station, u.updated_at, w.code wo_code, i.code item_code, i.name_en, i.name_ar
        FROM trk_unit u JOIN exe_work_order w ON w.id = u.work_order_id JOIN mdm_item i ON i.id = u.item_id
        WHERE u.status IN ('wip', 'repair', 'completed') AND u.updated_at < ? ${q.line ? 'AND u.line_code = ?' : ''} ORDER BY u.updated_at LIMIT 2000`, q.line ? [before, q.line] : [before]);
    });

    // ------------------------------------------------------------------ unit history and station events (EXE3030)
    http.get('/api/unit-events', async (req) => {
      require(req, 'trk.units.read');
      const q = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), kind: z.string().optional(), station: z.string().optional(), line: z.string().optional(),
        serial: z.string().optional(), limit: z.coerce.number().int().min(1).max(5000).default(1000) }).parse(req.query);
      const where: string[] = [], p: string[] = [];
      if (q.date) { where.push('production_date = ?'); p.push(q.date); }
      if (q.kind) { where.push('kind = ?'); p.push(q.kind); }
      if (q.station) { where.push('station = ?'); p.push(q.station); }
      if (q.line) { where.push('line_code = ?'); p.push(q.line); }
      if (q.serial) { where.push('serial = ?'); p.push(q.serial.trim().toUpperCase()); }
      return ctx.db.all(`SELECT seq, kind, serial, line_code, station, op_code, defect_code, detail, user_name, production_date, shift_code, occurred_at FROM trk_event
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY seq DESC LIMIT ${q.limit}`, p);
    });

    // ------------------------------------------------------------------ traceability (TRC3010 backward, TRC3020 forward)
    http.get('/api/trace/backward/:serial', async (req) => {
      require(req, 'trk.units.read');
      const serial = (req.params as { serial: string }).serial.trim().toUpperCase();
      const u = (await unitBySerial(ctx.db, serial)) ?? notFound('unit', serial);
      const tree = async (id: string, depth: number): Promise<any[]> => {
        if (depth > 8) return [];
        const parts = await ctx.db.all<any>(`SELECT g.*, i.code item_code, i.name_en, i.name_ar, c.serial child_serial, c.work_order_id child_wo, c.line_code child_line, c.completed_at child_done
          FROM trk_genealogy g JOIN mdm_item i ON i.id = g.item_id LEFT JOIN trk_unit c ON c.id = g.child_id WHERE g.parent_id = ? AND g.removed_seq IS NULL ORDER BY g.event_seq`, [id]);
        const out = [];
        for (const p of parts) {
          const wo = p.child_wo ? await ctx.services.get('exe').workOrder(p.child_wo) : null;
          out.push({ kind: p.kind, item: { code: p.item_code, name_en: p.name_en, name_ar: p.name_ar },
            serial: p.child_serial ?? (p.kind === 'part' ? p.lot_no : null), lot: p.kind === 'lot' ? p.lot_no : null, qty: formatQty(p.qty), op: p.op_code, station: p.station, at: p.at, verified: !!p.verified,
            work_order: wo ? { code: wo.code, line: wo.line_code, date: wo.production_date } : null, done_at: p.child_done ?? null,
            parts: p.child_id ? await tree(p.child_id, depth + 1) : [] });
        }
        return out;
      };
      const history = await unitHistory(ctx, serial);
      return { unit: history.unit, route: history.route, events: history.events, parts: await tree(u.id, 0) };
    });
    http.get('/api/trace/forward', async (req) => {
      require(req, 'trk.units.read');
      const q = z.object({ item: z.string().optional(), lot: z.string().optional(), serial: z.string().optional() }).parse(req.query);
      let start: { id: string }[] = [];
      if (q.serial) {
        const s = q.serial.trim().toUpperCase();
        const u = await unitBySerial(ctx.db, s);
        start = u ? await ctx.db.all('SELECT parent_id id FROM trk_genealogy WHERE child_id = ? AND removed_seq IS NULL', [u.id])
          : await ctx.db.all(`SELECT parent_id id FROM trk_genealogy WHERE lot_no = ? AND kind = 'part' AND removed_seq IS NULL`, [s]);
      } else if (q.lot) {
        const lot = q.lot.trim().toUpperCase();
        let itemId: string | null = null;
        if (q.item) itemId = (await ctx.db.get<{ id: string }>('SELECT id FROM mdm_item WHERE id = ? OR code = ?', [q.item, q.item]))?.id ?? null;
        start = await ctx.db.all(`SELECT DISTINCT parent_id id FROM trk_genealogy WHERE lot_no = ? AND removed_seq IS NULL ${itemId ? 'AND item_id = ?' : ''}`, itemId ? [lot, itemId] : [lot]);
      } else fail('trace.what', 'give a lot (and its item) or a serial to trace forward');
      // climb to every unit that contains it, then report the top-level products (what would be recalled)
      const seen = new Set<string>();
      const all: UnitRow[] = [];
      let frontier = start.map((s) => s.id);
      while (frontier.length && seen.size < 200_000) {
        const next: string[] = [];
        for (const id of frontier) {
          if (seen.has(id)) continue;
          seen.add(id);
          const u = await ctx.db.get<UnitRow>('SELECT * FROM trk_unit WHERE id = ?', [id]);
          if (!u) continue;
          all.push(u);
          if (u.parent_id) next.push(u.parent_id);
        }
        frontier = next;
      }
      const shp = ctx.services.has('shp') ? ctx.services.get('shp') : null;
      const rows = [];
      for (const u of all) {
        const wo = await ctx.services.get('exe').workOrder(u.work_order_id);
        const item = await ctx.services.get('mdm').item(u.item_id);
        rows.push({ serial: u.serial, item: { code: item.code, name_en: item.name_en, name_ar: item.name_ar }, status: u.status, held: u.held, top: !u.parent_id,
          work_order: wo.code, line: u.line_code, completed_at: u.completed_at, where: shp ? await shp.whereIs(u.id) : null });
      }
      rows.sort((a, b) => Number(b.top) - Number(a.top) || a.serial.localeCompare(b.serial));
      return { count: rows.length, topLevel: rows.filter((r) => r.top).length, shipped: rows.filter((r) => r.status === 'shipped').length, units: rows };
    });

    http.get('/api/trk/verify', async (req) => {
      require(req, 'trk.units.read');
      return verifyChain(ctx.db, 'trk_event', EVENT_FIELDS);
    });
  },

  async health(ctx) {
    const v = await verifyChain(ctx.db, 'trk_event', EVENT_FIELDS);
    // projection check: every completed or scrapped unit is exactly one line of the production ledger. Only for products that are made as
    // units (serial tracking): a product made and reported by lot or quantity (tiles, powders) has no units, and its ledger is checked by exe.
    const drift = await ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM exe_work_order w WHERE w.routing_id IS NOT NULL
      AND (SELECT i.tracking FROM mdm_item i WHERE i.id = w.item_id) = 'serial' AND (
        (SELECT COUNT(*) FROM trk_unit u WHERE u.work_order_id = w.id AND u.status IN ('completed', 'consumed', 'packed', 'shipped')) * 1000
          <> (SELECT COALESCE(SUM(qty), 0) FROM exe_ledger l WHERE l.work_order_id = w.id AND l.txn_type = 'COMPLETE')
     OR (SELECT COUNT(*) FROM trk_unit u WHERE u.work_order_id = w.id AND u.status = 'scrapped') * 1000
          <> (SELECT COALESCE(SUM(qty), 0) FROM exe_ledger l WHERE l.work_order_id = w.id AND l.txn_type = 'SCRAP'))`);
    return [
      { id: 'unit_history_chain', ok: v.ok, details: { rows: v.rows, firstBadSeq: v.firstBadSeq } },
      { id: 'units_match_ledger', ok: drift!.n === 0, details: { ordersOutOfStep: drift!.n } },
    ];
  },
};

async function unitHistory(ctx: Ctx, rawSerial: string) {
  const serial = rawSerial.trim().toUpperCase();
  const u = (await unitBySerial(ctx.db, serial)) ?? notFound('unit', serial);
  const wo = await ctx.services.get('exe').workOrder(u.work_order_id);
  const item = await ctx.services.get('mdm').item(u.item_id);
  const events = await ctx.db.all<any>(`SELECT seq, kind, station, op_seq, op_code, defect_code, detail, user_name, person_id, production_date, shift_code, occurred_at
    FROM trk_event WHERE unit_id = ? ORDER BY seq`, [u.id]);
  const ops = wo.routing_id ? (await ctx.services.get('eng').routing(wo.routing_id)).operations : [];
  const route = ops.map((o) => {
    const passes = events.filter((e) => e.op_seq === o.seq && (e.kind === 'PASS' || e.kind === 'FAIL'));
    const last = passes[passes.length - 1];
    const state = u.status === 'scrapped' && u.op_seq === o.seq ? 'scrapped' : u.status === 'repair' && u.op_seq === o.seq ? 'repair'
      : last?.kind === 'PASS' ? 'done' : u.op_seq === o.seq ? 'next' : 'pending';
    return { seq: o.seq, code: o.code, name_en: o.name_en, name_ar: o.name_ar, kind: o.kind, state, tries: passes.length, at: last?.occurred_at ?? null, station: last?.station ?? null, by: last?.user_name ?? null };
  });
  const parent = u.parent_id ? await ctx.db.get<{ serial: string }>('SELECT serial FROM trk_unit WHERE id = ?', [u.parent_id]) : null;
  const parts = await ctx.db.all<any>(`SELECT g.kind, g.removed_seq, g.lot_no, g.qty, g.op_code, g.station, g.verified, g.at, i.code item_code, i.name_en, i.name_ar, c.serial child_serial
    FROM trk_genealogy g JOIN mdm_item i ON i.id = g.item_id LEFT JOIN trk_unit c ON c.id = g.child_id WHERE g.parent_id = ? ORDER BY g.event_seq`, [u.id]);
  const where = ctx.services.has('shp') ? await ctx.services.get('shp').whereIs(u.id) : null;
  return {
    unit: { ...u, work_order: { id: wo.id, code: wo.code, line: wo.line_code, date: wo.production_date, shift: wo.shift_code }, item: { code: item.code, name_en: item.name_en, name_ar: item.name_ar },
      parent: parent?.serial ?? null, where },
    route, events: events.map((e) => ({ ...e, detail: e.detail ? JSON.parse(e.detail) : null })),
    parts: parts.map((p) => ({ ...p, qty: formatQty(p.qty) })),
  };
}
