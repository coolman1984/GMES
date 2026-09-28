import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { server, type TestServer } from './helpers.js';

let n = 0;
const cmd = () => `serial-cmd-${++n}-${Date.now()}`;

/**
 * A small TV plant: an SMD line that makes main boards (PBA) and a main-assembly line that fits a bought-in panel and
 * the main board into a TV, tests it and packs it.
 */
async function tvPlant() {
  const s = await server('gmes');
  const ok = async (method: string, url: string, body?: unknown) => {
    const r = await s.call(method, url, body);
    assert.ok(r.status < 300, `${method} ${url}: ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const node = async (code: string, type: string, parentId: string | null) => (await ok('POST', '/api/plant', { code, type, parentId, nameEn: code })).id as string;
  const p = await node('P1', 'plant', null);
  const smd = await node('SMD', 'area', p);
  const smdLine = await node('SMD-01', 'line', smd);
  for (const st of ['LD', 'AOI']) await node(`SMD-01-${st}`, 'station', smdLine);
  const ma = await node('MA', 'area', p);
  const maLine = await node('MA-01', 'line', ma);
  for (const st of ['PL', 'MB', 'FT', 'PK']) await node(`MA-01-${st}`, 'station', maLine);
  const item = async (code: string, tracking: string) => (await ok('POST', '/api/items', { code, nameEn: code, nameAr: 'صنف ' + code, tracking })).id as string;
  const ids = { tv: await item('TV-55', 'serial'), pba: await item('PBA-55', 'serial'), panel: await item('PNL-55', 'serial'), screw: await item('SCREW', 'none'), carton: await item('CARTON', 'lot') };
  const wh = (await ok('POST', '/api/warehouses', { code: 'MAIN', nameEn: 'Main', nameAr: 'الرئيسي' })).id as string;
  const route = async (itemId: string, ops: unknown[]) => {
    const r = await ok('POST', '/api/routings', { itemId, operations: ops });
    const cur = await ok('GET', `/api/routings/${r.id}`);
    await ok('POST', `/api/routings/${r.id}/approve`, { version: cur.version });
    return r.id as string;
  };
  const tvRoute = await route(ids.tv, [
    { seq: 10, code: 'PL', nameEn: 'Panel loading' }, { seq: 20, code: 'MB', nameEn: 'Main board' },
    { seq: 30, code: 'FT', nameEn: 'Function test', kind: 'test', cycleSec: 42 }, { seq: 40, code: 'PK', nameEn: 'Packing', kind: 'pack' }]);
  await route(ids.pba, [{ seq: 10, code: 'LD', nameEn: 'Loader' }, { seq: 20, code: 'AOI', nameEn: 'Optical inspection', kind: 'inspection' }]);
  const bom = await ok('POST', '/api/boms', { itemId: ids.tv, lines: [
    { componentId: ids.panel, qtyPer: '1', opCode: 'PL', scan: 'serial' }, { componentId: ids.pba, qtyPer: '1', opCode: 'MB', scan: 'serial' },
    { componentId: ids.screw, qtyPer: '4', opCode: 'MB', scan: 'none' }, { componentId: ids.carton, qtyPer: '1', opCode: 'PK', scan: 'lot' }] });
  await ok('POST', `/api/boms/${bom.id}/approve`, { version: (await ok('GET', `/api/boms/${bom.id}`)).version });
  return { ...s, ok, ids, wh, tvRoute, bomId: bom.id as string };
}

describe('engineering: routings and bills of materials (MDM1040, MDM1050)', () => {
  let s: Awaited<ReturnType<typeof tvPlant>>;
  before(async () => { s = await tvPlant(); });
  after(() => s.close());

  test('an approved routing is frozen (the server and the database refuse a change); a new revision obsoletes it', async () => {
    const r = await s.ok('GET', `/api/routings/${s.tvRoute}`);
    assert.equal(r.status, 'approved');
    assert.deepEqual(r.operations.map((o: any) => o.code), ['PL', 'MB', 'FT', 'PK']);
    const put = await s.call('PUT', `/api/routings/${s.tvRoute}`, { version: r.version, operations: [] });
    assert.equal(put.body.error.code, 'routing.frozen');
    await assert.rejects(() => s.app.ctx.db.run(`UPDATE eng_operation SET code = 'XX' WHERE routing_id = ?`, [s.tvRoute]), /frozen/);
    const draft = await s.ok('POST', '/api/routings', { itemId: s.ids.tv });   // copied from the approved one
    assert.equal(draft.revision, 2);
    assert.equal((await s.call('POST', '/api/routings', { itemId: s.ids.tv })).body.error.code, 'routing.draft_exists');
    const d = await s.ok('GET', `/api/routings/${draft.id}`);
    assert.equal(d.operations.length, 4);
    assert.equal((await s.call('PUT', `/api/routings/${draft.id}`, { version: d.version, operations: [{ seq: 10, code: 'PK', nameEn: 'x', kind: 'pack' }, { seq: 20, code: 'FT', nameEn: 'y' }] })).body.error.code, 'routing.pack_last');
    assert.equal((await s.call('PUT', `/api/routings/${draft.id}`, { version: d.version, operations: [{ seq: 10, code: 'A', nameEn: 'x' }, { seq: 10, code: 'B', nameEn: 'y' }] })).body.error.code, 'routing.duplicate_seq');
  });

  test('a bill of materials only scans a serial on a serialised part, and only at operations of the routing', async () => {
    const b = await s.ok('POST', '/api/boms', { itemId: s.ids.tv });
    const d = await s.ok('GET', `/api/boms/${b.id}`);
    assert.equal(d.lines.length, 4);
    assert.equal(d.lines[2].qty_per, '4');
    const bad = await s.call('PUT', `/api/boms/${b.id}`, { version: d.version, lines: [{ componentId: s.ids.screw, qtyPer: '1', opCode: 'MB', scan: 'serial' }] });
    assert.equal(bad.body.error.code, 'bom.scan_serial');
    const self = await s.call('PUT', `/api/boms/${b.id}`, { version: d.version, lines: [{ componentId: s.ids.tv, qtyPer: '1', opCode: 'MB' }] });
    assert.equal(self.body.error.code, 'bom.self');
    await s.ok('PUT', `/api/boms/${b.id}`, { version: d.version, lines: [{ componentId: s.ids.screw, qtyPer: '2', opCode: 'ZZ' }] });
    const again = await s.ok('GET', `/api/boms/${b.id}`);
    assert.equal((await s.call('POST', `/api/boms/${b.id}/approve`, { version: again.version })).body.error.code, 'bom.unknown_operation');
    const used = await s.ok('GET', `/api/boms/where-used/${s.ids.pba}`);
    assert.equal(used[0].item_code, 'TV-55');
  });

  test('production shifts and the plant calendar (the plant\'s working time, not a roster)', async () => {
    await s.ok('PUT', '/api/production-shifts/A', { nameEn: 'Day', start: '07:00', end: '15:00', breakMin: 40 });
    await s.ok('PUT', '/api/production-shifts/C', { nameEn: 'Night', start: '23:00', end: '07:00', breakMin: 40 });
    assert.equal((await s.call('PUT', '/api/production-shifts/A', { nameEn: 'Day', start: '07:00', end: '15:00' })).body.error.code, 'shift.changed');
    assert.equal((await s.call('PUT', '/api/production-shifts/X', { nameEn: 'X', start: '07:00', end: '07:30', breakMin: 40 })).body.error.code, 'shift.break');
    await s.ok('PUT', '/api/production-calendar/2026-10-06', { kind: 'holiday', note: 'Armed Forces Day' });
    const cal = await s.ok('GET', '/api/production-calendar');
    assert.deepEqual(cal.shifts.map((x: any) => x.code), ['A', 'C']);
    assert.deepEqual(cal.restWeekdays, [5]);
    assert.equal(cal.exceptions[0].kind, 'holiday');
    assert.equal(await s.app.ctx.services.get('eng').isWorkingDay('2026-10-06'), false);
    assert.equal(await s.app.ctx.services.get('eng').isWorkingDay('2026-10-02'), false, 'Friday');
    assert.equal(await s.app.ctx.services.get('eng').isWorkingDay('2026-10-03'), true);
  });
});

describe('serial units along their routing (EXE2020 serial mode, EXE3020, WIP3010, TRC3010/3020)', () => {
  let s: Awaited<ReturnType<typeof tvPlant>>;
  let pbaWo: string, tvWo: string;
  const scan = (station: string, serial: string, extra: Record<string, unknown> = {}) => s.call('POST', '/api/units/scan', { commandId: cmd(), station, serial, ...extra });
  before(async () => {
    s = await tvPlant();
    pbaWo = (await s.ok('POST', '/api/work-orders', { commandId: cmd(), itemId: s.ids.pba, warehouseId: s.wh, plannedQty: '2', line: 'SMD-01' })).id;
    tvWo = (await s.ok('POST', '/api/work-orders', { commandId: cmd(), itemId: s.ids.tv, warehouseId: s.wh, plannedQty: '2', line: 'MA-01' })).id;
  });
  after(() => s.close());

  test('a work order carries the approved routing and BOM; a routed serial order is booked only by scanning', async () => {
    const wo = await s.app.ctx.services.get('exe').workOrder(tvWo);
    assert.equal(wo.routing_id, s.tvRoute);
    assert.equal(wo.bom_id, s.bomId);
    const direct = await s.call('POST', `/api/work-orders/${tvWo}/complete`, { commandId: cmd(), qty: '1', lotNo: 'TV-X1' });
    assert.equal(direct.body.error.code, 'wo.unit_tracked');
  });

  test('the main board is made on the SMD line: created at the first operation, completed at the last', async () => {
    assert.equal((await scan('SMD-01-AOI', 'PBA-0001')).body.error.code, 'unit.not_first_op');
    const a = await scan('SMD-01-LD', 'PBA-0001');
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body.created, true);
    assert.equal(a.body.next.code, 'AOI');
    const b = await scan('SMD-01-AOI', 'pba-0001');   // serials are upper-cased
    assert.equal(b.body.result, 'complete');
    const wo = await s.app.ctx.services.get('exe').workOrder(pbaWo);
    assert.equal(wo.completed_qty, 1000);
    assert.equal((await scan('SMD-01-AOI', 'PBA-0001')).body.error.code, 'unit.finished');
    assert.equal((await scan('SMD-01-LD', 'PBA-0002')).status, 200);
    assert.equal((await scan('SMD-01-LD', 'PBA-0003')).body.error.code, 'wo.all_units_started', 'never more units than planned');
  });

  test('the route is enforced, key parts are fitted, a failed test goes to repair and comes back to the same test', async () => {
    assert.equal((await scan('MA-01-PL', 'TV-0001')).body.error.code, 'part.required', 'the panel serial must be scanned');
    const pl = await scan('MA-01-PL', 'TV-0001', { parts: [{ serial: 'PNL-A1', itemId: s.ids.panel }] });
    assert.equal(pl.status, 200, JSON.stringify(pl.body));
    assert.equal((await scan('MA-01-PL', 'TV-0001', { parts: [{ serial: 'PNL-A9', itemId: s.ids.panel }] })).body.error.code, 'unit.already_passed');
    assert.equal((await scan('MA-01-FT', 'TV-0001')).body.error.code, 'unit.wrong_step');
    assert.equal((await scan('MA-01-MB', 'TV-0001', { parts: [{ serial: 'PBA-0002' }] })).body.error.code, 'part.not_available', 'a main board still in production cannot be fitted');
    const mb = await scan('MA-01-MB', 'TV-0001', { parts: [{ serial: 'PBA-0001' }] });
    assert.equal(mb.status, 200, JSON.stringify(mb.body));
    assert.equal((await s.app.ctx.services.get('trk').unit('PBA-0001'))!.status, 'consumed');
    assert.equal((await scan('MA-01-FT', 'TV-0001', { result: 'fail' })).body.error.code, 'defect.required');
    const ft = await scan('MA-01-FT', 'TV-0001', { result: 'fail', defectCode: 'NO-PICTURE' });
    assert.equal(ft.body.result, 'fail');
    assert.equal((await scan('MA-01-PK', 'TV-0001')).body.error.code, 'unit.in_repair');
    assert.equal((await s.call('POST', '/api/units/TV-0001/repair', { commandId: cmd(), cause: 'cable', action: 'reseated LVDS cable' })).status, 200);
    assert.equal((await scan('MA-01-PK', 'TV-0001')).body.error.code, 'unit.wrong_step', 'after repair the test is repeated, never skipped');
    assert.equal((await scan('MA-01-FT', 'TV-0001')).status, 200);
    assert.equal((await scan('MA-01-PK', 'TV-0001')).body.error.code, 'material.not_loaded');
  });

  test('material lots are loaded on stations; the last unit books the order\'s material before its final completion', async () => {
    const ld = await s.call('POST', '/api/stations/MA-01-PK/loads', { commandId: cmd(), itemId: s.ids.carton, lotNo: 'CTN-2609', warehouseId: s.wh });
    assert.equal(ld.status, 200, JSON.stringify(ld.body));
    assert.equal(ld.body.verified, false, 'a lot nobody registered is accepted but marked not verified');
    assert.equal((await s.call('POST', '/api/stations/MA-01-PK/loads', { commandId: cmd(), itemId: s.ids.carton, lotNo: 'CTN-2610', warehouseId: s.wh })).body.error.code, 'material.already_loaded');
    const pk = await scan('MA-01-PK', 'TV-0001');
    assert.equal(pk.body.result, 'complete');
    let wo = await s.app.ctx.services.get('exe').workOrder(tvWo);
    assert.equal(wo.completed_qty, 1000);
    // the second TV is scrapped at function test: its order is then finished, and its material is booked first
    await scan('MA-01-PL', 'TV-0002', { parts: [{ serial: 'PNL-A2', itemId: s.ids.panel }] });
    assert.equal((await scan('MA-01-PL', 'TV-0003', { parts: [{ serial: 'PNL-A3', itemId: s.ids.panel }] })).body.error.code, 'wo.all_units_started');
    assert.equal((await s.call('POST', '/api/units/TV-0002/scrap', { commandId: cmd(), reasonCode: 'panel' })).status, 200);
    wo = await s.app.ctx.services.get('exe').workOrder(tvWo);
    assert.equal(wo.status, 'completed');
    const ledger = (await s.ok('GET', `/api/work-orders/${tvWo}`)).ledger.map((l: any) => [l.txn_type, l.qty, l.lot_no]);
    const lastConsume = ledger.map((l: any) => l[0]).lastIndexOf('CONSUME');
    const finalFact = ledger.map((l: any) => l[0]).lastIndexOf('SCRAP');
    assert.ok(lastConsume >= 0 && lastConsume < finalFact, JSON.stringify(ledger));
    assert.deepEqual(ledger.filter((l: any) => l[0] === 'CONSUME').map((l: any) => [l[1], l[2]]).sort(), [['1', 'CTN-2609'], ['4', null]], 'one carton, four screws (one TV finished)');
    assert.deepEqual(ledger.find((l: any) => l[0] === 'COMPLETE').slice(1), ['1', 'TV-0001']);
  });

  test('the unit history, the WIP and traceability both ways', async () => {
    const h = await s.ok('GET', '/api/units/TV-0001');
    assert.equal(h.unit.status, 'completed');
    assert.deepEqual(h.route.map((o: any) => [o.code, o.state, o.tries]), [['PL', 'done', 1], ['MB', 'done', 1], ['FT', 'done', 2], ['PK', 'done', 1]]);
    assert.deepEqual(h.events.map((e: any) => e.kind), ['CREATE', 'ATTACH', 'PASS', 'ATTACH', 'PASS', 'FAIL', 'REPAIR', 'PASS', 'PASS', 'COMPLETE']);
    const back = await s.ok('GET', '/api/trace/backward/TV-0001');
    const kinds = back.parts.map((p: any) => [p.kind, p.item.code, p.serial ?? p.lot]);
    assert.deepEqual(kinds, [['part', 'PNL-55', 'PNL-A1'], ['unit', 'PBA-55', 'PBA-0001'], ['lot', 'CARTON', 'CTN-2609']]);
    assert.equal(back.parts[1].work_order.line, 'SMD-01');
    const fwd = await s.ok('GET', '/api/trace/forward?serial=PBA-0001');
    assert.deepEqual(fwd.units.map((u: any) => [u.serial, u.top]), [['TV-0001', true]]);
    const byLot = await s.ok('GET', '/api/trace/forward?item=CARTON&lot=CTN-2609');
    assert.equal(byLot.topLevel, 1);
    const wip = await s.ok('GET', '/api/wip');
    const pba = wip.find((w: any) => w.item.code === 'PBA-55');
    assert.equal(pba.at.AOI.queued, 1, 'PBA-0002 waits at optical inspection');
  });

  test('a unit on quality hold moves nowhere until every hold on it is released', async () => {
    const trk = s.app.ctx.services.get('trk');
    const u = (await trk.unit('PBA-0002'))!;
    const caller = { name: 'qa', scopes: new Set(['*']) };
    await s.app.ctx.db.tx((t) => trk.hold(t, caller, [u.id], { commandId: cmd(), holdId: 'H1', reason: 'suspect solder' }));
    await s.app.ctx.db.tx((t) => trk.hold(t, caller, [u.id], { commandId: cmd(), holdId: 'H2', reason: 'second hold' }));
    assert.equal((await scan('SMD-01-AOI', 'PBA-0002')).body.error.code, 'unit.held');
    await s.app.ctx.db.tx((t) => trk.release(t, caller, [u.id], { commandId: cmd(), holdId: 'H1' }));
    assert.equal((await scan('SMD-01-AOI', 'PBA-0002')).body.error.code, 'unit.held', 'one hold is still on it');
    await s.app.ctx.db.tx((t) => trk.release(t, caller, [u.id], { commandId: cmd(), holdId: 'H2' }));
    assert.equal((await trk.unit('PBA-0002'))!.held, 0);
  });

  test('a scan is a command: the same command id is applied once; the unit history is tamper-evident', async () => {
    const id = cmd();
    const first = await s.call('POST', '/api/units/scan', { commandId: id, station: 'SMD-01-AOI', serial: 'PBA-0002' });
    const again = await s.call('POST', '/api/units/scan', { commandId: id, station: 'SMD-01-AOI', serial: 'PBA-0002' });
    assert.equal(first.status, 200);
    assert.equal(again.body.replayed, true);
    const health = await s.ok('GET', '/api/system/health');
    assert.ok(health.trk.every((c: any) => c.ok), JSON.stringify(health.trk));
    assert.ok(health.eng.every((c: any) => c.ok));
    await assert.rejects(() => s.app.ctx.db.run(`UPDATE trk_event SET station = 'X' WHERE seq = 1`), /append-only/);
    await s.app.ctx.db.exec(`DROP TRIGGER trk_event_immutable`);
    await s.app.ctx.db.run(`UPDATE trk_event SET station = 'SMD-01-XX' WHERE seq = 3`);
    const v = await s.ok('GET', '/api/trk/verify');
    assert.equal(v.ok, false);
    assert.equal(v.firstBadSeq, 3, 'the first changed fact is named');
  });
});
