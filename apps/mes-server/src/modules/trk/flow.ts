import type { BomLine, PlantNode, RouteOp, Routing, UnitRow, WorkOrderView } from '../../contracts/services.js';
import type { Db } from '../../kernel/db.js';
import { conflict, fail, notFound } from '../../kernel/errors.js';
import type { Caller, Ctx } from '../../kernel/modules.js';
import { event, setUnit, today } from './store.js';

/**
 * The route of a serial unit, enforced on the server:
 *
 *   first operation  -> the unit is CREATED on the work order the station runs (never more units than planned)
 *   every operation  -> PASS moves it to the next operation; skipping one is refused unless it is optional
 *   a test / check   -> FAIL (with a defect code) sends it to REPAIR; after repair it returns to the SAME test
 *   last operation   -> COMPLETE: one unit of the work order is booked in the production ledger (qty 1, lot = serial)
 *   any time         -> SCRAP (with a reason): one unit scrapped in the production ledger
 *
 * Key parts are scanned where the bill of materials says so: a part with its own serial is ATTACHED (it becomes
 * "consumed" into its parent — the genealogy both ways), a lot is taken from what is loaded on the station.
 * A held unit (quality) moves nowhere. Every step is one command, one transaction, one fact in the unit history.
 */
export interface ScanIn {
  commandId: string;
  station: string;
  serial: string;
  workOrderId?: string;
  result: 'pass' | 'fail';
  defectCode?: string;
  parts?: { serial: string; itemId?: string }[];
  productionDate?: string;
  shift?: string;
  person?: { id: string; code: string };
}

export const SERIAL = /^[A-Z0-9][A-Z0-9-]{3,39}$/;

export async function stationOf(ctx: Ctx, t: Db, code: string): Promise<{ station: PlantNode; line: PlantNode; op: string }> {
  const mdm = ctx.services.get('mdm');
  const station = await mdm.plantNode(code, t);
  if (!station || station.type !== 'station') return fail('station.unknown', `${code} is not a station of the plant model`);
  if (!station.active) conflict('station.inactive', `station ${code} is inactive`);
  const line = (await t.get<PlantNode>('SELECT * FROM mdm_plant_node WHERE id = ?', [station.parent_id]))!;
  if (!station.code.startsWith(line.code + '-')) fail('station.code', `station ${code} must be named <line>-<operation> (e.g. ${line.code}-FT) to take part in a routing`);
  return { station, line, op: station.code.slice(line.code.length + 1) };
}

const routingCache = new WeakMap<Ctx, Map<string, Routing>>();
async function route(ctx: Ctx, t: Db, id: string): Promise<Routing> {
  let m = routingCache.get(ctx);
  if (!m) routingCache.set(ctx, (m = new Map()));
  let r = m.get(id);
  if (!r) {   // approved revisions are frozen, so a cached copy can never be out of date
    r = await ctx.services.get('eng').routing(id, t);
    if (r.status !== 'draft') m.set(id, r);
  }
  return r;
}
const bomCache = new WeakMap<Ctx, Map<string, BomLine[]>>();
async function bomLines(ctx: Ctx, t: Db, id: string | null): Promise<BomLine[]> {
  if (!id) return [];
  let m = bomCache.get(ctx);
  if (!m) bomCache.set(ctx, (m = new Map()));
  let r = m.get(id);
  if (!r) { const b = await ctx.services.get('eng').bom(id, t); r = b.lines; if (b.status !== 'draft') m.set(id, r); }
  return r;
}

export async function unitBySerial(t: Db, serial: string) {
  return t.get<UnitRow>('SELECT * FROM trk_unit WHERE serial = ?', [serial]);
}

async function runningOrder(ctx: Ctx, t: Db, line: string, opCode: string, wanted?: string): Promise<WorkOrderView> {
  const exe = ctx.services.get('exe');
  let wo: WorkOrderView | undefined;
  if (wanted) wo = await exe.workOrder(wanted, t);
  else {
    // the line's released order with a routing, highest priority first, oldest first
    wo = await t.get<WorkOrderView>(`SELECT * FROM exe_work_order WHERE line_code = ? AND status = 'released' AND routing_id IS NOT NULL
      ORDER BY priority, production_date, code LIMIT 1`, [line]);
    if (!wo) return conflict('wo.none_running', `no released work order with a routing runs on ${line}: choose one`);
  }
  if (wo.status !== 'released') conflict('wo.not_open', `work order ${wo.code} is ${wo.status}`);
  if (wo.line_code !== line) conflict('wo.other_line', `work order ${wo.code} runs on ${wo.line_code ?? 'no line'}, not on ${line}`);
  if (!wo.routing_id) conflict('wo.no_routing', `work order ${wo.code} was released without a routing: it is booked by quantity, not by serial`);
  const r = await route(ctx, t, wo.routing_id!);
  if (r.operations[0]!.code !== opCode) conflict('unit.not_first_op', `a new unit starts at ${r.operations[0]!.code} (${r.operations[0]!.name_en}); ${opCode} is later in the route`);
  return wo;
}

export async function scan(ctx: Ctx, t: Db, caller: Caller, input: ScanIn) {
  const serial = input.serial.trim().toUpperCase();
  if (!SERIAL.test(serial)) fail('unit.serial_format', `${input.serial} is not a serial number (4-40 letters, digits or dashes)`);
  const where = await stationOf(ctx, t, input.station);
  const pdate = input.productionDate ?? today(ctx);
  const base = { commandId: input.commandId, productionDate: pdate, shift: input.shift, person: input.person, station: where.station.code };
  let u = await unitBySerial(t, serial);
  let created = false;
  if (!u) {
    const wo = await runningOrder(ctx, t, where.line.code, where.op, input.workOrderId);
    const n = (await t.get<{ n: number }>('SELECT COUNT(*) n FROM trk_unit WHERE work_order_id = ?', [wo.id]))!.n;
    if ((n + 1) * 1000 > wo.planned_qty) conflict('wo.all_units_started', `all ${wo.planned_qty / 1000} units of ${wo.code} have been started`);
    if (await t.get(`SELECT 1 FROM trk_genealogy WHERE lot_no = ? AND kind = 'part'`, [serial])) conflict('unit.serial_used', `${serial} was already used as a part`);
    const r = await route(ctx, t, wo.routing_id!);
    const now = ctx.clock.now().toISOString();
    const id = ctx.clock.newId();
    await t.run(`INSERT INTO trk_unit (id, serial, item_id, work_order_id, line_code, status, op_seq, op_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'wip', ?, ?, ?, ?)`,
      [id, serial, wo.item_id, wo.id, where.line.code, r.operations[0]!.seq, r.operations[0]!.code, now, now]);
    u = (await unitBySerial(t, serial))!;
    await event(ctx, t, caller, { ...base, kind: 'CREATE', unit: u, op_seq: u.op_seq, op_code: u.op_code });
    created = true;
  }
  const wo = await ctx.services.get('exe').workOrder(u.work_order_id, t);
  movable(u);
  if (u.line_code !== where.line.code) conflict('unit.other_line', `${serial} runs on ${u.line_code}, not on ${where.line.code}`);
  const r = await route(ctx, t, wo.routing_id!);
  const op = r.operations.find((o) => o.code === where.op);
  if (!op) return conflict('station.not_in_route', `${where.station.code} (${where.op}) is not an operation of ${serial}'s route`);
  if (op.seq < u.op_seq!) conflict('unit.already_passed', `${serial} already passed ${op.code}; it is now at ${u.op_code}`);
  if (op.seq > u.op_seq!) {
    const skipped = r.operations.filter((o) => o.seq >= u!.op_seq! && o.seq < op.seq);
    const must = skipped.find((o) => o.mandatory);
    if (must) conflict('unit.wrong_step', `${serial} must pass ${must.code} (${must.name_en}) before ${op.code}`, { expected: must.code });
  }
  if (input.result === 'fail') {
    if (!input.defectCode) fail('defect.required', 'a failed unit needs a defect code');
    if (ctx.services.has('qms')) await ctx.services.get('qms').checkDefect(t, input.defectCode!);
    await event(ctx, t, caller, { ...base, kind: 'FAIL', unit: u, op_seq: op.seq, op_code: op.code, defect_code: input.defectCode });
    await setUnit(ctx, t, u, { status: 'repair', op_seq: op.seq, op_code: op.code, fail_op_seq: op.seq, last_station: where.station.code });
    return view(u, op, null, 'fail', created);
  }
  // key parts and materials of this operation (only the first time the unit passes it: a re-test after repair attaches nothing)
  if (u.fail_op_seq !== op.seq) await consumeAt(ctx, t, caller, u, wo, op, where.station.code, input, base);
  const next = r.operations.find((o) => o.seq > op.seq) ?? null;
  await event(ctx, t, caller, { ...base, kind: 'PASS', unit: u, op_seq: op.seq, op_code: op.code });
  if (next) {
    await setUnit(ctx, t, u, { op_seq: next.seq, op_code: next.code, last_station: where.station.code, fail_op_seq: null });
    return view(u, op, next, 'pass', created);
  }
  // the last operation: one unit of the work order is produced
  await setUnit(ctx, t, u, { status: 'completed', op_seq: null, op_code: null, last_station: where.station.code, fail_op_seq: null, completed_at: ctx.clock.now().toISOString() });
  if (wo.completed_qty + wo.scrapped_qty + 1000 === wo.planned_qty) await flushOrder(ctx, t, caller, wo.id, base);   // material before the final unit
  const booked = await ctx.services.get('exe').complete(t, caller, wo.id, { ...base, qty: 1000, lotNo: serial });
  await event(ctx, t, caller, { ...base, kind: 'COMPLETE', unit: u, op_seq: op.seq, op_code: op.code, detail: { ledger_seq: booked.ledgerSeq } });
  return view(u, op, null, 'complete', created);
}

function movable(u: UnitRow) {
  if (u.held > 0) conflict('unit.held', `${u.serial} is on quality hold: it moves nowhere until quality releases it`);
  if (u.status === 'repair') conflict('unit.in_repair', `${u.serial} failed ${u.op_code} and waits for repair`);
  if (u.status === 'scrapped') conflict('unit.scrapped', `${u.serial} was scrapped`);
  if (u.status !== 'wip') conflict('unit.finished', `${u.serial} is ${u.status}: its route is finished`);
}

const view = (u: UnitRow, op: RouteOp, next: RouteOp | null, result: string, created: boolean) => ({
  unit: { id: u.id, serial: u.serial, status: u.status, work_order_id: u.work_order_id }, result, created,
  op: { seq: op.seq, code: op.code, name_en: op.name_en, name_ar: op.name_ar },
  next: next ? { seq: next.seq, code: next.code, name_en: next.name_en, name_ar: next.name_ar } : null,
});

async function consumeAt(ctx: Ctx, t: Db, caller: Caller, u: UnitRow, wo: WorkOrderView, op: RouteOp, station: string, input: ScanIn,
  base: { commandId: string; productionDate: string; shift?: string; person?: { id: string; code: string } }) {
  const lines = (await bomLines(ctx, t, wo.bom_id)).filter((l) => l.op_code === op.code);
  if (!lines.length) return;
  const now = ctx.clock.now().toISOString();
  const parts = (input.parts ?? []).map((p) => ({ ...p, serial: p.serial.trim().toUpperCase() }));
  const serialLines = lines.filter((l) => l.scan === 'serial');
  const used = new Set<number>();
  for (const l of serialLines) {
    // the scanned serial whose item is this line's component (a known unit), else the first unknown serial left
    let idx = -1;
    let child: UnitRow | undefined;
    for (let i = 0; i < parts.length && idx < 0; i++) {
      if (used.has(i)) continue;
      const c = await unitBySerial(t, parts[i]!.serial);
      if (c ? c.item_id === l.component_id : parts[i]!.itemId === l.component_id) { idx = i; child = c; }
    }
    if (idx < 0) {
      const free = parts.findIndex((p, i) => !used.has(i) && !p.itemId);
      if (free >= 0 && !(await unitBySerial(t, parts[free]!.serial))) idx = free;
    }
    if (idx < 0) return conflict('part.required', `scan the serial of ${l.component_code} (${l.name_en}) at ${op.code}`, { part: l.component_code });
    used.add(idx);
    const ps = parts[idx]!.serial;
    if (!/^[A-Z0-9][A-Z0-9-]{3,39}$/.test(ps)) fail('part.serial_format', `${ps} is not a serial number`);
    if (child) {
      if (child.held > 0) conflict('part.held', `part ${ps} is on quality hold`);
      if (child.status !== 'completed') conflict('part.not_available', `part ${ps} is ${child.status}: only a finished, free part can be fitted`);
      const seq = await event(ctx, t, caller, { ...base, kind: 'ATTACH', unit: u, station, op_seq: op.seq, op_code: op.code, detail: { part: ps, part_unit: child.id } });
      await setUnit(ctx, t, child, { status: 'consumed', parent_id: u.id });
      await t.run(`INSERT INTO trk_genealogy (parent_id, child_id, kind, item_id, lot_no, qty, op_code, station, verified, event_seq, at) VALUES (?, ?, 'unit', ?, ?, ?, ?, ?, 1, ?, ?)`,
        [u.id, child.id, child.item_id, ps, 1000, op.code, station, seq, now]);
    } else {
      // a bought-in serial part (made elsewhere): accepted once, recorded as not verified against its maker
      if (await t.get(`SELECT 1 FROM trk_genealogy WHERE item_id = ? AND lot_no = ? AND kind = 'part'`, [l.component_id, ps])) conflict('part.used', `part ${ps} was already fitted to another unit`);
      const seq = await event(ctx, t, caller, { ...base, kind: 'ATTACH', unit: u, station, op_seq: op.seq, op_code: op.code, detail: { part: ps, item: l.component_code, verified: false } });
      await t.run(`INSERT INTO trk_genealogy (parent_id, child_id, kind, item_id, lot_no, qty, op_code, station, verified, event_seq, at) VALUES (?, NULL, 'part', ?, ?, ?, ?, ?, 0, ?, ?)`,
        [u.id, l.component_id, ps, 1000, op.code, station, seq, now]);
    }
  }
  for (const l of lines.filter((x) => x.scan === 'lot')) {
    const load = await t.get<{ id: string; lot_no: string; verified: number }>('SELECT id, lot_no, verified FROM trk_load WHERE station = ? AND item_id = ? AND unloaded_at IS NULL', [station, l.component_id]);
    if (!load) conflict('material.not_loaded', `${l.component_code} (${l.name_en}) is not loaded on ${station}: load a lot first`, { part: l.component_code });
    await t.run(`INSERT INTO trk_load_use (load_id, work_order_id, units, qty) VALUES (?, ?, 1, ?)
      ON CONFLICT(load_id, work_order_id) DO UPDATE SET units = units + 1, qty = qty + excluded.qty`, [load!.id, wo.id, l.qty_per]);
    const seq = (await t.get<{ seq: number }>('SELECT MAX(seq) seq FROM trk_event'))!.seq;
    await t.run(`INSERT INTO trk_genealogy (parent_id, child_id, kind, item_id, lot_no, qty, op_code, station, verified, event_seq, at) VALUES (?, NULL, 'lot', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [u.id, l.component_id, load!.lot_no, l.qty_per, op.code, station, load!.verified, seq, now]);
  }
}

/**
 * Books the material of a work order before its FINAL unit: what its units took from lots loaded on stations, and the
 * material no station scans (screws, labels, tape) from the BOM, for every unit that finished (completed or fitted).
 * Consumption therefore always comes before the final completion in the production ledger (accounting relies on it).
 */
export async function flushOrder(ctx: Ctx, t: Db, caller: Caller, woId: string, base: { commandId: string; productionDate?: string; shift?: string }) {
  const exe = ctx.services.get('exe');
  const wo = await exe.workOrder(woId, t);
  let n = 0;
  const uses = await t.all<{ load_id: string; qty: number; item_id: string; lot_no: string; warehouse_id: string }>(
    `SELECT u.load_id, u.qty, l.item_id, l.lot_no, l.warehouse_id FROM trk_load_use u JOIN trk_load l ON l.id = u.load_id WHERE u.work_order_id = ? AND u.booked = 0`, [woId]);
  for (const u of uses) {
    await t.run('UPDATE trk_load_use SET booked = 1 WHERE load_id = ? AND work_order_id = ?', [u.load_id, woId]);
    await exe.consume(t, caller, woId, { ...base, itemId: u.item_id, qty: u.qty, warehouseId: u.warehouse_id, lotNo: u.lot_no });
    n++;
  }
  const lines = (await bomLines(ctx, t, wo.bom_id)).filter((l) => l.scan === 'none');
  const wh = await t.get<{ id: string }>('SELECT id FROM mdm_warehouse WHERE active = 1 ORDER BY is_default DESC, code LIMIT 1');
  if (!lines.length || !wh) return n;
  const units = (await t.get<{ n: number }>(`SELECT COUNT(*) n FROM trk_unit WHERE work_order_id = ? AND status NOT IN ('wip', 'repair', 'scrapped')`, [woId]))!.n;
  for (const l of lines) {
    const done = (await t.get<{ q: number | null }>(`SELECT SUM(qty) q FROM exe_ledger WHERE work_order_id = ? AND txn_type = 'CONSUME' AND item_id = ?`, [woId, l.component_id]))!.q ?? 0;
    const due = units * l.qty_per - done;   // units is a count, qty_per already in thousandths
    if (due <= 0) continue;
    await exe.consume(t, caller, woId, { ...base, itemId: l.component_id, qty: due, warehouseId: wh.id });
    n++;
  }
  return n;
}

export async function repair(ctx: Ctx, t: Db, caller: Caller, input: { commandId: string; serial: string; station?: string; cause: string; action: string; defectCode?: string; productionDate?: string; shift?: string; person?: { id: string; code: string } }) {
  const u = (await unitBySerial(t, input.serial.trim().toUpperCase())) ?? notFound('unit', input.serial);
  if (u.held > 0) conflict('unit.held', `${u.serial} is on quality hold`);
  if (u.status !== 'repair') conflict('unit.not_in_repair', `${u.serial} is ${u.status}, not waiting for repair`);
  await event(ctx, t, caller, { commandId: input.commandId, productionDate: input.productionDate, shift: input.shift, person: input.person, kind: 'REPAIR', unit: u,
    station: input.station ?? null, op_seq: u.fail_op_seq, op_code: u.op_code, defect_code: input.defectCode ?? null, detail: { cause: input.cause, action: input.action } });
  // back to the operation it failed: the test is repeated, never skipped
  await setUnit(ctx, t, u, { status: 'wip', last_station: input.station ?? u.last_station });
  return { serial: u.serial, status: 'wip', back_to: u.op_code };
}

export async function scrapUnit(ctx: Ctx, t: Db, caller: Caller, input: { commandId: string; serial: string; reasonCode: string; station?: string; productionDate?: string; shift?: string; person?: { id: string; code: string } }) {
  const u = (await unitBySerial(t, input.serial.trim().toUpperCase())) ?? notFound('unit', input.serial);
  if (u.held > 0) conflict('unit.held', `${u.serial} is on quality hold: quality decides its fate`);
  if (u.status !== 'wip' && u.status !== 'repair') conflict('unit.finished', `${u.serial} is ${u.status}: only a unit still in production can be scrapped here`);
  const base = { commandId: input.commandId, productionDate: input.productionDate, shift: input.shift, person: input.person, station: input.station };
  const wo = await ctx.services.get('exe').workOrder(u.work_order_id, t);
  const opSeq = u.op_seq, opCode = u.op_code;
  await setUnit(ctx, t, u, { status: 'scrapped', last_station: input.station ?? u.last_station });
  if (wo.completed_qty + wo.scrapped_qty + 1000 === wo.planned_qty) await flushOrder(ctx, t, caller, wo.id, base);
  const booked = await ctx.services.get('exe').scrap(t, caller, u.work_order_id, { ...base, qty: 1000, reasonCode: input.reasonCode });
  await event(ctx, t, caller, { ...base, kind: 'SCRAP', unit: u, station: input.station ?? null, op_seq: opSeq, op_code: opCode, defect_code: input.reasonCode, detail: { ledger_seq: booked.ledgerSeq } });
  return { serial: u.serial, status: 'scrapped' };
}

// ------------------------------------------------------------------ material on stations
export async function load(ctx: Ctx, t: Db, caller: Caller, input: { commandId: string; station: string; itemId: string; lotNo: string; warehouseId: string }) {
  const where = await stationOf(ctx, t, input.station);
  const item = await ctx.services.get('mdm').item(input.itemId, t);
  await ctx.services.get('mdm').warehouse(input.warehouseId, t);
  const lot = input.lotNo.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{1,63}$/.test(lot)) fail('lot.format', `${input.lotNo} is not a lot number`);
  const open = await t.get<{ id: string; lot_no: string }>('SELECT id, lot_no FROM trk_load WHERE station = ? AND item_id = ? AND unloaded_at IS NULL', [where.station.code, item.id]);
  if (open) conflict('material.already_loaded', `${item.code} lot ${open.lot_no} is still loaded on ${where.station.code}: unload it first`);
  const known = await t.get('SELECT 1 FROM trk_material_lot WHERE item_id = ? AND lot_no = ?', [item.id, lot]);
  const id = ctx.clock.newId();
  await t.run('INSERT INTO trk_load (id, station, line_code, item_id, lot_no, warehouse_id, verified, loaded_at, loaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, where.station.code, where.line.code, item.id, lot, input.warehouseId, known ? 1 : 0, ctx.clock.now().toISOString(), caller.name]);
  await event(ctx, t, caller, { commandId: input.commandId, kind: 'LOAD', station: where.station.code, line_code: where.line.code, item_id: item.id, detail: { load: id, lot, verified: !!known } });
  return { id, lot, verified: !!known };
}

/** Unloading books what the units took from the lot as consumption on each work order (one line per order). */
export async function unload(ctx: Ctx, t: Db, caller: Caller, input: { commandId: string; loadId: string; productionDate?: string; shift?: string }) {
  const l = (await t.get<{ id: string; station: string; line_code: string; item_id: string; lot_no: string; warehouse_id: string; unloaded_at: string | null }>(
    'SELECT * FROM trk_load WHERE id = ?', [input.loadId])) ?? notFound('load', input.loadId);
  if (l.unloaded_at) conflict('material.already_unloaded', `lot ${l.lot_no} was already unloaded`);
  await t.run('UPDATE trk_load SET unloaded_at = ?, unloaded_by = ? WHERE id = ?', [ctx.clock.now().toISOString(), caller.name, l.id]);
  const uses = await t.all<{ work_order_id: string; qty: number }>('SELECT work_order_id, qty FROM trk_load_use WHERE load_id = ? AND booked = 0', [l.id]);
  let booked = 0;
  for (const u of uses) {
    const wo = await ctx.services.get('exe').workOrder(u.work_order_id, t);
    if (wo.status !== 'released') continue;   // its material was booked before its final unit (flushOrder)
    await t.run('UPDATE trk_load_use SET booked = 1 WHERE load_id = ? AND work_order_id = ?', [l.id, u.work_order_id]);
    await ctx.services.get('exe').consume(t, caller, wo.id, { commandId: input.commandId, productionDate: input.productionDate, shift: input.shift, itemId: l.item_id, qty: u.qty, warehouseId: l.warehouse_id, lotNo: l.lot_no });
    booked++;
  }
  await event(ctx, t, caller, { commandId: input.commandId, kind: 'UNLOAD', station: l.station, line_code: l.line_code, item_id: l.item_id, detail: { load: l.id, lot: l.lot_no, orders: booked } });
  return { id: l.id, ordersBooked: booked };
}

