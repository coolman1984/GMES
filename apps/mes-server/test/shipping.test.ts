import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { validateEvent } from '@eco/contracts';
import { containerCheck } from '../src/modules/shp/index.js';
import { tvPlant } from './plants.js';

let n = 0;
const cmd = () => `shp-cmd-${++n}-${Date.now()}`;

test('container numbers carry an ISO 6346 check digit', () => {
  assert.equal(containerCheck('CSQU3054383'), true);
  assert.equal(containerCheck('CSQU3054384'), false, 'a wrong check digit');
  assert.equal(containerCheck('CSQX3054383'), false, 'the category letter is U, J or Z');
  assert.equal(containerCheck('MSCU1234567'), false);
});

describe('palletizing, shipping orders, container loading and dispatch (SHP1010-SHP3010)', () => {
  let s: Awaited<ReturnType<typeof tvPlant>>;
  let orderId: string;
  const scan = (station: string, serial: string, extra: Record<string, unknown> = {}) => s.call('POST', '/api/units/scan', { commandId: cmd(), station, serial, ...extra });
  const pack = (serial: string) => s.call('POST', '/api/pallets/pack', { commandId: cmd(), serial });
  async function build(tvs: string[]) {
    for (const tv of tvs) {
      const pba = 'PBA-' + tv;
      for (const [st, sr, extra] of [['SMD-01-LD', pba, {}], ['SMD-01-AOI', pba, {}], ['MA-01-PL', tv, { parts: [{ serial: 'PNL-' + tv, itemId: s.ids.panel }] }],
        ['MA-01-MB', tv, { parts: [{ serial: pba }] }], ['MA-01-FT', tv, {}], ['MA-01-PK', tv, {}]] as const) {
        const r = await scan(st, sr, extra as Record<string, unknown>);
        assert.equal(r.status, 200, `${st} ${sr}: ${JSON.stringify(r.body)}`);
      }
    }
  }
  before(async () => {
    s = await tvPlant();
    await s.ok('POST', '/api/work-orders', { commandId: cmd(), itemId: s.ids.pba, warehouseId: s.wh, plannedQty: '20', line: 'SMD-01' });
    await s.ok('POST', '/api/work-orders', { commandId: cmd(), itemId: s.ids.tv, warehouseId: s.wh, plannedQty: '20', line: 'MA-01' });
    await s.ok('POST', '/api/stations/MA-01-PK/loads', { commandId: cmd(), itemId: s.ids.carton, lotNo: 'CTN-S1', warehouseId: s.wh });
    await build(['TVS-001', 'TVS-002', 'TVS-003', 'TVS-004', 'TVS-005', 'TVS-006', 'TVS-007', 'TVS-008', 'TVS-009', 'TVS-010']);
  });
  after(() => s.close());

  test('a finished unit goes onto the open pallet of its product; a full pallet closes by itself', async () => {
    assert.equal((await pack('TVS-001')).body.error.code, 'pack.no_spec');
    await s.ok('PUT', `/api/pack-specs/${s.ids.tv}`, { perPallet: 4, perContainer: { '40HC': 2, '20GP': 1 } });
    const first = await pack('TVS-001');
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.opened, true);
    assert.equal((await pack('TVS-001')).body.error.code, 'unit.already_packed');
    for (const t of ['TVS-002', 'TVS-003']) assert.equal((await pack(t)).status, 200);
    const full = await pack('TVS-004');
    assert.equal(full.body.closed, true);
    assert.equal(full.body.units, 4);
    const next = await pack('TVS-005');
    assert.equal(next.body.opened, true);
    assert.notEqual(next.body.pallet, full.body.pallet);
    assert.equal((await pack('PBA-TVS-001')).body.error.code, 'unit.fitted', 'a main board inside a TV is not packed on its own');
    for (const t of ['TVS-006', 'TVS-007', 'TVS-008']) assert.equal((await pack(t)).status, 200);
    assert.equal((await s.app.ctx.services.get('trk').unit('TVS-001'))!.status, 'packed');
    const where = await s.ok('GET', '/api/units/TVS-002');
    assert.equal(where.unit.where.pallet, full.body.pallet);
  });

  test('a shipping order is loaded pallet by pallet: only closed, inspected, not held, ordered, and while the container has room', async () => {
    const o = await s.ok('POST', '/api/shipping-orders', { customer: 'Nile Retail (demo)', destination: 'Alexandria port', shipDate: '2026-09-30', containerType: '40HC', lines: [{ itemId: s.ids.tv, qty: 6 }] });
    orderId = o.id;
    assert.equal((await s.call('POST', `/api/shipping-orders/${o.id}/containers`, { commandId: cmd(), number: 'CSQU3054384' })).body.error.code, 'container.number');
    const c1 = await s.ok('POST', `/api/shipping-orders/${o.id}/containers`, { commandId: cmd(), number: 'CSQU3054383', truck: 'ق ر ص 123', driver: 'Driver A' });
    const pallets = (await s.ok('GET', '/api/pallets?item=TV-55')).sort((a: any, b: any) => a.code.localeCompare(b.code)).map((p: any) => p.code);
    const load = (c: string, p: string) => s.call('POST', `/api/containers/${c}/load`, { commandId: cmd(), pallet: p });
    // the plant inspects outgoing lots: no pallet leaves without a passed OQC
    const oqc = await s.ok('POST', '/api/qms/plans', { code: 'OQC-TV', nameEn: 'Outgoing', stage: 'oqc', itemId: s.ids.tv, aql: '0.65' });
    assert.equal((await load(c1.id, pallets[0])).body.error.code, 'pallet.no_oqc');
    for (const p of pallets) await s.ok('POST', '/api/qms/inspections', { commandId: cmd(), planId: oqc.id, targetType: 'pallet', target: p });
    assert.equal((await load(c1.id, pallets[0])).status, 200);
    assert.equal((await load(c1.id, pallets[0])).body.error.code, 'pallet.not_available');
    // never more than ordered: 4 loaded + 4 on this pallet > 6
    const over = await load(c1.id, pallets[1]);
    assert.equal(over.body.error.code, 'order.over');
    assert.equal(over.body.error.open, 2);
    const ov = await s.ok('GET', `/api/shipping-orders/${o.id}`);
    assert.equal((await s.call('PUT', `/api/shipping-orders/${o.id}`, { version: ov.version, customer: ov.customer, shipDate: ov.ship_date, containerType: '40HC', lines: [{ itemId: s.ids.tv, qty: 3 }] })).body.error.code,
      'order.below_loaded', 'an order cannot ask for less than is already loaded');
    await s.ok('PUT', `/api/shipping-orders/${o.id}`, { version: ov.version, customer: ov.customer, destination: ov.destination, shipDate: ov.ship_date, containerType: '40HC', lines: [{ itemId: s.ids.tv, qty: 10 }] });
    // a unit held after its inspection keeps its pallet at the dock
    await s.ok('POST', '/api/qms/holds', { commandId: cmd(), targetType: 'unit', target: 'TVS-006', reason: 'late complaint' });
    assert.equal((await load(c1.id, pallets[1])).body.error.code, 'pallet.held');
    const hold = (await s.ok('GET', '/api/qms/holds?status=open'))[0];
    // released only when a person signs
    await s.ok('POST', '/api/users', { login: 'qa.salma', name: 'Salma', role: 'QUALITY', password: 'Quality-pass-3' });
    const { signIn } = await import('./helpers.js');
    const qa = await signIn(s, 'qa.salma', 'Quality-pass-3');
    assert.equal((await qa('POST', `/api/qms/holds/${hold.id}/release`, { commandId: cmd(), disposition: 'release', decision: 'checked, fine', password: 'Quality-pass-3' })).status, 200);
    assert.equal((await load(c1.id, pallets[1])).status, 200);
    // a 40HC holds 2 pallets of this TV
    await s.ok('POST', `/api/pallets/${(await pack('TVS-009')).body.pallet}/close`, { commandId: cmd() });
    const third = (await s.ok('GET', '/api/pallets?status=closed&item=TV-55'))[0].code;
    await s.ok('POST', '/api/qms/inspections', { commandId: cmd(), planId: oqc.id, targetType: 'pallet', target: third });
    assert.equal((await load(c1.id, third)).body.error.code, 'container.full');
    const c2 = await s.ok('POST', `/api/shipping-orders/${o.id}/containers`, { commandId: cmd(), number: 'TRUCK-77', type: 'TRUCK' });
    assert.equal((await load(c2.id, third)).status, 200, 'a truck has no pallet limit in this plant');
    await pack('TVS-010');
    const fourth = (await s.ok('GET', '/api/pallets?status=open&item=TV-55'))[0].code;
    assert.equal((await load(c2.id, fourth)).body.error.code, 'pallet.open', 'an open pallet stays at the packing line');
    await s.ok('POST', `/api/pallets/${fourth}/close`, { commandId: cmd() });
    await s.ok('POST', '/api/qms/inspections', { commandId: cmd(), planId: oqc.id, targetType: 'pallet', target: fourth });
    assert.equal((await load(c2.id, fourth)).status, 200);
    const view = await s.ok('GET', `/api/shipping-orders/${o.id}`);
    assert.deepEqual(view.lines.map((l: any) => [l.qty, l.loaded, l.shipped]), [[10, 10, 0]]);
  });

  test('sealing a container dispatches it: its units are shipped and accounting receives the dispatch fact', async () => {
    const view = await s.ok('GET', `/api/shipping-orders/${orderId}`);
    const [c1, c2] = view.containers;
    assert.equal((await s.call('POST', `/api/containers/${c1.id}/dispatch`, { commandId: cmd() })).status, 400, 'the seal is required');
    const d1 = await s.ok('POST', `/api/containers/${c1.id}/dispatch`, { commandId: cmd(), seal: 'EG-SEAL-001' });
    assert.equal(d1.units, 8);
    assert.equal(d1.orderShipped, false);
    assert.equal((await s.app.ctx.services.get('trk').unit('TVS-001'))!.status, 'shipped');
    assert.equal((await s.call('POST', `/api/containers/${c1.id}/load`, { commandId: cmd(), pallet: 'X' })).body.error.code, 'container.dispatched');
    const d2 = await s.ok('POST', `/api/containers/${c2.id}/dispatch`, { commandId: cmd(), seal: 'EG-SEAL-002' });
    assert.equal(d2.orderShipped, true);
    const feed = (await s.call('GET', '/eco/v1/feed?after=0&limit=500', undefined, s.keys.link)).body;
    const dispatched = feed.events.filter((e: any) => e.type === 'mes.shipment.dispatched.v1');
    assert.equal(dispatched.length, 2);
    for (const e of dispatched) assert.ok(validateEvent(e).ok, JSON.stringify(validateEvent(e)));
    assert.equal(dispatched[0].data.lines[0].qty, '8');
    assert.equal(dispatched[0].data.lines[0].serials.length, 8);
    // a hold on something already shipped is a recall list, not a hold
    const recall = await s.call('POST', '/api/qms/holds', { commandId: cmd(), targetType: 'material_lot', target: 'CTN-S1', reason: 'carton supplier alert' });
    assert.equal(recall.body.error.code, 'hold.nothing');
    assert.match(recall.body.error.message, /already been shipped/);
    const fwd = await s.ok('GET', '/api/trace/forward?item=CARTON&lot=CTN-S1');
    assert.equal(fwd.shipped, 10);
    assert.ok(fwd.units.every((u: any) => u.where && u.where.container));
    const health = await s.ok('GET', '/api/system/health');
    assert.ok(health.shp.every((c: any) => c.ok), JSON.stringify(health.shp));
    await assert.rejects(() => s.app.ctx.db.run(`DELETE FROM shp_event`), /append-only/);
  });
});
