import assert from 'node:assert/strict';
import { test } from 'node:test';
import { http } from '../src/modules/eco/peers.js';
import { item, server, snapshot, warehouse, stocked } from './helpers.js';

process.env.GMES_SECRETS = 'plain';

/** The pusher (WP-G7): the outbox goes to each peer's inbox, filtered by type; answers move the cursor or park. */
test('events are pushed to a peer by type; refusals are parked or skipped; a network failure keeps the cursor', async () => {
  const s = await server('mizan');
  await s.call('POST', '/eco/v1/inbox', { events: [snapshot('eco.warehouse.v1', warehouse(1, 'MAIN')), snapshot('eco.item.v1', item(1, 'PANEL'))] }, s.keys.link);
  // a fake peer: it records what it receives and answers what the test decides
  const got: { url: string; key: string; types: string[] }[] = [];
  let answer: (types: string[]) => { status: number; body: unknown } = (types) => ({ status: 200, body: { results: types.map((t) => (t === 'mes.supply_plan.v1' ? { result: 'rejected', code: 'eco.not_accepted' } : { result: 'applied' })) } });
  http.current = async (url, init) => {
    const events = (JSON.parse(init.body) as { events: { id: string; type: string }[] }).events;
    got.push({ url, key: init.headers['x-eco-key']!, types: events.map((e) => e.type) });
    const a = answer(events.map((e) => e.type));
    return { status: a.status, json: async () => {
      const body = a.body as { results?: Record<string, unknown>[] };
      return body?.results ? { ...body, results: body.results.map((r, i) => ({ id: events[i]!.id, ...r })) } : body;
    } };
  };
  const add = await s.call('POST', '/api/eco/peers', { name: 'hr', url: 'http://hr.local:8766/', key: 'hk_secret_1234', types: ['mes.crew_requirement.v1', 'mes.supply_plan.v1'] });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  const list = (await s.call('GET', '/api/eco/peers')).body;
  assert.ok(!JSON.stringify(list).includes('hk_secret_1234'), 'the key is never shown again');

  // nothing of those types yet
  let r = (await s.call('POST', `/api/eco/peers/${add.body.id}/push`)).body;
  assert.deepEqual([r.pushed, got.length], [0, 0]);

  // a crew requirement appears (a planning run publishes these; here it is published directly)
  await s.app.ctx.db.tx((t) => s.app.ctx.services.get('eco').publish(t, { type: 'mes.crew_requirement.v1', subject: 'x', correlation: 'x', data: {
    id: '0192f7c4-8a3e-5b21-9c55-3d1f2a4b6c7d', line: 'FA-1', shift: 'A', work_date: '2026-10-01', headcount: 5, skills: [], mrp_run: { id: '0192f7c4-8a3e-7b21-9c55-3d1f2a4b6c70', code: 'MRP-1' }, version: 1, origin: { app: 'gmes', type: 'crew_requirement', key: 'k' } } }));
  answer = () => ({ status: 503, body: { error: 'down' } });
  r = (await s.call('POST', `/api/eco/peers/${add.body.id}/push`)).body;
  assert.match(r.error, /503/);
  assert.equal((await s.call('GET', '/api/eco/peers')).body[0].cursor, 0, 'a failure never moves the cursor');

  answer = (types) => ({ status: 200, body: { results: types.map(() => ({ id: 'wrong-event', result: 'applied' })) } });
  r = (await s.call('POST', `/api/eco/peers/${add.body.id}/push`)).body;
  assert.match(r.error, /different event/);
  assert.equal((await s.call('GET', '/api/eco/peers')).body[0].cursor, 0);
  assert.equal((await s.call('GET', '/api/integration/events?status=parked')).body.length, 0);

  answer = (types) => ({ status: 200, body: { results: types.map(() => ({ result: 'rejected', code: 'hr.unknown_line', message: 'no such line' })) } });
  r = (await s.call('POST', `/api/eco/peers/${add.body.id}/push`)).body;
  assert.deepEqual([r.pushed, r.parked], [0, 1]);
  assert.equal(got.at(-1)!.url, 'http://hr.local:8766/eco/v1/inbox');
  assert.equal(got.at(-1)!.key, 'hk_secret_1234');
  const parked = (await s.call('GET', '/api/integration/events?status=parked')).body;
  assert.equal(parked.length, 1);
  assert.ok((await s.call('GET', '/api/eco/peers')).body[0].cursor > 0, 'a parked event does not block the feed');
  await s.close();
});

test('parked immutable consumption holds completion and close until an audited targeted recovery', async () => {
  const s = await stocked();
  try {
    const wo = await s.call('POST', '/api/work-orders', { commandId: 'retry-create', itemId: s.chair, plannedQty: '1', warehouseId: s.main });
    for (const [action, input] of [
      ['consume', { itemId: s.steel, qty: '2', warehouseId: s.main }],
      ['complete', { qty: '1' }], ['close', {}],
    ] as const) assert.equal((await s.call('POST', `/api/work-orders/${wo.body.id}/${action}`, { commandId: `retry-${action}`, ...input })).status, 200);
    const original = await s.app.ctx.db.all<any>('SELECT * FROM eco_outbox ORDER BY seq');
    const facts = original.filter((r) => JSON.parse(r.data).work_order?.id === wo.body.id);
    assert.equal(facts.length, 3);
    const peer = await s.call('POST', '/api/eco/peers', { name: 'mizan', url: 'http://mizan.local', key: 'mk_retry_1234', consumer: 'mizan', types: facts.map((r) => r.type) });
    let fixed = false;
    const sent: any[] = [];
    http.current = async (_url, init) => {
      const events = JSON.parse(init.body).events;
      sent.push(...events);
      return { status: 200, json: async () => ({ results: events.map((e: any) => e.type === 'mes.material.consumed.v1' && !fixed ? { id: e.id, result: 'rejected', code: 'inventory.shortage' } : { id: e.id, result: 'applied' }) }) };
    };
    const first = (await s.call('POST', `/api/eco/peers/${peer.body.id}/push`)).body;
    assert.equal(first.parked, 3);
    assert.deepEqual(sent.map((e) => e.id), [facts[0].id], 'completion and close never reach the receiver ahead of consumption');
    const cursor = (await s.call('GET', '/api/eco/peers')).body[0].cursor;
    const route = `/api/eco/peers/${peer.body.id}/retry-parked`;
    assert.equal((await s.call('POST', route, { eventIds: [facts[0].id], reason: 'Prerequisite repaired' }, s.keys.reader)).status, 403);
    assert.equal((await s.call('POST', route, { eventIds: ['unknown'], reason: 'Prerequisite repaired' })).status, 409);
    fixed = true;
    assert.equal((await s.call('POST', route, { eventIds: facts.map((r) => r.id).reverse(), reason: 'Stock receipt posted' })).body.pushed, 3);
    assert.deepEqual(sent.slice(1).map((e) => e.id), facts.map((r) => r.id), 'the sender restores original sequence even if selections are reversed');
    assert.equal((await s.call('GET', '/api/eco/peers')).body[0].cursor, cursor);
    assert.deepEqual(await s.app.ctx.db.all('SELECT * FROM eco_outbox ORDER BY seq'), original, 'retry cannot rewrite published facts');
    assert.equal((await s.call('GET', '/api/integration/events?status=parked')).body.length, 0);
    assert.equal((await s.call('POST', route, { eventIds: [facts[0].id], reason: 'Already recovered' })).status, 409);
  } finally { await s.close(); }
});
