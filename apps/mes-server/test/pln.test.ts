import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mizanId } from '@eco/contracts';
import { COMPANY, item, server, snapshot, warehouse } from './helpers.js';

/** Planning wired into the app (WP-G2): mirrors in, a run, requisitions and planned orders out, release to a work order. */

const planning = (procurement: 'buy' | 'make', lead = 0) => ({ material_type: procurement === 'make' ? 'finished' : 'raw', procurement, lead_time_days: lead, moq: '0', lot_rule: 'lot_for_lot', lot_size: '0', safety_stock: '0' });
const ref = (kind: 'party' | 'item', n: number, code: string) => ({ id: mizanId(COMPANY, kind, n), code });
const so = (n: number, itemN: number, itemCode: string, qty: string, date: string, status = 'open', version = 1) => ({
  id: mizanId(COMPANY, 'sales_order', n), code: `SO-${n}`, version, origin: { app: 'mizan', type: 'sales_order', key: String(n) }, customer: ref('party', 1, 'C-1'),
  order_date: '2026-09-20', status, priority: 2, lines: [{ line_no: 1, item: ref('item', itemN, itemCode), qty, uom: 'PCS', requested_date: date, delivered_qty: '0' }],
});

test('a run turns an open sales order into a requisition, is stable on a re-run, cancels when demand goes, and releases a planned order', async () => {
  const s = await server('mizan');
  const inbox = async (...events: unknown[]) => {
    const r = await s.call('POST', '/eco/v1/inbox', { events }, s.keys.link);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    for (const x of r.body.results) assert.notEqual(x.result, 'rejected', JSON.stringify(x));
  };
  await inbox(
    snapshot('eco.warehouse.v1', warehouse(1, 'MAIN')),
    snapshot('eco.item.v1', item(1, 'PANEL', { planning: planning('buy', 3) })),
    snapshot('eco.item.v1', item(2, 'TV', { planning: planning('make') })),
    snapshot('acc.sales_order.v1', so(1, 1, 'PANEL', '10', '2026-10-12')),
    snapshot('acc.sales_order.v1', so(2, 2, 'TV', '5', '2026-10-14')),
  );

  const run1 = await s.call('POST', '/api/pln/runs');
  assert.equal(run1.status, 200, JSON.stringify(run1.body));
  const reqs = (await s.call('GET', '/api/pln/requisitions')).body;
  assert.equal(reqs.length, 1);
  assert.deepEqual([reqs[0].item.code, reqs[0].qty, reqs[0].need_date, reqs[0].order_by_date, reqs[0].status, reqs[0].version], ['PANEL', '10', '2026-10-12', '2026-10-09', 'open', 1]);
  const feed = async () => (await s.call('GET', '/eco/v1/feed?after=0&limit=500', undefined, s.keys.link)).body.events as { type: string; data: any }[];
  assert.equal((await feed()).filter((e) => e.type === 'mes.purchase_requisition.v1').length, 1);

  await s.call('POST', '/api/pln/runs');
  assert.equal((await feed()).filter((e) => e.type === 'mes.purchase_requisition.v1').length, 1, 'nothing changed: nothing published');

  await inbox(snapshot('acc.sales_order.v1', so(1, 1, 'PANEL', '10', '2026-10-12', 'cancelled', 2)));
  await s.call('POST', '/api/pln/runs');
  const after = (await s.call('GET', '/api/pln/requisitions')).body;
  assert.deepEqual([after[0].status, after[0].version], ['cancelled', 2]);
  assert.equal((await feed()).filter((e) => e.type === 'mes.purchase_requisition.v1').at(-1)!.data.status, 'cancelled');

  const planned = (await s.call('GET', '/api/pln/planned-orders?status=planned')).body;
  assert.equal(planned.length, 1);
  assert.deepEqual([planned[0].item.code, planned[0].qty, planned[0].due_date], ['TV', '5', '2026-10-14']);
  assert.equal((await s.call('POST', `/api/pln/planned-orders/${planned[0].id}/firm`)).status, 200);
  const rel = await s.call('POST', `/api/pln/planned-orders/${planned[0].id}/release`, { commandId: 'release-tv-0001' });
  assert.equal(rel.status, 200, JSON.stringify(rel.body));
  const wo = (await s.call('GET', `/api/work-orders/${rel.body.workOrder.id}`)).body;
  assert.deepEqual([wo.planned_qty, wo.due_date, wo.planned_order_id], ['5', '2026-10-14', planned[0].id]);

  // the released order is now supply: a new run plans nothing more for the TV
  await s.call('POST', '/api/pln/runs');
  assert.equal((await s.call('GET', '/api/pln/planned-orders?status=planned')).body.length, 0);

  // cancelling a released order that produced nothing frees the demand again
  const cancel = await s.call('POST', `/api/work-orders/${rel.body.workOrder.id}/cancel`, { commandId: 'cancel-tv-0001', reason: 'customer moved the date' });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
  assert.equal((await s.call('GET', `/api/work-orders/${rel.body.workOrder.id}`)).body.status, 'closed');
  await s.call('POST', '/api/pln/runs');
  assert.equal((await s.call('GET', '/api/pln/planned-orders?status=planned')).body.length, 1, 'the closed order is no longer supply');
  await s.close();
});
