import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { validateEvent } from '@eco/contracts';
import { addKey } from '../src/modules/system/index.js';
import { COMPANY, server, snapshot } from './helpers.js';

/** The link with Space Planner (WP-G8): the plant tree goes out, positions come back, stations are streamed live. */
test('plant nodes are published and exported; a layout snapshot gives tagged nodes a position; the live stream is guarded', async () => {
  const s = await server('mizan');
  const ok = async (method: string, url: string, body?: unknown) => { const r = await s.call(method, url, body); assert.ok(r.status < 300, `${method} ${url} ${JSON.stringify(r.body)}`); return r.body; };
  const plant = await ok('POST', '/api/plant', { code: 'P1', type: 'plant', nameEn: 'Plant' });
  const area = await ok('POST', '/api/plant', { code: 'MA', type: 'area', parentId: plant.id, nameEn: 'Main assembly' });
  const line = await ok('POST', '/api/plant', { code: 'FA-1', type: 'line', parentId: area.id, nameEn: 'Line 1', capacityPerShift: 100 });
  const st = await ok('POST', '/api/plant', { code: 'FA-1-PL', type: 'station', parentId: line.id, nameEn: 'Panel loading' });
  await ok('POST', '/api/plant', { code: 'FA-1-MB', type: 'station', parentId: line.id, nameEn: 'Main board' });
  await ok('PUT', '/api/pln/crew-settings', { node: 'FA-1-PL', crew: 3 });

  // every node change is an event with a valid contract
  const feed = (await s.call('GET', '/eco/v1/feed?after=0&limit=500', undefined, s.keys.link)).body.events as any[];
  const nodes = feed.filter((e) => e.type === 'eco.plant_node.v1');
  assert.equal(nodes.length, 5);
  for (const e of nodes) assert.ok(validateEvent(e).ok, JSON.stringify(validateEvent(e)));

  // the export Space Planner fetches: the tree with parents and crew
  const exp = await ok('GET', '/api/plant/export');
  assert.equal(exp.company_id, COMPANY);
  const pl = exp.nodes.find((n: any) => n.code === 'FA-1-PL');
  assert.deepEqual([pl.type, pl.parent.code, pl.crew, exp.nodes.length], ['station', 'FA-1', 3, 5]);
  assert.equal(exp.nodes.find((n: any) => n.code === 'FA-1').capacity_per_shift, 100);

  // a layout snapshot: the tagged station gets its position; an unknown tag and an untagged item are ignored
  const layout = (version: number, x: number) => snapshot('eco.layout.snapshot.v1', {
    id: randomUUID().replace(/^(.{14})./, '$15').toLowerCase(), code: 'LAYOUT-1', version, origin: { app: 'space', type: 'layout', key: 'p1' }, name: 'FA hall', revision: version, length_unit: '0.1mm',
    items: [
      { item_id: 'i1', name: 'Panel loader', category: 'machine', x, y: 2000, rotation_mdeg: 90000, w: 12000, d: 8000, h: 20000, eco_ref: { type: 'plant_node', id: st.id, code: 'FA-1-PL' } },
      { item_id: 'i2', name: 'Ghost', category: 'machine', x: 1, y: 1, rotation_mdeg: 0, w: 1, d: 1, h: 1, eco_ref: { type: 'plant_node', id: randomUUID(), code: 'GONE' } },
      { item_id: 'i3', name: 'Table', category: 'furniture', x: 5, y: 5, rotation_mdeg: 0, w: 5, d: 5, h: 5 },
    ],
    zones: [{ id: 'z1', kind: 'line', polygon: [[0, 0], [50000, 0], [50000, 9000], [0, 9000]], eco_ref: { type: 'plant_node', id: line.id, code: 'FA-1' } }],
  }, '0192f7c4-8a3e-5b21-9c55-3d1f2a4b6c00');
  const first = layout(1, 1000);
  const r = await s.call('POST', '/eco/v1/inbox', { events: [first] }, s.keys.link);
  assert.equal(r.body.results[0].result, 'applied', JSON.stringify(r.body));
  const sp = await ok('GET', '/api/plant/spatial');
  assert.deepEqual(sp.map((x: any) => [x.code, x.kind, x.x, x.w]), [['FA-1', 'zone', 0, 50000], ['FA-1-PL', 'item', 1000, 12000]]);

  // the live stream: no key, wrong page, and then the stream itself
  const address = await s.app.http.listen({ port: 0, host: '127.0.0.1' });
  const liveKey = await addKey(s.app.ctx, 'space-live', ['eco.live.read']);
  assert.equal((await fetch(`${address}/eco/v1/live`)).status, 401);
  assert.equal((await fetch(`${address}/eco/v1/live?k=${liveKey}`, { headers: { origin: 'http://evil.example' } })).status, 403);
  const res = await fetch(`${address}/eco/v1/live?lines=FA-1&k=${liveKey}`, { headers: { origin: 'http://127.0.0.1:4600' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), 'http://127.0.0.1:4600');
  const reader = res.body!.getReader();
  let text = '';
  const until = Date.now() + 5000;
  while (Date.now() < until && !(text.includes('FA-1-MB') && text.includes('line.output'))) { const { value, done } = await reader.read(); if (done) break; text += new TextDecoder().decode(value); }
  await reader.cancel();
  assert.match(text, /event: station\.state\ndata: \{"station":"FA-1-PL","line":"FA-1","state":"starved"\}/);
  assert.match(text, /event: line\.output/);
  await s.close();
});
