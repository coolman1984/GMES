import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { server, type TestServer } from './helpers.js';

let n = 0;
const cmd = () => `test-cmd-${++n}-${Date.now()}`;

/** A standalone plant (manufacturing owns items): P1 > ASM > ASM-01 > ST10, an item and a warehouse. */
async function plant(): Promise<TestServer & { itemId: string; whId: string; lineId: string }> {
  const s = await server('gmes');
  const node = async (code: string, type: string, parentId: string | null, extra = {}) => {
    const r = await s.call('POST', '/api/plant', { code, type, parentId, nameEn: code, ...extra });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.id as string;
  };
  const p = await node('P1', 'plant', null);
  const a = await node('ASM', 'area', p);
  const lineId = await node('ASM-01', 'line', a, { capacityPerShift: 800 });
  await node('ASM-01-ST10', 'station', lineId);
  const itemId = (await s.call('POST', '/api/items', { code: 'FG-1', nameEn: 'Box', nameAr: 'صندوق' })).body.id;
  const whId = (await s.call('POST', '/api/warehouses', { code: 'MAIN', nameEn: 'Main', nameAr: 'الرئيسي' })).body.id;
  return { ...s, itemId, whId, lineId };
}

describe('the plant model (MDM1010): manufacturing owns it', () => {
  let s: Awaited<ReturnType<typeof plant>>;
  before(async () => { s = await plant(); });
  after(() => s.close());

  test('each level hangs under the level above it, codes are unique and upper-case', async () => {
    const plantId = (await s.call('GET', '/api/plant')).body.find((x: any) => x.code === 'P1').id;
    assert.equal((await s.call('POST', '/api/plant', { code: 'X-1', type: 'line', parentId: plantId, nameEn: 'X' })).body.error.code, 'plant.parent');
    assert.equal((await s.call('POST', '/api/plant', { code: 'asm', type: 'area', parentId: plantId, nameEn: 'dup' })).body.error.code, 'plant.code_taken');
    assert.equal((await s.call('POST', '/api/plant', { code: 'P2', type: 'plant', nameEn: 'Two' })).status, 200);
  });

  test('a node with active children cannot be deactivated; an edit on an old version is refused', async () => {
    const list = (await s.call('GET', '/api/plant')).body;
    const line = list.find((x: any) => x.code === 'ASM-01');
    assert.equal((await s.call('PATCH', `/api/plant/${line.id}`, { active: false, version: line.version })).body.error.code, 'plant.has_active_children');
    assert.equal((await s.call('PATCH', `/api/plant/${line.id}`, { nameAr: 'خط التجميع 1', version: line.version })).status, 200);
    assert.equal((await s.call('PATCH', `/api/plant/${line.id}`, { nameAr: 'قديم', version: line.version })).body.error.code, 'plant.changed');
  });
});

describe('work orders on lines, stoppages and the boards (EXE3010, EXE2020, DSH5010)', () => {
  let s: Awaited<ReturnType<typeof plant>>;
  before(async () => { s = await plant(); });
  after(() => s.close());

  test('a work order runs on a real, active line; the list shows what the ledger says', async () => {
    const bad = await s.call('POST', '/api/work-orders', { commandId: cmd(), itemId: s.itemId, warehouseId: s.whId, plannedQty: '10', line: 'NOPE' });
    assert.equal(bad.body.error.code, 'line.unknown');
    const wo = (await s.call('POST', '/api/work-orders', { commandId: cmd(), itemId: s.itemId, warehouseId: s.whId, plannedQty: '10', line: 'ASM-01', shift: 'A', priority: 1 })).body;
    assert.equal((await s.call('POST', `/api/work-orders/${wo.id}/complete`, { commandId: cmd(), qty: '4' })).status, 200);
    assert.equal((await s.call('POST', `/api/work-orders/${wo.id}/scrap`, { commandId: cmd(), qty: '1', reasonCode: 'surface' })).status, 200);
    const rows = (await s.call('GET', '/api/work-orders?line=ASM-01')).body;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].code, wo.code);
    assert.equal(rows[0].line_code, 'ASM-01');
    assert.equal(rows[0].shift_code, 'A');
    assert.equal(rows[0].priority, 1);
    assert.deepEqual([rows[0].completed_qty, rows[0].scrapped_qty, rows[0].open_qty], ['4', '1', '5']);
    assert.equal(rows[0].item.code, 'FG-1');
    assert.ok(rows[0].first_at);
    assert.equal((await s.call('GET', '/api/work-orders?item=box')).body.length, 1, 'the item filter searches names too');
    assert.equal((await s.call('GET', '/api/work-orders?status=closed')).body.length, 0);
  });

  test('one open stoppage per line or station; stopping and resuming are kept as facts', async () => {
    const stop = await s.call('POST', '/api/stoppages', { commandId: cmd(), line: 'ASM-01', reason: 'material' });
    assert.equal(stop.status, 200);
    const again = await s.call('POST', '/api/stoppages', { commandId: cmd(), line: 'ASM-01', reason: 'breakdown' });
    assert.equal(again.body.error.code, 'stop.already_open');
    assert.equal((await s.call('POST', '/api/stoppages', { commandId: cmd(), line: 'ASM-01', station: 'ASM-01-ST10', reason: 'quality' })).status, 200, 'a station stops on its own');
    assert.equal((await s.call('POST', '/api/stoppages', { commandId: cmd(), line: 'ASM-01', station: 'OTHER', reason: 'quality' })).body.error.code, 'station.unknown');
    assert.equal((await s.call('POST', '/api/stoppages', { commandId: cmd(), line: 'ASM-01', reason: 'coffee' })).status, 400);
    s.clock.set('2026-09-27T08:12:00.000Z');
    assert.equal((await s.call('POST', `/api/stoppages/${stop.body.id}/end`, { commandId: cmd() })).status, 200);
    assert.equal((await s.call('POST', `/api/stoppages/${stop.body.id}/end`, { commandId: cmd() })).body.error.code, 'stop.already_ended');
    const list = (await s.call('GET', '/api/stoppages?line=ASM-01&date=2026-09-27')).body;
    const ended = list.find((x: any) => x.id === stop.body.id);
    assert.equal(ended.minutes, 12);
    assert.equal(ended.reason, 'material');
    await assert.rejects(s.app.ctx.db.run(`UPDATE oee_event SET reason_code = 'other'`), /append-only/);
  });

  test('the boards count only what the ledger holds; no plan is invented without a capacity', async () => {
    const board = (await s.call('GET', '/api/boards/line/ASM-01?date=2026-09-27')).body;
    assert.equal(board.good, 4);
    assert.equal(board.scrap, 1);
    assert.equal(board.planned, 10);
    assert.equal(board.planPerHour, 100, '800 per 8-hour shift');
    assert.equal(board.hours.length, 24);
    assert.equal(board.hours[0].hour, 7, 'the day starts at the production-day start');
    // 08:00Z is 11:00 in Cairo (UTC+3 on 2026-09-27)
    assert.equal(board.hours.find((h: any) => h.hour === 11).good, 4);
    assert.equal(board.state, 'down', 'the station stoppage is still open');
    assert.equal(board.workOrder.completed, 4);
    const home = (await s.call('GET', '/api/boards/plant?date=2026-09-27')).body;
    assert.equal(home.good, 4);
    assert.equal(home.openOrders, 1);
    assert.equal(home.lines.length, 1);
    assert.equal(home.lines[0].state, 'down');
    assert.equal(home.stoppages.open, 1);
    assert.ok(!('oee' in board), 'OEE is not given until cycle times exist');
  });

  test('reading needs a session or a key, like every API', async () => {
    const r = await s.call('GET', '/api/boards/plant', undefined, null as unknown as string);
    assert.equal(r.status, 401);
  });
});
