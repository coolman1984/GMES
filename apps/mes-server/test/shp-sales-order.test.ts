import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mizanId } from '@eco/contracts';
import { COMPANY, item, server, snapshot, warehouse } from './helpers.js';

/** A shipping order made from a mirrored sales order never ships more than the order line still has open (WP-G5). */
test('shipping from a sales order: the open quantity is the limit, across shipping orders', async () => {
  const s = await server('mizan');
  const so = {
    id: mizanId(COMPANY, 'sales_order', 1), code: 'SO-1', version: 1, origin: { app: 'mizan', type: 'sales_order', key: '1' },
    customer: { id: mizanId(COMPANY, 'party', 1), code: 'C-1' }, order_date: '2026-09-20', status: 'open', priority: 2,
    lines: [{ line_no: 1, item: { id: mizanId(COMPANY, 'item', 2), code: 'TV' }, qty: '10', uom: 'PCS', requested_date: '2026-10-14', delivered_qty: '3' }],
  };
  const r = await s.call('POST', '/eco/v1/inbox', { events: [snapshot('eco.warehouse.v1', warehouse(1, 'MAIN')), snapshot('eco.item.v1', item(2, 'TV')), snapshot('acc.sales_order.v1', so)] }, s.keys.link);
  assert.ok(r.body.results.every((x: any) => x.result === 'applied'), JSON.stringify(r.body));

  const make = (qty: number) => s.call('POST', '/api/shipping-orders/from-sales-order', { salesOrderId: 'SO-1', shipDate: '2026-10-14', containerType: '40HC', lines: [{ lineNo: 1, qty }] });
  assert.equal((await make(8)).body.error.code, 'shp.over_order', '10 ordered - 3 delivered = 7 open');
  const ok = await make(5);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const again = await make(3);
  assert.equal(again.body.error.code, 'shp.over_order', '5 already on another open shipping order: 2 left');
  assert.equal((await make(2)).status, 200);
  const view = (await s.call('GET', `/api/shipping-orders/${ok.body.id}`)).body;
  assert.equal(view.customer, 'C-1');

  // saving the order again keeps its link to the sales order (an edit used to erase it, and dispatch then had nothing to book against)
  const links = async () => (await s.call('GET', `/api/shipping-orders/${ok.body.id}`)).body.lines.map((l: any) => [l.so_code, l.so_line_no]);
  assert.deepEqual(await links(), [['SO-1', 1]]);
  const put = (qty: number, extra: Record<string, unknown> = {}) => s.call('PUT', `/api/shipping-orders/${ok.body.id}`, { version: view.version, customer: 'C-1', shipDate: '2026-10-14', containerType: '40HC', lines: [{ itemId: view.lines[0].item_id, qty }], ...extra });
  const saved = await put(5);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(await links(), [['SO-1', 1]], 'the sales-order link survives a save');
  const more = await s.call('PUT', `/api/shipping-orders/${ok.body.id}`, { version: saved.body.version, customer: 'C-1', shipDate: '2026-10-14', containerType: '40HC', lines: [{ itemId: view.lines[0].item_id, qty: 6 }] });
  assert.equal(more.body.error.code, 'shp.over_order', '10 - 3 delivered - 2 on the other open order = 5 for this one');
  await s.close();
});
