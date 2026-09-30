import { z } from 'zod';
import { formatQty, uuidv5 } from '@eco/contracts';
import { productionDate } from '../../kernel/clock.js';
import { runCommand } from '../../kernel/commands.js';
import type { Db } from '../../kernel/db.js';
import { conflict, fail, notFound } from '../../kernel/errors.js';
import type { AppModule, Caller, Ctx } from '../../kernel/modules.js';
import { addDays, isoWeek, plan, type Bom, type Commitment, type LineInfo, type Peg, type PlanInput, type PlanItem, type PlanOutput } from './engine.js';

/**
 * Planning (WP-G2): reads the mirrors of accounting's commercial truth (sales orders, demand plan, stock, purchase
 * orders, item planning parameters) and manufacturing's own engineering and plant model, runs the pure engine, keeps
 * the results, and publishes what it concluded (requisitions, crew requirements, supply plan) in the same
 * transaction. Quantities only; never money.
 *
 * Tables of other modules are READ here (like the reports module does); they are never written. Work orders are
 * released through the execution module's service.
 */

const DEFAULTS: Record<string, string> = {
  horizon_days: '91',
  frozen_days: '14',
  default_make_lead_days: '1',
  /** Shifts every line runs unless told otherwise (comma list); empty = the first active shift. */
  base_shifts: '',
  /** Codes of the warehouses whose stock planning may use (comma list). Empty = every warehouse except the quality hold, whose goods are not usable. */
  planning_warehouses: '',
};

const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

interface PlannedRow { id: string; run_id: string; item_id: string; qty: number; start_date: string; due_date: string; line_code: string | null; status: string; work_order_id: string | null; pegging: string; firmed_by: string | null; firmed_at: string | null }
interface ReqRow { id: string; key: string; code: string; item_id: string; qty: number; need_date: string; order_by_date: string; warehouse_id: string | null; status: string; run_id: string; version: number; pegging: string; past_due: number; expedite: number }
interface CrewRowDb { id: string; line_code: string; shift_code: string; work_date: string; headcount: number; skills: string; run_id: string; version: number }
interface RunRow { id: string; code: string; started_at: string; finished_at: string; today: string; horizon_to: string; status: string; trigger: string; stats: string; output: string }

export const plnModule: AppModule = {
  id: 'pln',
  dependsOn: ['mdm', 'eng', 'eco', 'exe'],
  scopes: ['pln.read', 'pln.run', 'pln.plan', 'pln.admin'],
  migrations: [
    {
      id: '001_pln',
      up: `
        CREATE TABLE pln_setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        -- the lines that can make an item, best first (engineering routings do not name a line)
        CREATE TABLE pln_item_line (item_id TEXT NOT NULL, line_code TEXT NOT NULL, rank INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (item_id, line_code));
        -- people a line (overhead: leader, handlers, repair) or a station needs per running shift
        CREATE TABLE pln_node_crew (node_code TEXT PRIMARY KEY, crew INTEGER NOT NULL CHECK (crew >= 0));
        -- a shift added to a line for a period ("add shift C on line L from D1 to D2")
        CREATE TABLE pln_line_shift (line_code TEXT NOT NULL, shift_code TEXT NOT NULL, valid_from TEXT NOT NULL, valid_to TEXT NOT NULL, PRIMARY KEY (line_code, shift_code, valid_from));
        CREATE TABLE pln_run (
          id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, started_at TEXT NOT NULL, finished_at TEXT NOT NULL, today TEXT NOT NULL,
          horizon_to TEXT NOT NULL, status TEXT NOT NULL, trigger TEXT NOT NULL, stats TEXT NOT NULL, output TEXT NOT NULL
        );
        CREATE TABLE pln_planned_order (
          id TEXT PRIMARY KEY, run_id TEXT NOT NULL, item_id TEXT NOT NULL, qty INTEGER NOT NULL CHECK (qty > 0), start_date TEXT NOT NULL,
          due_date TEXT NOT NULL, line_code TEXT, status TEXT NOT NULL CHECK (status IN ('planned', 'firmed', 'released', 'cancelled')),
          work_order_id TEXT, pegging TEXT NOT NULL, firmed_by TEXT, firmed_at TEXT
        );
        CREATE INDEX pln_planned_order_status ON pln_planned_order (status, due_date);
        CREATE TABLE pln_requisition (
          id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, code TEXT NOT NULL, item_id TEXT NOT NULL, qty INTEGER NOT NULL, need_date TEXT NOT NULL,
          order_by_date TEXT NOT NULL, warehouse_id TEXT, status TEXT NOT NULL CHECK (status IN ('open', 'cancelled')), run_id TEXT NOT NULL,
          version INTEGER NOT NULL, pegging TEXT NOT NULL, past_due INTEGER NOT NULL, expedite INTEGER NOT NULL
        );
        CREATE TABLE pln_crew (
          id TEXT PRIMARY KEY, line_code TEXT NOT NULL, shift_code TEXT NOT NULL, work_date TEXT NOT NULL, headcount INTEGER NOT NULL,
          skills TEXT NOT NULL, run_id TEXT NOT NULL, version INTEGER NOT NULL, UNIQUE (line_code, shift_code, work_date)
        );
      `,
    },
  ],

  routes(kit, ctx) {
    const { http, require } = kit;

    http.post('/api/pln/runs', async (req) => {
      require(req, 'pln.run');
      return runPlanning(ctx, 'manual');
    });

    http.get('/api/pln/runs', async (req) => {
      require(req, 'pln.read');
      const rows = await ctx.db.all<RunRow>('SELECT id, code, started_at, finished_at, today, horizon_to, status, trigger, stats FROM pln_run ORDER BY started_at DESC LIMIT 100');
      return rows.map((r) => ({ ...r, stats: JSON.parse(r.stats) }));
    });

    http.get('/api/pln/runs/:id', async (req) => {
      require(req, 'pln.read');
      const { id } = req.params as { id: string };
      const r = await ctx.db.get<RunRow>('SELECT * FROM pln_run WHERE id = ? OR code = ?', [id, id]);
      if (!r) return notFound('pln_run', id);
      return { ...r, stats: JSON.parse(r.stats), output: await presentOutput(ctx, JSON.parse(r.output) as PlanOutput) };
    });

    http.get('/api/pln/exceptions', async (req) => {
      require(req, 'pln.read');
      const last = await lastRun(ctx);
      if (!last) return [];
      const names = await itemNames(ctx);
      return last.output.exceptions.map((e) => ({ ...e, item: e.itemId ? names.get(e.itemId) ?? null : null }));
    });

    http.get('/api/pln/mps', async (req) => {
      require(req, 'pln.read');
      const q = z.object({ item: z.string().optional() }).parse(req.query);
      const last = await lastRun(ctx);
      if (!last) return [];
      const names = await itemNames(ctx);
      return last.output.records
        .filter((r) => !q.item || r.itemId === q.item || names.get(r.itemId)?.code === q.item)
        .map((r) => ({ item: names.get(r.itemId) ?? { id: r.itemId, code: r.itemId }, date: r.date, gross: formatQty(r.gross), scheduled_receipts: formatQty(r.scheduledReceipts), projected_on_hand: formatQty(r.projectedOnHand), net: formatQty(r.net), planned_receipt: formatQty(r.plannedReceipt) }));
    });

    http.get('/api/pln/capacity', async (req) => {
      require(req, 'pln.read');
      const last = await lastRun(ctx);
      if (!last) return { load: [], proposals: [] };
      return {
        load: last.output.load.map((l) => ({ ...l, loaded: formatQty(l.loaded), capacity: formatQty(l.capacity), percent: l.capacity > 0 ? Math.round((l.loaded * 100) / l.capacity) : null })),
        proposals: last.output.proposals.map((p) => ({ ...p, addedCapacity: formatQty(p.addedCapacity) })),
      };
    });

    http.get('/api/pln/planned-orders', async (req) => {
      require(req, 'pln.read');
      const q = z.object({ status: z.enum(['planned', 'firmed', 'released', 'cancelled']).optional().or(z.literal('')) }).parse(req.query);
      const rows = await ctx.db.all<PlannedRow>(`SELECT * FROM pln_planned_order ${q.status ? 'WHERE status = ?' : "WHERE status <> 'cancelled'"} ORDER BY due_date, item_id LIMIT 5000`, q.status ? [q.status] : []);
      const names = await itemNames(ctx);
      return rows.map((r) => presentPlanned(r, names));
    });

    http.post('/api/pln/planned-orders/:id/firm', async (req) => {
      const caller = require(req, 'pln.plan');
      const { id } = req.params as { id: string };
      return ctx.db.tx(async (t) => {
        const r = await plannedOrThrow(t, id);
        if (r.status !== 'planned') conflict('pln.not_planned', `planned order is ${r.status}`);
        await t.run("UPDATE pln_planned_order SET status = 'firmed', firmed_by = ?, firmed_at = ? WHERE id = ?", [caller.name, ctx.clock.now().toISOString(), id]);
        return { id, status: 'firmed' };
      });
    });

    http.post('/api/pln/planned-orders/:id/cancel', async (req) => {
      require(req, 'pln.plan');
      const { id } = req.params as { id: string };
      return ctx.db.tx(async (t) => {
        const r = await plannedOrThrow(t, id);
        if (r.status === 'released') conflict('pln.released', 'a released order is cancelled on its work order');
        await t.run("UPDATE pln_planned_order SET status = 'cancelled' WHERE id = ?", [id]);
        return { id, status: 'cancelled' };
      });
    });

    http.post('/api/pln/planned-orders/:id/release', async (req) => {
      const caller = require(req, 'pln.plan');
      const { id } = req.params as { id: string };
      const body = z.object({ commandId: z.string(), warehouseId: z.string().optional(), productionDate: zDate.optional() }).parse(req.body ?? {});
      const { result, replayed } = await runCommand(ctx, caller, { id: body.commandId, type: 'ReleasePlannedOrder', request: { id, ...body } }, (t) => release(ctx, t, caller, id, body));
      return { ...result, replayed };
    });

    http.get('/api/pln/requisitions', async (req) => {
      require(req, 'pln.read');
      const rows = await ctx.db.all<ReqRow>("SELECT * FROM pln_requisition ORDER BY status, need_date, code LIMIT 5000");
      const names = await itemNames(ctx);
      const onPo = new Map((await ctx.db.all<{ requisition_id: string; code: string }>(
        'SELECT l.requisition_id, p.code FROM mdm_purchase_order_line l JOIN mdm_purchase_order p ON p.id = l.po_id WHERE l.requisition_id IS NOT NULL')).map((x) => [x.requisition_id, x.code]));
      return rows.map((r) => ({
        id: r.id, code: r.code, item: names.get(r.item_id) ?? { id: r.item_id, code: r.item_id }, qty: formatQty(r.qty), need_date: r.need_date, order_by_date: r.order_by_date,
        status: r.status, version: r.version, past_due: !!r.past_due, expedite_would_meet_need: !!r.expedite, purchase_order: onPo.get(r.id) ?? null, pegging: JSON.parse(r.pegging),
      }));
    });

    http.get('/api/pln/crew', async (req) => {
      require(req, 'pln.read');
      const q = z.object({ date: zDate.optional(), from: zDate.optional(), to: zDate.optional() }).parse(req.query);
      const from = q.date ?? q.from ?? todayOf(ctx), to = q.date ?? q.to ?? addDays(from, 13);
      const rows = await ctx.db.all<CrewRowDb>('SELECT * FROM pln_crew WHERE work_date BETWEEN ? AND ? AND headcount > 0 ORDER BY work_date, line_code, shift_code', [from, to]);
      // people HR scheduled per shift and day (the schedule mirror does not say the line yet): compared with the plant total
      const sched = await ctx.db.all<{ work_date: string; shift_code: string; n: number }>(
        "SELECT work_date, shift_code, COUNT(*) n FROM mdm_schedule_day WHERE work_date BETWEEN ? AND ? AND shift_code IS NOT NULL AND status = 'work' GROUP BY work_date, shift_code", [from, to]);
      const scheduled = new Map(sched.map((s) => [`${s.work_date}|${s.shift_code}`, s.n]));
      const required = new Map<string, number>();
      for (const r of rows) required.set(`${r.work_date}|${r.shift_code}`, (required.get(`${r.work_date}|${r.shift_code}`) ?? 0) + r.headcount);
      return rows.map((r) => {
        const k = `${r.work_date}|${r.shift_code}`;
        return { line: r.line_code, shift: r.shift_code, date: r.work_date, required: r.headcount, plantRequired: required.get(k)!, plantScheduled: scheduled.get(k) ?? 0, skills: JSON.parse(r.skills), version: r.version };
      });
    });

    // ------------------------------------------------------------------ set-up
    http.get('/api/pln/settings', async (req) => {
      require(req, 'pln.read');
      return {
        settings: await settings(ctx.db),
        itemLines: await ctx.db.all('SELECT i.item_id, m.code item_code, i.line_code, i.rank FROM pln_item_line i LEFT JOIN mdm_item m ON m.id = i.item_id ORDER BY m.code, i.rank'),
        crew: await ctx.db.all('SELECT node_code, crew FROM pln_node_crew ORDER BY node_code'),
        lineShifts: await ctx.db.all('SELECT * FROM pln_line_shift ORDER BY line_code, valid_from'),
      };
    });

    http.put('/api/pln/settings', async (req) => {
      require(req, 'pln.admin');
      const body = z.record(z.enum(Object.keys(DEFAULTS) as [string, ...string[]]), z.string().max(200)).parse(req.body);
      for (const k of ['horizon_days', 'frozen_days', 'default_make_lead_days']) if (body[k] !== undefined && !/^\d{1,3}$/.test(body[k]!)) fail('pln.setting', `${k} must be a whole number of days`);
      await ctx.db.tx(async (t) => { for (const [k, v] of Object.entries(body)) await t.run('INSERT INTO pln_setting (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [k, v]); });
      return settings(ctx.db);
    });

    http.put('/api/pln/item-lines', async (req) => {
      require(req, 'pln.admin');
      const body = z.object({ itemId: z.string(), lines: z.array(z.string().min(1).max(40)).max(10) }).parse(req.body);
      await ctx.services.get('mdm').item(body.itemId);
      const mdm = ctx.services.get('mdm');
      for (const l of body.lines) { const n = await mdm.plantNode(l); if (!n || n.type !== 'line') fail('line.unknown', `${l} is not a line of the plant model`); }
      await ctx.db.tx(async (t) => {
        await t.run('DELETE FROM pln_item_line WHERE item_id = ?', [body.itemId]);
        let rank = 1;
        for (const l of body.lines) await t.run('INSERT INTO pln_item_line (item_id, line_code, rank) VALUES (?, ?, ?)', [body.itemId, l, rank++]);
      });
      return { itemId: body.itemId, lines: body.lines };
    });

    http.put('/api/pln/crew-settings', async (req) => {
      require(req, 'pln.admin');
      const body = z.object({ node: z.string().min(1).max(64), crew: z.number().int().min(0).max(500) }).parse(req.body);
      const n = await ctx.services.get('mdm').plantNode(body.node);
      if (!n || (n.type !== 'line' && n.type !== 'station')) fail('pln.node', `${body.node} is not a line or station`);
      await ctx.db.run('INSERT INTO pln_node_crew (node_code, crew) VALUES (?, ?) ON CONFLICT (node_code) DO UPDATE SET crew = excluded.crew', [body.node, body.crew]);
      return body;
    });

    http.post('/api/pln/line-shifts', async (req) => {
      require(req, 'pln.plan');
      const body = z.object({ line: z.string().min(1), shift: z.string().min(1), from: zDate, to: zDate, remove: z.boolean().optional() }).parse(req.body);
      if (body.to < body.from) fail('pln.period', 'the period ends before it starts');
      if (body.remove) await ctx.db.run('DELETE FROM pln_line_shift WHERE line_code = ? AND shift_code = ? AND valid_from = ?', [body.line, body.shift, body.from]);
      else {
        const n = await ctx.services.get('mdm').plantNode(body.line);
        if (!n || n.type !== 'line') fail('line.unknown', `${body.line} is not a line of the plant model`);
        const shifts = await ctx.services.get('eng').shifts();
        if (!shifts.some((s) => s.code === body.shift && s.active)) fail('shift.unknown', `${body.shift} is not an active production shift`);
        await ctx.db.run('INSERT INTO pln_line_shift (line_code, shift_code, valid_from, valid_to) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET valid_to = excluded.valid_to', [body.line, body.shift, body.from, body.to]);
      }
      return { ok: true };
    });
  },

  async health(ctx) {
    const last = await ctx.db.get<{ code: string; finished_at: string }>('SELECT code, finished_at FROM pln_run ORDER BY started_at DESC LIMIT 1');
    return [{ id: 'pln_last_run', ok: true, details: { last: last ?? null } }];
  },
};

// ------------------------------------------------------------------ the run

function todayOf(ctx: Ctx): string {
  return productionDate(ctx.clock.now(), ctx.config.timeZone, ctx.config.productionDayStart);
}

async function settings(db: Db): Promise<Record<string, string>> {
  const out = { ...DEFAULTS };
  for (const r of await db.all<{ key: string; value: string }>('SELECT key, value FROM pln_setting')) out[r.key] = r.value;
  return out;
}

/** Everything the engine needs, read from the mirrors and manufacturing's own tables. */
export async function loadInput(ctx: Ctx, today: string): Promise<{ input: PlanInput; horizonTo: string }> {
  const db = ctx.db;
  const s = await settings(db);
  const horizonDays = Number(s.horizon_days), frozenDays = Number(s.frozen_days);
  const horizonTo = addDays(today, horizonDays);

  const approvedBoms = await db.all<{ id: string; item_id: string }>("SELECT id, item_id FROM eng_bom WHERE status = 'approved'");
  const bomLines = await db.all<{ bom_id: string; component_id: string; qty_per: number }>(
    "SELECT l.bom_id, l.component_id, l.qty_per FROM eng_bom_line l JOIN eng_bom b ON b.id = l.bom_id WHERE b.status = 'approved' ORDER BY l.bom_id, l.line_no");
  const boms: Bom[] = approvedBoms.map((b) => ({ parentId: b.item_id, lines: bomLines.filter((l) => l.bom_id === b.id).map((l) => ({ componentId: l.component_id, qtyPer: l.qty_per, scrapBp: 0 })) }));
  const made = new Set(approvedBoms.map((b) => b.item_id));

  const itemRows = await db.all<{ id: string; code: string; kind: 'product' | 'service'; procurement: 'buy' | 'make' | null; lead_time_days: number | null; moq: number | null; lot_rule: PlanItem['lotRule'] | null; lot_size: number | null; safety_stock: number | null; expedite_lead_time_days: number | null }>(
    `SELECT i.id, i.code, i.kind, p.procurement, p.lead_time_days, p.moq, p.lot_rule, p.lot_size, p.safety_stock, p.expedite_lead_time_days
     FROM mdm_item i LEFT JOIN mdm_item_planning p ON p.item_id = i.id WHERE i.active = 1 ORDER BY i.code`);
  const items: PlanItem[] = itemRows.map((r) => ({
    id: r.id, code: r.code, kind: r.kind, hasPlanning: r.procurement !== null,
    procurement: r.procurement ?? (made.has(r.id) ? 'make' : 'buy'),
    leadTimeDays: r.lead_time_days ?? 0, moq: r.moq ?? 0, lotRule: r.lot_rule ?? 'lot_for_lot', lotSize: r.lot_size ?? 0, safetyStock: r.safety_stock ?? 0,
    expediteLeadTimeDays: r.expedite_lead_time_days ?? null,
  }));

  // lines that make an item: configured ones first; otherwise the lines its past work orders ran on
  const itemLines = new Map<string, string[]>();
  for (const r of await db.all<{ item_id: string; line_code: string }>('SELECT item_id, line_code FROM pln_item_line ORDER BY item_id, rank')) itemLines.set(r.item_id, [...(itemLines.get(r.item_id) ?? []), r.line_code]);
  for (const r of await db.all<{ item_id: string; line_code: string }>('SELECT item_id, line_code, COUNT(*) n FROM exe_work_order WHERE line_code IS NOT NULL GROUP BY item_id, line_code ORDER BY item_id, n DESC, line_code')) {
    if (!itemLines.has(r.item_id) || !(await db.get('SELECT 1 FROM pln_item_line WHERE item_id = ?', [r.item_id]))) {
      const cur = itemLines.get(r.item_id) ?? [];
      if (!cur.includes(r.line_code)) itemLines.set(r.item_id, [...cur, r.line_code]);
    }
  }

  // calendar and shifts
  const eng = ctx.services.get('eng');
  const working = new Set<string>();
  for (let d = today; d <= horizonTo; d = addDays(d, 1)) if (await eng.isWorkingDay(d)) working.add(d);
  const shifts = (await eng.shifts()).filter((x) => x.active).map((x) => x.code).sort();
  const base = s.base_shifts ? s.base_shifts.split(',').map((x) => x.trim()).filter((x) => shifts.includes(x)) : shifts.slice(0, 1);
  const added = await db.all<{ line_code: string; shift_code: string; valid_from: string; valid_to: string }>('SELECT * FROM pln_line_shift');

  const crewOf = new Map((await db.all<{ node_code: string; crew: number }>('SELECT node_code, crew FROM pln_node_crew')).map((r) => [r.node_code, r.crew]));
  const reqs = await db.all<{ station_code: string; skill_code: string; min_level: number }>('SELECT station_code, skill_code, min_level FROM mdm_station_requirement ORDER BY station_code, skill_code');
  const nodes = await db.all<{ id: string; code: string; type: string; parent_id: string | null; capacity_per_shift: number | null }>("SELECT id, code, type, parent_id, capacity_per_shift FROM mdm_plant_node WHERE active = 1 AND type IN ('line', 'station') ORDER BY code");
  const lines: LineInfo[] = nodes.filter((n) => n.type === 'line').map((l) => ({
    code: l.code,
    capacityPerShift: l.capacity_per_shift === null ? null : l.capacity_per_shift * 1000,
    crew: crewOf.get(l.code) ?? 0,
    stations: nodes.filter((n) => n.type === 'station' && n.parent_id === l.id).map((st) => ({
      code: st.code, crew: crewOf.get(st.code) ?? 1,
      requirements: reqs.filter((r) => r.station_code === st.code).map((r) => ({ skill: r.skill_code, level: r.min_level })),
    })),
    shiftsOn: (date: string) => {
      const set = new Set(base);
      for (const a of added) if (a.line_code === l.code && a.valid_from <= date && date <= a.valid_to) set.add(a.shift_code);
      return shifts.filter((x) => set.has(x));
    },
  }));

  // demand
  const sales = (await db.all<{ code: string; priority: number; line_no: number; item_id: string; item_code: string; qty: number; delivered_qty: number; requested_date: string; promised_date: string | null }>(
    `SELECT o.code, o.priority, l.line_no, l.item_id, l.item_code, l.qty, l.delivered_qty, l.requested_date, l.promised_date
     FROM mdm_sales_order o JOIN mdm_sales_order_line l ON l.so_id = o.id WHERE o.status = 'open' AND l.qty > l.delivered_qty ORDER BY o.code, l.line_no`))
    .map((r) => ({ orderCode: r.code, lineNo: r.line_no, itemId: r.item_id, itemCode: r.item_code, openQty: r.qty - r.delivered_qty, date: r.promised_date ?? r.requested_date, priority: r.priority }));
  // the latest approved plan wins for each item and month
  const dpRows = await db.all<{ code: string; approved_at: string; item_id: string; item_code: string; period: string; qty: number }>(
    `SELECT p.code, p.approved_at, l.item_id, l.item_code, l.period, l.qty FROM mdm_demand_plan p JOIN mdm_demand_plan_line l ON l.plan_id = p.id
     WHERE p.status = 'approved' ORDER BY p.approved_at, p.code`);
  const dp = new Map<string, (typeof dpRows)[number]>();
  for (const r of dpRows) dp.set(`${r.item_id}|${r.period}`, r);
  const demandPlans = [...dp.values()].filter((r) => r.qty > 0).map((r) => ({ planCode: r.code, itemId: r.item_id, itemCode: r.item_code, period: r.period, qty: r.qty }));

  // supply
  const onHand = new Map<string, number>();
  const usable = s.planning_warehouses ? new Set(s.planning_warehouses.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean)) : null;
  for (const r of await db.all<{ item_id: string; warehouse_code: string; free: number }>('SELECT item_id, warehouse_code, on_hand - reserved AS free FROM mdm_stock')) {
    const code = r.warehouse_code.toUpperCase();
    if (usable ? !usable.has(code) : code === 'QA-HOLD') continue;
    onHand.set(r.item_id, (onHand.get(r.item_id) ?? 0) + r.free);
  }
  for (const [k, v] of onHand) if (v < 0) onHand.set(k, 0);
  const receipts = (await db.all<{ code: string; line_no: number; item_id: string; qty: number; received_qty: number; expected_date: string }>(
    `SELECT p.code, l.line_no, l.item_id, l.qty, l.received_qty, l.expected_date FROM mdm_purchase_order p JOIN mdm_purchase_order_line l ON l.po_id = p.id
     WHERE p.status = 'open' AND l.qty > l.received_qty ORDER BY p.code, l.line_no`))
    .map((r) => ({ itemId: r.item_id, date: r.expected_date, qty: r.qty - r.received_qty, ref: `${r.code}/${r.line_no}` }));

  const commitments: Commitment[] = [];
  for (const r of await db.all<PlannedRow>("SELECT * FROM pln_planned_order WHERE status = 'firmed'")) {
    commitments.push({ id: r.id, itemId: r.item_id, openQty: r.qty, startDate: r.start_date, dueDate: r.due_date, lineCode: r.line_code, status: 'firmed', pegs: JSON.parse(r.pegging) as Peg[] });
  }
  for (const w of await db.all<{ id: string; item_id: string; planned_qty: number; completed_qty: number; scrapped_qty: number; production_date: string; due_date: string | null; line_code: string | null; pegging: string | null }>(
    "SELECT id, item_id, planned_qty, completed_qty, scrapped_qty, production_date, due_date, line_code, pegging FROM exe_work_order WHERE status = 'released'")) {
    const open = w.planned_qty - w.completed_qty - w.scrapped_qty;
    if (open <= 0) continue;
    const due = w.due_date ?? w.production_date;
    commitments.push({ id: w.id, itemId: w.item_id, openQty: open, startDate: w.production_date < due ? w.production_date : due, dueDate: due, lineCode: w.line_code, status: 'released', pegs: w.pegging ? (JSON.parse(w.pegging) as Peg[]) : undefined });
  }

  return {
    horizonTo,
    input: {
      today, horizonDays, frozenDays, defaultMakeLeadDays: Number(s.default_make_lead_days), isWorkingDay: (d) => working.has(d), shiftOrder: shifts.length ? shifts : ['A', 'B', 'C'],
      items, boms, itemLines, lines, sales, demandPlans, onHand, receipts, commitments,
    },
  };
}

/** One MRP run: plan, keep, publish — all in one transaction. */
export async function runPlanning(ctx: Ctx, trigger: 'manual' | 'nightly' | 'scenario') {
  const started = ctx.clock.now();
  const today = todayOf(ctx);
  const { input, horizonTo } = await loadInput(ctx, today);
  const out = plan(input);
  const runId = ctx.clock.newId();
  const stamp = started.toISOString();
  let code = `MRP-${stamp.slice(0, 10).replaceAll('-', '')}-${stamp.slice(11, 16).replace(':', '')}`;

  return ctx.db.tx(async (t) => {
    if (await t.get('SELECT 1 FROM pln_run WHERE code = ?', [code])) code = `${code}${stamp.slice(17, 19)}-${runId.slice(-4)}`;
    const eco = ctx.services.get('eco');
    const company = ctx.config.companyId;
    const runRef = { id: runId, code };
    const items = new Map(input.items.map((i) => [i.id, i]));
    const uomOf = new Map((await t.all<{ id: string; base_uom: string }>('SELECT id, base_uom FROM mdm_item')).map((r) => [r.id, r.base_uom]));
    const wh = await t.get<{ id: string; code: string }>('SELECT id, code FROM mdm_warehouse WHERE active = 1 ORDER BY is_default DESC, code LIMIT 1');
    let published = 0;
    const pegOut = (p: Peg[]) => p.filter((x) => x.qty > 0).map((x) => ({ kind: x.kind, reference: x.reference.slice(0, 80), qty: formatQty(x.qty) }));

    // planned orders: the unfirmed ones are replaced by this run
    await t.run("DELETE FROM pln_planned_order WHERE status = 'planned'");
    for (const p of out.plannedOrders) {
      await t.run("INSERT INTO pln_planned_order (id, run_id, item_id, qty, start_date, due_date, line_code, status, pegging) VALUES (?, ?, ?, ?, ?, ?, ?, 'planned', ?)",
        [ctx.clock.newId(), runId, p.itemId, p.qty, p.startDate, p.dueDate, p.lineCode, JSON.stringify(p.pegging)]);
    }

    // requisitions: stable id per item and ISO week of need; a changed one is a new version; a vanished one is cancelled
    const seen = new Set<string>();
    for (const r of out.requisitions) {
      const item = items.get(r.itemId)!;
      const week = isoWeek(r.needDate);
      const id = uuidv5(company, `gmes:pr:${item.code}:${week}`);
      seen.add(id);
      const prev = await t.get<ReqRow>('SELECT * FROM pln_requisition WHERE id = ?', [id]);
      const pegging = JSON.stringify(r.pegging);
      const same = prev && prev.status === 'open' && prev.qty === r.qty && prev.need_date === r.needDate && prev.order_by_date === r.orderByDate && prev.pegging === pegging;
      if (same) { await t.run('UPDATE pln_requisition SET run_id = ?, past_due = ?, expedite = ? WHERE id = ?', [runId, r.pastDue ? 1 : 0, r.expediteWouldMeetNeed ? 1 : 0, id]); continue; }
      const version = (prev?.version ?? 0) + 1;
      const reqCode = `PR-${item.code}-${week}`.slice(0, 64);
      await t.run(
        `INSERT INTO pln_requisition (id, key, code, item_id, qty, need_date, order_by_date, warehouse_id, status, run_id, version, pegging, past_due, expedite)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET qty = excluded.qty, need_date = excluded.need_date, order_by_date = excluded.order_by_date, status = 'open', run_id = excluded.run_id,
           version = excluded.version, pegging = excluded.pegging, past_due = excluded.past_due, expedite = excluded.expedite`,
        [id, r.key, reqCode, r.itemId, r.qty, r.needDate, r.orderByDate, wh?.id ?? null, runId, version, pegging, r.pastDue ? 1 : 0, r.expediteWouldMeetNeed ? 1 : 0]);
      if (wh) {
        await eco.publish(t, {
          type: 'mes.purchase_requisition.v1', subject: `purchase_requisition/${id}`, correlation: `mrp_run/${runId}`,
          data: { id, code: reqCode, version, origin: { app: 'gmes', type: 'purchase_requisition', key: reqCode }, item: { id: item.id, code: item.code }, qty: formatQty(r.qty), uom: uomOf.get(item.id) ?? 'PCS', need_date: r.needDate, order_by_date: r.orderByDate, warehouse: wh, mrp_run: runRef, status: 'open', pegging: pegOut(r.pegging) },
        });
        published++;
      }
    }
    for (const prev of await t.all<ReqRow>("SELECT * FROM pln_requisition WHERE status = 'open'")) {
      if (seen.has(prev.id)) continue;
      const version = prev.version + 1;
      await t.run("UPDATE pln_requisition SET status = 'cancelled', version = ?, run_id = ? WHERE id = ?", [version, runId, prev.id]);
      const item = items.get(prev.item_id);
      if (wh && item) {
        await eco.publish(t, {
          type: 'mes.purchase_requisition.v1', subject: `purchase_requisition/${prev.id}`, correlation: `mrp_run/${runId}`,
          data: { id: prev.id, code: prev.code, version, origin: { app: 'gmes', type: 'purchase_requisition', key: prev.code }, item: { id: item.id, code: item.code }, qty: formatQty(prev.qty), uom: uomOf.get(item.id) ?? 'PCS', need_date: prev.need_date, order_by_date: prev.order_by_date, warehouse: wh, mrp_run: runRef, status: 'cancelled', pegging: pegOut(JSON.parse(prev.pegging) as Peg[]) },
        });
        published++;
      }
    }

    // crew requirements: identity line x shift x day; changed ones get a new version; a need that disappeared goes to 0
    const crewSeen = new Set<string>();
    const publishCrew = async (id: string, line: string, shift: string, date: string, headcount: number, skills: { skill: string; level: number; count: number }[]) => {
      const prev = await t.get<CrewRowDb>('SELECT * FROM pln_crew WHERE id = ?', [id]);
      const sk = JSON.stringify(skills);
      if (prev && prev.headcount === headcount && prev.skills === sk) { await t.run('UPDATE pln_crew SET run_id = ? WHERE id = ?', [runId, id]); return; }
      if (!prev && headcount === 0) return;
      const version = (prev?.version ?? 0) + 1;
      await t.run(`INSERT INTO pln_crew (id, line_code, shift_code, work_date, headcount, skills, run_id, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET headcount = excluded.headcount, skills = excluded.skills, run_id = excluded.run_id, version = excluded.version`, [id, line, shift, date, headcount, sk, runId, version]);
      await eco.publish(t, {
        type: 'mes.crew_requirement.v1', subject: `crew_requirement/${id}`, correlation: `mrp_run/${runId}`,
        data: { id, line, shift, work_date: date, headcount, skills: skills.map((s) => ({ skill_code: s.skill, level: s.level, count: s.count })).filter((s) => s.count > 0), mrp_run: runRef, version, origin: { app: 'gmes', type: 'crew_requirement', key: `${line}:${shift}:${date}` } },
      });
      published++;
    };
    for (const c of out.crew) {
      const id = uuidv5(company, `gmes:crew:${c.line}:${c.shift}:${c.date}`);
      crewSeen.add(id);
      await publishCrew(id, c.line, c.shift, c.date, c.headcount, c.skills);
    }
    for (const prev of await t.all<CrewRowDb>('SELECT * FROM pln_crew WHERE headcount > 0 AND work_date >= ?', [today])) {
      if (!crewSeen.has(prev.id)) await publishCrew(prev.id, prev.line_code, prev.shift_code, prev.work_date, 0, []);
    }

    // supply plan (one snapshot per run)
    const supplyLines = out.supplyPlan.filter((l) => items.has(l.itemId));
    if (supplyLines.length) {
      const id = uuidv5(company, `gmes:supply_plan:${code}`);
      await eco.publish(t, {
        type: 'mes.supply_plan.v1', subject: `supply_plan/${id}`, correlation: `mrp_run/${runId}`,
        data: { id, code, version: 1, origin: { app: 'gmes', type: 'supply_plan', key: code }, mrp_run: runRef, lines: supplyLines.slice(0, 5000).map((l) => ({ item: { id: l.itemId, code: items.get(l.itemId)!.code }, period: l.period, demand_qty: formatQty(l.demandQty), planned_qty: formatQty(l.plannedQty), constraint: l.constraint })) },
      });
      published++;
    }

    const stats = { ...out.stats, exceptions: out.exceptions.length, errors: out.exceptions.filter((e) => e.severity === 'error').length, proposals: out.proposals.length, published };
    await t.run('INSERT INTO pln_run (id, code, started_at, finished_at, today, horizon_to, status, trigger, stats, output) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [runId, code, stamp, ctx.clock.now().toISOString(), today, horizonTo, 'done', trigger, JSON.stringify(stats), JSON.stringify(out)]);
    return { id: runId, code, today, horizonTo, stats };
  });
}

// ------------------------------------------------------------------ release a planned order as a work order

async function release(ctx: Ctx, t: Db, caller: Caller, id: string, body: { commandId: string; warehouseId?: string; productionDate?: string }) {
  const r = await plannedOrThrow(t, id);
  if (r.status !== 'planned' && r.status !== 'firmed') conflict('pln.not_releasable', `planned order is ${r.status}`);
  const wh = body.warehouseId ?? (await t.get<{ id: string }>('SELECT id FROM mdm_warehouse WHERE active = 1 ORDER BY is_default DESC, code LIMIT 1'))?.id;
  if (!wh) fail('warehouse.none', 'no active warehouse to receive the production');
  const wo = await ctx.services.get('exe').create(t, caller, {
    commandId: `${body.commandId}:wo`, itemId: r.item_id, qty: r.qty, warehouseId: wh!, line: r.line_code ?? undefined,
    productionDate: body.productionDate ?? r.start_date, dueDate: r.due_date, plannedOrderId: r.id, pegging: JSON.parse(r.pegging),
  });
  await t.run("UPDATE pln_planned_order SET status = 'released', work_order_id = ?, firmed_by = COALESCE(firmed_by, ?), firmed_at = COALESCE(firmed_at, ?) WHERE id = ?", [wo.id, caller.name, ctx.clock.now().toISOString(), id]);
  return { id, status: 'released', workOrder: wo };
}

// ------------------------------------------------------------------ helpers

async function plannedOrThrow(t: Db, id: string): Promise<PlannedRow> {
  const r = await t.get<PlannedRow>('SELECT * FROM pln_planned_order WHERE id = ?', [id]);
  if (!r) return notFound('planned_order', id);
  return r;
}

async function lastRun(ctx: Ctx): Promise<{ id: string; code: string; output: PlanOutput } | null> {
  const r = await ctx.db.get<{ id: string; code: string; output: string }>('SELECT id, code, output FROM pln_run ORDER BY started_at DESC LIMIT 1');
  return r ? { id: r.id, code: r.code, output: JSON.parse(r.output) as PlanOutput } : null;
}

async function itemNames(ctx: Ctx): Promise<Map<string, { id: string; code: string; name_en: string; name_ar: string }>> {
  return new Map((await ctx.db.all<{ id: string; code: string; name_en: string; name_ar: string }>('SELECT id, code, name_en, name_ar FROM mdm_item')).map((r) => [r.id, r]));
}

function presentPlanned(r: PlannedRow, names: Map<string, { id: string; code: string; name_en: string; name_ar: string }>) {
  return { id: r.id, item: names.get(r.item_id) ?? { id: r.item_id, code: r.item_id }, qty: formatQty(r.qty), start_date: r.start_date, due_date: r.due_date, line: r.line_code, status: r.status, work_order_id: r.work_order_id, pegging: (JSON.parse(r.pegging) as Peg[]).map((p) => ({ ...p, qty: formatQty(p.qty) })), firmed_by: r.firmed_by, firmed_at: r.firmed_at };
}

async function presentOutput(ctx: Ctx, o: PlanOutput) {
  const names = await itemNames(ctx);
  const code = (id: string) => names.get(id)?.code ?? id;
  return {
    plannedOrders: o.plannedOrders.map((p) => ({ ...p, item: code(p.itemId), qty: formatQty(p.qty) })),
    requisitions: o.requisitions.map((r) => ({ ...r, item: code(r.itemId), qty: formatQty(r.qty) })),
    crew: o.crew, proposals: o.proposals, exceptions: o.exceptions.map((e) => ({ ...e, item: e.itemId ? code(e.itemId) : null })),
    supplyPlan: o.supplyPlan.map((l) => ({ ...l, item: code(l.itemId), demandQty: formatQty(l.demandQty), plannedQty: formatQty(l.plannedQty) })),
  };
}

/**
 * The nightly run: a check every ten minutes; when it is 02:00 or later in the plant and the last run is older than 20 hours,
 * planning runs by itself (trigger `nightly`). GMES_PLAN_LOOP=off stops it (the scenario engine runs planning explicitly).
 */
export function startPlanner(ctx: Ctx, everyMs = 600_000): () => void {
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    (async () => {
      const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: ctx.config.timeZone, hour: '2-digit', hourCycle: 'h23' }).format(ctx.clock.now()));
      if (hour < 2) return;
      const last = await ctx.db.get<{ started_at: string }>('SELECT started_at FROM pln_run ORDER BY started_at DESC LIMIT 1');
      if (last && ctx.clock.now().getTime() - new Date(last.started_at).getTime() < 20 * 3_600_000) return;
      await runPlanning(ctx, 'nightly');
    })().catch(() => undefined).finally(() => { busy = false; });
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}