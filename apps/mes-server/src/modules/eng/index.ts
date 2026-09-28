import { z } from 'zod';
import { formatQty, parseQty, QuantityError } from '@eco/contracts';
import type { Bom, BomLine, EngService, ProdShift, RouteOp, Routing } from '../../contracts/services.js';
import type { Db } from '../../kernel/db.js';
import { conflict, fail, notFound } from '../../kernel/errors.js';
import type { AppModule, Ctx } from '../../kernel/modules.js';

/**
 * Engineering: the MANUFACTURING facet of an item (docs/ecosystem/02: "BOM, routing, cycle time, inspection plans:
 * manufacturing"), and the plant's production calendar.
 *
 * * A routing is the ordered list of operations a unit passes (panel loading, main board, …, packing). An operation is
 *   performed on a line at the station whose code is `<line code>-<operation code>` (MA-01-FT does FT on line MA-01),
 *   so the plant model and the routing meet by code, never by a copied list.
 * * A bill of materials says what each operation consumes, and whether the station must scan it: `serial` (a key part
 *   with its own serial, e.g. the main board), `lot` (a material lot loaded on the station), or `none` (backflushed).
 * * Revisions: a DRAFT can be edited; APPROVING it freezes it for ever and makes the previous approved revision
 *   OBSOLETE. A work order refers to the approved revisions it was released with, so changing engineering never
 *   changes an order already running (a frozen revision is its own snapshot).
 * * Production shifts and the calendar are the PLANT's working time (capacity, OEE planned time). People's shifts and
 *   rosters belong to HR-System; this is not a roster.
 */
const zCode = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/, 'code: letters, digits, dash or underscore (up to 20)');
const zOp = z.object({
  seq: z.number().int().min(1).max(999),
  code: zCode,
  nameEn: z.string().trim().min(1).max(120),
  nameAr: z.string().trim().max(120).optional(),
  kind: z.enum(['work', 'test', 'inspection', 'pack']).default('work'),
  mandatory: z.boolean().default(true),
  /** Ideal cycle time of one unit at this operation, in seconds (OEE performance). */
  cycleSec: z.number().positive().max(86_400).optional(),
});
const zQtyPer = z.string().transform((v, c) => {
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
const zBomLine = z.object({ componentId: z.string(), qtyPer: zQtyPer, opCode: zCode, scan: z.enum(['serial', 'lot', 'none']).default('none') });
const zHhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

interface RoutingRow { id: string; item_id: string; revision: number; status: 'draft' | 'approved' | 'obsolete'; note: string | null; created_at: string; created_by: string; approved_at: string | null; approved_by: string | null; version: number }
interface BomRow { id: string; item_id: string; revision: number; status: 'draft' | 'approved' | 'obsolete'; note: string | null; created_at: string; created_by: string; approved_at: string | null; approved_by: string | null; version: number }

export const engModule: AppModule = {
  id: 'eng',
  dependsOn: ['system', 'mdm'],
  scopes: ['eng.read', 'eng.write', 'eng.approve'],
  migrations: [
    {
      id: '001_routing_bom_calendar',
      up: `
        CREATE TABLE eng_routing (
          id          TEXT PRIMARY KEY,
          item_id     TEXT NOT NULL REFERENCES mdm_item(id),
          revision    INTEGER NOT NULL,
          status      TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'obsolete')),
          note        TEXT,
          created_at  TEXT NOT NULL,
          created_by  TEXT NOT NULL,
          approved_at TEXT,
          approved_by TEXT,
          version     INTEGER NOT NULL DEFAULT 1,
          UNIQUE (item_id, revision)
        );
        CREATE UNIQUE INDEX eng_routing_one_approved ON eng_routing(item_id) WHERE status = 'approved';
        CREATE TABLE eng_operation (
          routing_id  TEXT NOT NULL REFERENCES eng_routing(id),
          seq         INTEGER NOT NULL,
          code        TEXT NOT NULL,
          name_en     TEXT NOT NULL,
          name_ar     TEXT NOT NULL,
          kind        TEXT NOT NULL CHECK (kind IN ('work', 'test', 'inspection', 'pack')),
          mandatory   INTEGER NOT NULL,
          cycle_ms    INTEGER,
          PRIMARY KEY (routing_id, seq),
          UNIQUE (routing_id, code)
        );
        CREATE TABLE eng_bom (
          id          TEXT PRIMARY KEY,
          item_id     TEXT NOT NULL REFERENCES mdm_item(id),
          revision    INTEGER NOT NULL,
          status      TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'obsolete')),
          note        TEXT,
          created_at  TEXT NOT NULL,
          created_by  TEXT NOT NULL,
          approved_at TEXT,
          approved_by TEXT,
          version     INTEGER NOT NULL DEFAULT 1,
          UNIQUE (item_id, revision)
        );
        CREATE UNIQUE INDEX eng_bom_one_approved ON eng_bom(item_id) WHERE status = 'approved';
        CREATE TABLE eng_bom_line (
          bom_id       TEXT NOT NULL REFERENCES eng_bom(id),
          line_no      INTEGER NOT NULL,
          component_id TEXT NOT NULL REFERENCES mdm_item(id),
          qty_per      INTEGER NOT NULL CHECK (qty_per > 0),
          op_code      TEXT NOT NULL,
          scan         TEXT NOT NULL CHECK (scan IN ('serial', 'lot', 'none')),
          PRIMARY KEY (bom_id, line_no)
        );
        -- a frozen revision can never change again: the database refuses it too
        CREATE TRIGGER eng_operation_frozen_upd BEFORE UPDATE ON eng_operation
          WHEN (SELECT status FROM eng_routing WHERE id = OLD.routing_id) <> 'draft'
          BEGIN SELECT RAISE(ABORT, 'eng: an approved routing is frozen'); END;
        CREATE TRIGGER eng_operation_frozen_del BEFORE DELETE ON eng_operation
          WHEN (SELECT status FROM eng_routing WHERE id = OLD.routing_id) <> 'draft'
          BEGIN SELECT RAISE(ABORT, 'eng: an approved routing is frozen'); END;
        CREATE TRIGGER eng_operation_frozen_ins BEFORE INSERT ON eng_operation
          WHEN (SELECT status FROM eng_routing WHERE id = NEW.routing_id) <> 'draft'
          BEGIN SELECT RAISE(ABORT, 'eng: an approved routing is frozen'); END;
        CREATE TRIGGER eng_bom_line_frozen_upd BEFORE UPDATE ON eng_bom_line
          WHEN (SELECT status FROM eng_bom WHERE id = OLD.bom_id) <> 'draft'
          BEGIN SELECT RAISE(ABORT, 'eng: an approved bill of materials is frozen'); END;
        CREATE TRIGGER eng_bom_line_frozen_del BEFORE DELETE ON eng_bom_line
          WHEN (SELECT status FROM eng_bom WHERE id = OLD.bom_id) <> 'draft'
          BEGIN SELECT RAISE(ABORT, 'eng: an approved bill of materials is frozen'); END;
        CREATE TRIGGER eng_bom_line_frozen_ins BEFORE INSERT ON eng_bom_line
          WHEN (SELECT status FROM eng_bom WHERE id = NEW.bom_id) <> 'draft'
          BEGIN SELECT RAISE(ABORT, 'eng: an approved bill of materials is frozen'); END;

        CREATE TABLE eng_shift (
          code        TEXT PRIMARY KEY,
          name_en     TEXT NOT NULL,
          name_ar     TEXT NOT NULL,
          start_at    TEXT NOT NULL,          -- local "HH:MM"
          end_at      TEXT NOT NULL,          -- may be before start_at: the shift crosses midnight
          break_min   INTEGER NOT NULL DEFAULT 0 CHECK (break_min >= 0),
          active      INTEGER NOT NULL DEFAULT 1,
          version     INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE eng_calendar (
          day         TEXT PRIMARY KEY,       -- production day "YYYY-MM-DD"
          kind        TEXT NOT NULL CHECK (kind IN ('holiday', 'working')),
          note        TEXT
        );
        CREATE TABLE eng_setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO eng_setting (key, value) VALUES ('rest_weekdays', '5');   -- Friday (0 = Sunday)
        CREATE TABLE eng_uom (
          code     TEXT PRIMARY KEY,
          name_en  TEXT NOT NULL,
          name_ar  TEXT NOT NULL,
          decimals INTEGER NOT NULL CHECK (decimals BETWEEN 0 AND 3)
        );
      `,
    },
  ],

  setup(ctx) {
    const service: EngService = {
      approvedRouting: async (itemId, t) => {
        const r = await (t ?? ctx.db).get<RoutingRow>(`SELECT * FROM eng_routing WHERE item_id = ? AND status = 'approved'`, [itemId]);
        return r ? withOps(t ?? ctx.db, r) : undefined;
      },
      routing: async (id, t) => withOps(t ?? ctx.db, (await (t ?? ctx.db).get<RoutingRow>('SELECT * FROM eng_routing WHERE id = ?', [id])) ?? notFound('routing', id)),
      approvedBom: async (itemId, t) => {
        const b = await (t ?? ctx.db).get<BomRow>(`SELECT * FROM eng_bom WHERE item_id = ? AND status = 'approved'`, [itemId]);
        return b ? withLines(t ?? ctx.db, b) : undefined;
      },
      bom: async (id, t) => withLines(t ?? ctx.db, (await (t ?? ctx.db).get<BomRow>('SELECT * FROM eng_bom WHERE id = ?', [id])) ?? notFound('bom', id)),
      shifts: async (t) => (t ?? ctx.db).all<ProdShift>('SELECT * FROM eng_shift WHERE active = 1 ORDER BY start_at'),
      isWorkingDay: async (day, t) => workingDay(t ?? ctx.db, day),
    };
    ctx.services.provide('eng', service);
  },

  routes({ http, require }, ctx) {
    const who = (req: object) => require(req as never, 'eng.read');
    const mdm = () => ctx.services.get('mdm');

    // ------------------------------------------------------------------ routings (MDM1050)
    http.get('/api/routings', async (req) => {
      who(req);
      const q = z.object({ item: z.string().optional(), status: z.enum(['draft', 'approved', 'obsolete']).optional().or(z.literal('')) }).parse(req.query);
      const rows = await ctx.db.all<RoutingRow & { item_code: string; name_en: string; name_ar: string; ops: number }>(
        `SELECT r.*, i.code item_code, i.name_en, i.name_ar, (SELECT COUNT(*) FROM eng_operation o WHERE o.routing_id = r.id) ops
         FROM eng_routing r JOIN mdm_item i ON i.id = r.item_id ${q.status ? 'WHERE r.status = ?' : ''} ORDER BY i.code, r.revision DESC`, q.status ? [q.status] : []);
      const text = (q.item ?? '').trim().toLowerCase();
      return rows.filter((r) => !text || (r.item_code + ' ' + r.name_en + ' ' + r.name_ar).toLowerCase().includes(text));
    });
    http.get('/api/routings/:id', async (req) => {
      who(req);
      return withOps(ctx.db, (await ctx.db.get<RoutingRow>('SELECT * FROM eng_routing WHERE id = ?', [(req.params as { id: string }).id])) ?? notFound('routing', (req.params as { id: string }).id));
    });
    /** A new DRAFT revision of an item's routing (copied from the latest one when no operations are given). */
    http.post('/api/routings', async (req) => {
      const caller = require(req, 'eng.write');
      const input = z.object({ itemId: z.string(), note: z.string().trim().max(300).optional(), operations: z.array(zOp).max(60).optional() }).parse(req.body);
      return ctx.db.tx(async (t) => {
        const item = await mdm().item(input.itemId, t);
        if (item.kind !== 'product') fail('item.not_product', `a service (${item.code}) has no routing`);
        if (await t.get(`SELECT 1 FROM eng_routing WHERE item_id = ? AND status = 'draft'`, [item.id])) conflict('routing.draft_exists', `${item.code} already has a draft routing: edit or approve it`);
        const last = await t.get<RoutingRow>('SELECT * FROM eng_routing WHERE item_id = ? ORDER BY revision DESC LIMIT 1', [item.id]);
        const ops = input.operations ?? (last ? (await withOps(t, last)).operations.map(opInput) : []);
        const id = ctx.clock.newId();
        await t.run(`INSERT INTO eng_routing (id, item_id, revision, status, note, created_at, created_by) VALUES (?, ?, ?, 'draft', ?, ?, ?)`,
          [id, item.id, (last?.revision ?? 0) + 1, input.note ?? null, ctx.clock.now().toISOString(), caller.name]);
        await writeOps(t, id, ops);
        return { id, revision: (last?.revision ?? 0) + 1 };
      });
    });
    http.put('/api/routings/:id', async (req) => {
      require(req, 'eng.write');
      const { id } = req.params as { id: string };
      const input = z.object({ version: z.number().int(), note: z.string().trim().max(300).nullable().optional(), operations: z.array(zOp).max(60) }).parse(req.body);
      return ctx.db.tx(async (t) => {
        const r = (await t.get<RoutingRow>('SELECT * FROM eng_routing WHERE id = ?', [id])) ?? notFound('routing', id);
        if (r.status !== 'draft') conflict('routing.frozen', `revision ${r.revision} is ${r.status}: make a new revision to change it`);
        if (r.version !== input.version) conflict('routing.changed', 'the routing was changed by someone else meanwhile: reload it');
        await t.run('DELETE FROM eng_operation WHERE routing_id = ?', [id]);
        await writeOps(t, id, input.operations);
        await t.run('UPDATE eng_routing SET note = ?, version = version + 1 WHERE id = ?', [input.note === undefined ? r.note : input.note, id]);
        return { id, version: r.version + 1 };
      });
    });
    http.post('/api/routings/:id/approve', async (req) => {
      const caller = require(req, 'eng.approve');
      const { id } = req.params as { id: string };
      const input = z.object({ version: z.number().int() }).parse(req.body);
      return ctx.db.tx(async (t) => {
        const r = (await t.get<RoutingRow>('SELECT * FROM eng_routing WHERE id = ?', [id])) ?? notFound('routing', id);
        if (r.status !== 'draft') conflict('routing.frozen', `revision ${r.revision} is already ${r.status}`);
        if (r.version !== input.version) conflict('routing.changed', 'the routing was changed by someone else meanwhile: reload it');
        const ops = (await withOps(t, r)).operations;
        if (!ops.length) fail('routing.empty', 'a routing needs at least one operation');
        await t.run(`UPDATE eng_routing SET status = 'obsolete', version = version + 1 WHERE item_id = ? AND status = 'approved'`, [r.item_id]);
        await t.run(`UPDATE eng_routing SET status = 'approved', approved_at = ?, approved_by = ?, version = version + 1 WHERE id = ?`, [ctx.clock.now().toISOString(), caller.name, id]);
        return { id, status: 'approved' };
      });
    });

    // ------------------------------------------------------------------ bills of materials (MDM1040)
    http.get('/api/boms', async (req) => {
      who(req);
      const q = z.object({ item: z.string().optional(), status: z.enum(['draft', 'approved', 'obsolete']).optional().or(z.literal('')) }).parse(req.query);
      const rows = await ctx.db.all<BomRow & { item_code: string; name_en: string; name_ar: string; lines: number }>(
        `SELECT b.*, i.code item_code, i.name_en, i.name_ar, (SELECT COUNT(*) FROM eng_bom_line l WHERE l.bom_id = b.id) lines
         FROM eng_bom b JOIN mdm_item i ON i.id = b.item_id ${q.status ? 'WHERE b.status = ?' : ''} ORDER BY i.code, b.revision DESC`, q.status ? [q.status] : []);
      const text = (q.item ?? '').trim().toLowerCase();
      return rows.filter((r) => !text || (r.item_code + ' ' + r.name_en + ' ' + r.name_ar).toLowerCase().includes(text));
    });
    http.get('/api/boms/:id', async (req) => {
      who(req);
      const b = await withLines(ctx.db, (await ctx.db.get<BomRow>('SELECT * FROM eng_bom WHERE id = ?', [(req.params as { id: string }).id])) ?? notFound('bom', (req.params as { id: string }).id));
      return { ...b, lines: b.lines.map((l) => ({ ...l, qty_per: formatQty(l.qty_per) })) };
    });
    http.post('/api/boms', async (req) => {
      const caller = require(req, 'eng.write');
      const input = z.object({ itemId: z.string(), note: z.string().trim().max(300).optional(), lines: z.array(zBomLine).max(200).optional() }).parse(req.body);
      return ctx.db.tx(async (t) => {
        const item = await mdm().item(input.itemId, t);
        if (item.kind !== 'product') fail('item.not_product', `a service (${item.code}) has no bill of materials`);
        if (await t.get(`SELECT 1 FROM eng_bom WHERE item_id = ? AND status = 'draft'`, [item.id])) conflict('bom.draft_exists', `${item.code} already has a draft bill of materials`);
        const last = await t.get<BomRow>('SELECT * FROM eng_bom WHERE item_id = ? ORDER BY revision DESC LIMIT 1', [item.id]);
        const lines = input.lines ?? (last ? (await withLines(t, last)).lines.map((l) => ({ componentId: l.component_id, qtyPer: l.qty_per, opCode: l.op_code, scan: l.scan })) : []);
        const id = ctx.clock.newId();
        await t.run(`INSERT INTO eng_bom (id, item_id, revision, status, note, created_at, created_by) VALUES (?, ?, ?, 'draft', ?, ?, ?)`,
          [id, item.id, (last?.revision ?? 0) + 1, input.note ?? null, ctx.clock.now().toISOString(), caller.name]);
        await writeLines(ctx, t, id, item.id, lines);
        return { id, revision: (last?.revision ?? 0) + 1 };
      });
    });
    http.put('/api/boms/:id', async (req) => {
      require(req, 'eng.write');
      const { id } = req.params as { id: string };
      const input = z.object({ version: z.number().int(), note: z.string().trim().max(300).nullable().optional(), lines: z.array(zBomLine).max(200) }).parse(req.body);
      return ctx.db.tx(async (t) => {
        const b = (await t.get<BomRow>('SELECT * FROM eng_bom WHERE id = ?', [id])) ?? notFound('bom', id);
        if (b.status !== 'draft') conflict('bom.frozen', `revision ${b.revision} is ${b.status}: make a new revision to change it`);
        if (b.version !== input.version) conflict('bom.changed', 'the bill of materials was changed by someone else meanwhile: reload it');
        await t.run('DELETE FROM eng_bom_line WHERE bom_id = ?', [id]);
        await writeLines(ctx, t, id, b.item_id, input.lines);
        await t.run('UPDATE eng_bom SET note = ?, version = version + 1 WHERE id = ?', [input.note === undefined ? b.note : input.note, id]);
        return { id, version: b.version + 1 };
      });
    });
    http.post('/api/boms/:id/approve', async (req) => {
      const caller = require(req, 'eng.approve');
      const { id } = req.params as { id: string };
      const input = z.object({ version: z.number().int() }).parse(req.body);
      return ctx.db.tx(async (t) => {
        const b = (await t.get<BomRow>('SELECT * FROM eng_bom WHERE id = ?', [id])) ?? notFound('bom', id);
        if (b.status !== 'draft') conflict('bom.frozen', `revision ${b.revision} is already ${b.status}`);
        if (b.version !== input.version) conflict('bom.changed', 'the bill of materials was changed by someone else meanwhile: reload it');
        const lines = (await withLines(t, b)).lines;
        if (!lines.length) fail('bom.empty', 'a bill of materials needs at least one line');
        // every consuming operation must exist in the item's approved routing (a part consumed nowhere is a typing error)
        const route = await t.get<RoutingRow>(`SELECT * FROM eng_routing WHERE item_id = ? AND status = 'approved'`, [b.item_id]);
        if (route) {
          const codes = new Set((await withOps(t, route)).operations.map((o) => o.code));
          const stray = lines.filter((l) => !codes.has(l.op_code));
          if (stray.length) fail('bom.unknown_operation', `operation ${stray[0]!.op_code} is not in the approved routing (revision ${route.revision})`);
        }
        await t.run(`UPDATE eng_bom SET status = 'obsolete', version = version + 1 WHERE item_id = ? AND status = 'approved'`, [b.item_id]);
        await t.run(`UPDATE eng_bom SET status = 'approved', approved_at = ?, approved_by = ?, version = version + 1 WHERE id = ?`, [ctx.clock.now().toISOString(), caller.name, id]);
        return { id, status: 'approved' };
      });
    });
    /** Where a component is used (the other direction of the BOM). */
    http.get('/api/boms/where-used/:itemId', async (req) => {
      who(req);
      return ctx.db.all(`SELECT b.id bom_id, b.revision, b.status, i.code item_code, i.name_en, i.name_ar, l.qty_per, l.op_code, l.scan
        FROM eng_bom_line l JOIN eng_bom b ON b.id = l.bom_id JOIN mdm_item i ON i.id = b.item_id WHERE l.component_id = ? ORDER BY i.code, b.revision DESC`,
        [(req.params as { itemId: string }).itemId]).then((rows: any[]) => rows.map((r) => ({ ...r, qty_per: formatQty(r.qty_per) })));
    });

    // ------------------------------------------------------------------ production shifts and calendar (MDM1060)
    http.get('/api/production-calendar', async (req) => {
      who(req);
      const q = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.query);
      const rest = await restDays(ctx.db);
      const exceptions = await ctx.db.all(`SELECT * FROM eng_calendar ${q.from ? 'WHERE day >= ? AND day <= ?' : ''} ORDER BY day`, q.from ? [q.from, q.to ?? q.from] : []);
      return { shifts: await ctx.db.all('SELECT * FROM eng_shift ORDER BY start_at'), restWeekdays: rest, exceptions };
    });
    http.put('/api/production-shifts/:code', async (req) => {
      require(req, 'eng.write');
      const code = zCode.parse((req.params as { code: string }).code);
      const input = z.object({ nameEn: z.string().trim().min(1).max(60), nameAr: z.string().trim().max(60).optional(), start: zHhmm, end: zHhmm,
        breakMin: z.number().int().min(0).max(240).default(0), active: z.boolean().default(true), version: z.number().int().optional() }).parse(req.body);
      if (input.start === input.end) fail('shift.empty', 'a shift must last some time');
      return ctx.db.tx(async (t) => {
        const cur = await t.get<ProdShift>('SELECT * FROM eng_shift WHERE code = ?', [code]);
        if (cur && input.version !== cur.version) conflict('shift.changed', `shift ${code} was changed by someone else meanwhile: reload it`);
        const len = minutes(input.start, input.end);
        if (input.breakMin >= len) fail('shift.break', 'the break is longer than the shift');
        if (cur) await t.run('UPDATE eng_shift SET name_en = ?, name_ar = ?, start_at = ?, end_at = ?, break_min = ?, active = ?, version = version + 1 WHERE code = ?',
          [input.nameEn, input.nameAr || input.nameEn, input.start, input.end, input.breakMin, input.active ? 1 : 0, code]);
        else await t.run('INSERT INTO eng_shift (code, name_en, name_ar, start_at, end_at, break_min, active) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [code, input.nameEn, input.nameAr || input.nameEn, input.start, input.end, input.breakMin, input.active ? 1 : 0]);
        return { code, version: (cur?.version ?? 0) + 1 };
      });
    });
    http.put('/api/production-calendar/rest-weekdays', async (req) => {
      require(req, 'eng.write');
      const days = z.array(z.number().int().min(0).max(6)).max(6).parse(req.body);
      await ctx.db.run(`INSERT INTO eng_setting (key, value) VALUES ('rest_weekdays', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [[...new Set(days)].sort().join(',')]);
      return { restWeekdays: [...new Set(days)].sort() };
    });
    http.put('/api/production-calendar/:day', async (req) => {
      require(req, 'eng.write');
      const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse((req.params as { day: string }).day);
      const input = z.object({ kind: z.enum(['holiday', 'working', 'normal']), note: z.string().trim().max(120).optional() }).parse(req.body);
      if (input.kind === 'normal') await ctx.db.run('DELETE FROM eng_calendar WHERE day = ?', [day]);   // configuration, not a production fact
      else await ctx.db.run('INSERT INTO eng_calendar (day, kind, note) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET kind = excluded.kind, note = excluded.note', [day, input.kind, input.note ?? null]);
      return { day, kind: input.kind };
    });

    // ------------------------------------------------------------------ units of measure (MDM1030)
    http.get('/api/uoms', async (req) => {
      who(req);
      const own = await ctx.db.all<{ code: string; name_en: string; name_ar: string; decimals: number }>('SELECT * FROM eng_uom ORDER BY code');
      const used = await ctx.db.all<{ code: string; items: number }>('SELECT base_uom code, COUNT(*) items FROM mdm_item GROUP BY base_uom');
      const byCode = new Map(own.map((u) => [u.code, { ...u, items: 0, defined: true }]));
      for (const u of used) {
        const cur = byCode.get(u.code);
        if (cur) cur.items = u.items;
        else byCode.set(u.code, { code: u.code, name_en: u.code, name_ar: u.code, decimals: 3, items: u.items, defined: false });
      }
      return { owner: ctx.config.ownership.item, units: [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code)) };
    });
    http.put('/api/uoms/:code', async (req) => {
      require(req, 'mdm.items.write');
      if (ctx.config.ownership.item !== 'gmes') conflict('mdm.not_owner', 'Units of measure are owned by accounting (Mizan) in this installation');
      const code = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,10}$/).parse((req.params as { code: string }).code);
      const input = z.object({ nameEn: z.string().trim().min(1).max(40), nameAr: z.string().trim().max(40).optional(), decimals: z.number().int().min(0).max(3) }).parse(req.body);
      await ctx.db.run('INSERT INTO eng_uom (code, name_en, name_ar, decimals) VALUES (?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET name_en = excluded.name_en, name_ar = excluded.name_ar, decimals = excluded.decimals',
        [code, input.nameEn, input.nameAr || input.nameEn, input.decimals]);
      return { code };
    });
  },

  async health(ctx) {
    // an approved routing without operations, or a BOM line pointing at an operation its routing lacks, would stop a line
    const empty = await ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM eng_routing r WHERE r.status = 'approved' AND NOT EXISTS (SELECT 1 FROM eng_operation o WHERE o.routing_id = r.id)`);
    const stray = await ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM eng_bom_line l JOIN eng_bom b ON b.id = l.bom_id AND b.status = 'approved'
      JOIN eng_routing r ON r.item_id = b.item_id AND r.status = 'approved' WHERE NOT EXISTS (SELECT 1 FROM eng_operation o WHERE o.routing_id = r.id AND o.code = l.op_code)`);
    return [{ id: 'engineering_consistent', ok: empty!.n === 0 && stray!.n === 0, details: { approvedRoutingsWithoutOperations: empty!.n, bomLinesOutsideRouting: stray!.n } }];
  },
};

// ------------------------------------------------------------------ helpers
const opInput = (o: RouteOp) => ({ seq: o.seq, code: o.code, nameEn: o.name_en, nameAr: o.name_ar, kind: o.kind, mandatory: !!o.mandatory, cycleSec: o.cycle_ms ? o.cycle_ms / 1000 : undefined });

async function writeOps(t: Db, routingId: string, ops: z.input<typeof zOp>[]) {
  const seqs = new Set<number>(), codes = new Set<string>();
  for (const raw of ops) {
    const o = zOp.parse(raw);
    if (seqs.has(o.seq)) fail('routing.duplicate_seq', `sequence ${o.seq} is used twice`);
    if (codes.has(o.code)) fail('routing.duplicate_code', `operation ${o.code} is used twice`);
    seqs.add(o.seq); codes.add(o.code);
    await t.run('INSERT INTO eng_operation (routing_id, seq, code, name_en, name_ar, kind, mandatory, cycle_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [routingId, o.seq, o.code, o.nameEn, o.nameAr || o.nameEn, o.kind, o.mandatory ? 1 : 0, o.cycleSec ? Math.round(o.cycleSec * 1000) : null]);
  }
  const packs = [...ops].map((o) => zOp.parse(o)).sort((a, b) => a.seq - b.seq);
  if (packs.some((o, i) => o.kind === 'pack' && i !== packs.length - 1)) fail('routing.pack_last', 'packing must be the last operation');
}

async function writeLines(ctx: Ctx, t: Db, bomId: string, itemId: string, lines: { componentId: string; qtyPer: number; opCode: string; scan: 'serial' | 'lot' | 'none' }[]) {
  const seen = new Set<string>();
  let n = 0;
  for (const l of lines) {
    const c = await ctx.services.get('mdm').item(l.componentId, t);
    if (c.id === itemId) fail('bom.self', 'an item cannot contain itself');
    if (seen.has(c.id + '@' + l.opCode)) fail('bom.duplicate', `${c.code} is listed twice at ${l.opCode}`);
    seen.add(c.id + '@' + l.opCode);
    if (l.scan === 'serial' && c.tracking !== 'serial') fail('bom.scan_serial', `${c.code} carries no serial number: scan it as a lot or not at all`);
    if (l.scan === 'serial' && l.qtyPer !== 1000) fail('bom.serial_one', `a serial part is used one at a time (${c.code})`);
    // a component that contains the parent would make a unit its own part
    if (await t.get(`SELECT 1 FROM eng_bom_line l JOIN eng_bom b ON b.id = l.bom_id WHERE b.item_id = ? AND l.component_id = ? AND b.status <> 'obsolete'`, [c.id, itemId])) {
      fail('bom.cycle', `${c.code} already contains this item`);
    }
    await t.run('INSERT INTO eng_bom_line (bom_id, line_no, component_id, qty_per, op_code, scan) VALUES (?, ?, ?, ?, ?, ?)', [bomId, ++n, c.id, l.qtyPer, l.opCode, l.scan]);
  }
}

async function withOps(db: Db, r: RoutingRow): Promise<Routing> {
  const operations = await db.all<RouteOp>('SELECT seq, code, name_en, name_ar, kind, mandatory, cycle_ms FROM eng_operation WHERE routing_id = ? ORDER BY seq', [r.id]);
  const item = await db.get<{ code: string; name_en: string; name_ar: string }>('SELECT code, name_en, name_ar FROM mdm_item WHERE id = ?', [r.item_id]);
  return { ...r, item: item ?? null, operations };
}

async function withLines(db: Db, b: BomRow): Promise<Bom> {
  const lines = await db.all<BomLine>(`SELECT l.line_no, l.component_id, i.code component_code, i.name_en, i.name_ar, i.tracking, i.base_uom, l.qty_per, l.op_code, l.scan
    FROM eng_bom_line l JOIN mdm_item i ON i.id = l.component_id WHERE l.bom_id = ? ORDER BY l.line_no`, [b.id]);
  const item = await db.get<{ code: string; name_en: string; name_ar: string }>('SELECT code, name_en, name_ar FROM mdm_item WHERE id = ?', [b.item_id]);
  return { ...b, item: item ?? null, lines };
}

const minutes = (start: string, end: string) => {
  const m = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  return (m(end) - m(start) + 1440) % 1440;
};

async function restDays(db: Db): Promise<number[]> {
  const v = await db.get<{ value: string }>(`SELECT value FROM eng_setting WHERE key = 'rest_weekdays'`);
  return v && v.value ? v.value.split(',').map(Number) : [];
}

async function workingDay(db: Db, day: string): Promise<boolean> {
  const ex = await db.get<{ kind: string }>('SELECT kind FROM eng_calendar WHERE day = ?', [day]);
  if (ex) return ex.kind === 'working';
  return !(await restDays(db)).includes(new Date(`${day}T12:00:00Z`).getUTCDay());
}

export { minutes as shiftMinutes };
