import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mizanId } from '@eco/contracts';
import { COMPANY, item, server, snapshot, warehouse } from './helpers.js';

/**
 * Accounting's commercial truth is mirrored read-only for planning (plan 20-GMES WP-G1): parties, sales orders, approved
 * demand plans, stock balances, purchase orders, and an item's planning parameters.
 */
const uid = (type: 'party' | 'sales_order' | 'demand_plan' | 'stock_position' | 'purchase_order', n: number) => mizanId(COMPANY, type, n);
const o = (type: string, n: number) => ({ app: 'mizan', type, key: String(n) });
const ref = (kind: 'party' | 'item' | 'warehouse', n: number, code: string) => ({ id: mizanId(COMPANY, kind, n), code });

const party = (n: number, code: string, extra: Record<string, unknown> = {}) => ({
  id: uid('party', n), code, version: 1, origin: o('party', n), name: { en: code, ar: code }, roles: ['customer'], country: 'EG', active: true, ...extra,
});
const salesOrder = (n: number, extra: Record<string, unknown> = {}) => ({
  id: uid('sales_order', n), code: `SO-${String(n).padStart(5, '0')}`, version: 1, origin: o('sales_order', n), customer: ref('party', 1, 'C-BTECH'),
  order_date: '2026-08-17', status: 'open', priority: 2,
  lines: [
    { line_no: 1, item: ref('item', 5, 'NV-65U'), qty: '9000', uom: 'PCS', requested_date: '2026-09-10', promised_date: '2026-09-17', delivered_qty: '0' },
    { line_no: 2, item: ref('item', 6, 'NV-55Q'), qty: '6000.5', uom: 'PCS', requested_date: '2026-09-20', delivered_qty: '1000' },
  ], ...extra,
});

async function post(s: Awaited<ReturnType<typeof server>>, ...events: unknown[]) {
  const r = await s.call('POST', '/eco/v1/inbox', { events }, s.keys.link);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.results as { result: string; code?: string }[];
}

describe('accounting mirrors for planning', () => {
  test('a party, a sales order with its lines and a stock position are mirrored; lines are replaced by a newer version; older is stale', async () => {
    const s = await server('mizan');
    assert.deepEqual((await post(s, snapshot('eco.party.v1', party(1, 'C-BTECH')), snapshot('acc.sales_order.v1', salesOrder(11)))).map((r) => r.result), ['applied', 'applied']);
    const list = (await s.call('GET', '/api/sales-orders')).body;
    assert.equal(list.length, 1);
    assert.equal(list[0].lines, 2);
    assert.equal(list[0].open_qty, '14000.5', '9000 + (6000.5 - 1000)');
    assert.equal(list[0].next_due, '2026-09-17', 'the promised date wins over the requested one');
    const detail = (await s.call('GET', `/api/sales-orders/${list[0].id}`)).body;
    assert.equal(detail.lines[1].qty, '6000.5', 'no rounding: 6000.5 stays 6000.5');
    assert.equal(detail.lines[1].open_qty, '5000.5');

    const newer = salesOrder(11, { version: 2, lines: [{ line_no: 1, item: ref('item', 5, 'NV-65U'), qty: '9000', uom: 'PCS', requested_date: '2026-09-10', promised_date: '2026-09-17', delivered_qty: '9000' }] });
    assert.equal((await post(s, snapshot('acc.sales_order.v1', newer)))[0]!.result, 'applied');
    assert.equal((await s.call('GET', `/api/sales-orders/${list[0].id}`)).body.lines.length, 1, 'the snapshot is the full state: line 2 is gone');
    assert.equal((await post(s, snapshot('acc.sales_order.v1', salesOrder(11, { version: 1 }))))[0]!.result, 'stale');
    assert.equal((await post(s, snapshot('acc.sales_order.v1', newer)))[0]!.result, 'unchanged');
    await s.close();
  });

  test('an order naming an item or customer not received yet is KEPT as carried, not refused', async () => {
    const s = await server('mizan');
    assert.equal((await post(s, snapshot('acc.sales_order.v1', salesOrder(12))))[0]!.result, 'applied');
    const l = (await s.call('GET', '/api/sales-orders/SO-00012')).body.lines[0];
    assert.equal(l.item_code, 'NV-65U');
    assert.equal((await s.call('GET', '/api/customers')).body.length, 0, 'the customer is simply not mirrored yet');
    await s.close();
  });

  test('approved demand plans keep their history; stock and purchase orders carry exact quantities', async () => {
    const s = await server('mizan');
    const plan = (n: number, cycle: string, status: string, v = 1) => ({
      id: uid('demand_plan', n), code: `SOP-${cycle}`, version: v, origin: o('demand_plan', n), cycle, status, approved_at: '2026-09-25T09:00:00Z',
      lines: [{ item: ref('item', 5, 'NV-65U'), period: cycle, qty: '20000' }],
    });
    await post(s, snapshot('acc.demand_plan.v1', plan(1, '2026-09', 'approved')), snapshot('acc.demand_plan.v1', plan(2, '2026-10', 'approved')));
    await post(s, snapshot('acc.demand_plan.v1', plan(1, '2026-09', 'superseded', 2)));
    const plans = (await s.call('GET', '/api/demand-plans')).body;
    assert.deepEqual(plans.map((p: any) => `${p.cycle}:${p.status}`), ['2026-10:approved', '2026-09:superseded']);

    const stock = { id: uid('stock_position', 1), item: ref('item', 9, 'OC-55'), warehouse: ref('warehouse', 2, 'RM'), on_hand: '1200.25', reserved: '200', uom: 'PCS', as_of: '2026-09-29T00:00:00Z', version: 1, origin: o('stock_position', 1) };
    const po = { id: uid('purchase_order', 4), code: 'PO-00004', version: 1, origin: o('purchase_order', 4), supplier: ref('party', 3, 'S-CSOT'), order_date: '2026-08-20', status: 'open',
      lines: [{ line_no: 1, item: ref('item', 9, 'OC-55'), qty: '5000', received_qty: '480', uom: 'PCS', expected_date: '2026-10-30', warehouse: ref('warehouse', 2, 'RM'), requisition: ref('item', 99, 'PR-1') }] };
    await post(s, snapshot('acc.stock_position.v1', stock), snapshot('acc.purchase_order.v1', po));
    const st = (await s.call('GET', '/api/stock?item=OC-55')).body;
    assert.deepEqual([st[0].on_hand, st[0].reserved, st[0].available], ['1200.25', '200', '1000.25']);
    const open = (await s.call('GET', '/api/purchase-orders?open=1')).body;
    assert.equal(open[0].open_qty, '4520');
    assert.equal(open[0].requisition_code, 'PR-1');
    await post(s, snapshot('acc.purchase_order.v1', { ...po, version: 2, status: 'closed' }));
    assert.equal((await s.call('GET', '/api/purchase-orders?open=1')).body.length, 0, 'a closed order brings nothing more');
    await s.close();
  });

  test('item planning parameters arrive with the item, are replaced by a newer snapshot, and removed when it has none', async () => {
    const s = await server('mizan');
    const planning = { material_type: 'raw', procurement: 'buy', lead_time_days: 70, moq: '30', lot_rule: 'multiple', lot_size: '30', safety_stock: '600.5', expedite_lead_time_days: 14 };
    await post(s, snapshot('eco.item.v1', item(9, 'OC-55', { planning })));
    let row = (await s.call('GET', '/api/item-planning')).body.find((r: any) => r.item_code === 'OC-55');
    assert.deepEqual([row.lead_time_days, row.moq, row.safety_stock, row.expedite_lead_time_days, row.lot_rule], [70, '30', '600.5', 14, 'multiple']);
    await post(s, snapshot('eco.item.v1', item(9, 'OC-55', { version: 2, planning: { ...planning, lead_time_days: 60 } })));
    row = (await s.call('GET', '/api/item-planning')).body.find((r: any) => r.item_code === 'OC-55');
    assert.equal(row.lead_time_days, 60);
    await post(s, snapshot('eco.item.v1', item(9, 'OC-55', { version: 3 })));
    row = (await s.call('GET', '/api/item-planning')).body.find((r: any) => r.item_code === 'OC-55');
    assert.equal(row.lead_time_days, null, 'no planning block in the newest snapshot = no planning parameters');
    await s.close();
  });

  test('only Mizan may send them, and only where Mizan owns items; a fallback owner refuses them and edits planning itself', async () => {
    const s = await server('mizan');
    const forged = snapshot('acc.sales_order.v1', salesOrder(13, { origin: { app: 'hr', type: 'sales_order', key: '13' } }));
    assert.equal((await post(s, forged))[0]!.code, 'mdm.wrong_owner');
    assert.equal((await s.call('PUT', `/api/items/${mizanId(COMPANY, 'item', 9)}/planning`, { materialType: 'raw', procurement: 'buy', leadTimeDays: 5, lotRule: 'lot_for_lot' })).body.error.code, 'mdm.not_owner');
    await s.close();

    const own = await server('gmes');
    assert.equal((await post(own, snapshot('acc.sales_order.v1', salesOrder(14))))[0]!.code, 'mdm.not_mirror');
    const made = await own.call('POST', '/api/items', { code: 'OC-1', nameEn: 'Cell', nameAr: 'خلية' });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const set = await own.call('PUT', `/api/items/${made.body.id}/planning`, { materialType: 'raw', procurement: 'buy', leadTimeDays: 45, moq: '10', lotRule: 'fixed', lotSize: '10', safetyStock: '5' });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    const row = (await own.call('GET', '/api/item-planning')).body.find((r: any) => r.item_code === 'OC-1');
    assert.deepEqual([row.lead_time_days, row.lot_rule, row.lot_size], [45, 'fixed', '10']);
    assert.equal((await own.call('PUT', `/api/items/${made.body.id}/planning`, { materialType: 'raw', procurement: 'buy', leadTimeDays: 5, lotRule: 'lot_for_lot', defaultSupplierCode: 'NOPE' })).body.error.code, 'planning.unknown_supplier');
    await own.close();
  });

  test('warehouses and items still mirror as before (regression)', async () => {
    const s = await server('mizan');
    const r = await post(s, snapshot('eco.warehouse.v1', warehouse(2, 'RM')), snapshot('eco.item.v1', item(9, 'OC-55')));
    assert.deepEqual(r.map((x) => x.result), ['applied', 'applied']);
    await s.close();
  });
});
