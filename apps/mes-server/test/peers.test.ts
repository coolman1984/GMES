import assert from 'node:assert/strict';
import { test } from 'node:test';
import { http } from '../src/modules/eco/peers.js';
import { item, server, snapshot, warehouse } from './helpers.js';

process.env.GMES_SECRETS = 'plain';

/** The pusher (WP-G7): the outbox goes to each peer's inbox, filtered by type; answers move the cursor or park. */
test('events are pushed to a peer by type; refusals are parked or skipped; a network failure keeps the cursor', async () => {
  const s = await server('mizan');
  await s.call('POST', '/eco/v1/inbox', { events: [snapshot('eco.warehouse.v1', warehouse(1, 'MAIN')), snapshot('eco.item.v1', item(1, 'PANEL'))] }, s.keys.link);
  // a fake peer: it records what it receives and answers what the test decides
  const got: { url: string; key: string; types: string[] }[] = [];
  let answer: (types: string[]) => { status: number; body: unknown } = (types) => ({ status: 200, body: { results: types.map((t) => (t === 'mes.supply_plan.v1' ? { result: 'rejected', code: 'eco.not_accepted' } : { result: 'applied' })) } });
  http.current = async (url, init) => {
    const events = (JSON.parse(init.body) as { events: { type: string }[] }).events;
    got.push({ url, key: init.headers['x-eco-key']!, types: events.map((e) => e.type) });
    const a = answer(events.map((e) => e.type));
    return { status: a.status, json: async () => a.body };
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
