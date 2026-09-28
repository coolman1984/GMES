import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { parseQty, validateEvent } from '@eco/contracts';
import { productionDate } from '../src/kernel/clock.js';
import { createHash } from 'node:crypto';
import { stable } from '../src/kernel/commands.js';
import { GENESIS, lineHash } from '../src/modules/exe/ledger.js';
import { COMPANY, item, server, snapshot, stocked, warehouse, type TestServer } from './helpers.js';

describe('ownership of master data (docs/ecosystem/02)', () => {
  test('with Mizan as owner, manufacturing refuses to create items; as fallback owner it creates them', async () => {
    const s = await server('mizan');
    const r = await s.call('POST', '/api/items', { code: 'X', nameEn: 'X', nameAr: 'X' });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'mdm.not_owner');
    await s.close();
    const alone = await server('gmes');
    const ok = await alone.call('POST', '/api/items', { code: 'X', nameEn: 'X', nameAr: 'X' });
    assert.equal(ok.status, 200);
    // and then nobody else may overwrite it with a snapshot
    const snap = await alone.call('POST', '/eco/v1/inbox', { events: [snapshot('eco.item.v1', item(9, 'X'))] }, alone.keys.link);
    assert.equal(snap.body.results[0].code, 'mdm.not_mirror');
    await alone.close();
  });

  test('snapshots: applied once, newer versions win, older ones are ignored, other companies are refused', async () => {
    const s = await server('mizan');
    const first = snapshot('eco.item.v1', item(1, 'RM'));
    const a = await s.call('POST', '/eco/v1/inbox', { events: [first, first] }, s.keys.link);
    assert.deepEqual(a.body.results.map((r: any) => r.result), ['applied', 'duplicate']);
    const b = await s.call('POST', '/eco/v1/inbox', { events: [snapshot('eco.item.v1', item(1, 'RM', { version: 3, name: { en: 'Steel', ar: 'صلب' } }))] }, s.keys.link);
    assert.equal(b.body.results[0].result, 'applied');
    const c = await s.call('POST', '/eco/v1/inbox', { events: [snapshot('eco.item.v1', item(1, 'RM', { version: 2, name: { en: 'OLD', ar: 'OLD' } }))] }, s.keys.link);
    assert.equal(c.body.results[0].result, 'stale');
    const items = await s.call('GET', '/api/items');
    assert.equal(items.body[0].name_en, 'Steel');
    const foreign = snapshot('eco.item.v1', item(5, 'Z'));
    foreign.source = 'eco://0192f7c4-8a3e-7b21-9c55-3d1f2a4b6c7e/mizan';
    const d = await s.call('POST', '/eco/v1/inbox', { events: [foreign, { junk: true }] }, s.keys.link);
    assert.deepEqual(d.body.results.map((r: any) => r.code), ['eco.foreign_company', 'contract.invalid']);
    await s.close();
  });
});

describe('scopes are checked on the server', () => {
  let s: TestServer;
  before(async () => (s = await server()));
  after(() => s.close());
  test('no key, a wrong key and a missing scope are refused', async () => {
    assert.equal((await s.call('GET', '/api/items', undefined, null as unknown as string)).status, 401);
    assert.equal((await s.call('GET', '/api/items', undefined, 'gk_nope')).status, 401);
    assert.equal((await s.call('POST', '/api/work-orders', {}, s.keys.reader)).status, 403);
    assert.equal((await s.call('GET', '/eco/v1/feed', undefined, s.keys.operator)).status, 403);
  });
});

describe('production commands, ledger and events', () => {
  let s: Awaited<ReturnType<typeof stocked>>;
  let wo: string;
  before(async () => {
    s = await stocked();
    const r = await s.call('POST', '/api/work-orders', { commandId: 'cmd-create-1', itemId: s.chair, plannedQty: '10', warehouseId: s.main }, s.keys.operator);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    wo = r.body.id;
  });
  after(() => s.close());

  test('the same scan sent twice is booked once (idempotent commands, ADR-015)', async () => {
    const body = { commandId: 'scan-0001', itemId: s.steel, qty: '25', warehouseId: s.main, shift: 'A', person: { id: COMPANY, code: 'E-104' } };
    const a = await s.call('POST', `/api/work-orders/${wo}/consume`, body, s.keys.operator);
    const b = await s.call('POST', `/api/work-orders/${wo}/consume`, body, s.keys.operator);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body.replayed, false);
    assert.equal(b.body.replayed, true);
    assert.equal(b.body.eventId, a.body.eventId);
    const lines = (await s.call('GET', `/api/work-orders/${wo}`)).body.ledger.filter((l: any) => l.txn_type === 'CONSUME');
    assert.equal(lines.length, 1);
    // reusing the id for something else is refused, never silently answered
    const c = await s.call('POST', `/api/work-orders/${wo}/consume`, { ...body, qty: '26' }, s.keys.operator);
    assert.equal(c.status, 409);
    assert.equal(c.body.error.code, 'command.id_reused');
  });

  test('completion cannot exceed what is still open (conservation)', async () => {
    await s.call('POST', `/api/work-orders/${wo}/complete`, { commandId: 'done-0001', qty: '4' }, s.keys.operator);
    await s.call('POST', `/api/work-orders/${wo}/scrap`, { commandId: 'scrap-0001', qty: '1', reasonCode: 'WELD' }, s.keys.operator);
    const over = await s.call('POST', `/api/work-orders/${wo}/complete`, { commandId: 'done-0002', qty: '6' }, s.keys.operator);
    assert.equal(over.status, 409);
    assert.equal(over.body.error.code, 'wo.over_complete');
    assert.equal(over.body.error.open, '5');
    const last = await s.call('POST', `/api/work-orders/${wo}/complete`, { commandId: 'done-0003', qty: '5' }, s.keys.operator);
    assert.equal(last.body.status, 'completed');
    const late = await s.call('POST', `/api/work-orders/${wo}/consume`, { commandId: 'scan-0002', itemId: s.steel, qty: '1', warehouseId: s.main }, s.keys.operator);
    assert.equal(late.body.error.code, 'wo.not_open');
  });

  test('refuses quantities it cannot carry exactly', async () => {
    const r = await s.call('POST', '/api/work-orders', { commandId: 'cmd-create-2', itemId: s.chair, plannedQty: '0.0005', warehouseId: s.main }, s.keys.operator);
    assert.equal(r.status, 400);
    assert.match(r.body.error.message, /qty.precision/);
  });

  test('the feed is gap-free, ordered, contract-valid and carries the final flag', async () => {
    const feed = (await s.call('GET', '/eco/v1/feed?after=0', undefined, s.keys.link)).body;
    assert.deepEqual(feed.events.map((e: any) => e.ecoseq), feed.events.map((_: unknown, i: number) => i + 1));
    for (const e of feed.events) assert.ok(validateEvent(e).ok, JSON.stringify(validateEvent(e)));
    assert.deepEqual(feed.events.map((e: any) => e.type), [
      'mes.material.consumed.v1', 'mes.production.completed.v1', 'mes.production.scrapped.v1', 'mes.production.completed.v1',
    ]);
    const final = feed.events[3].data;
    assert.equal(final.work_order.is_final, true);
    assert.equal(final.work_order.completed_qty_after, '9');
    assert.equal(final.work_order.scrapped_qty, '1');
    assert.equal(feed.events[0].data.performed_by.person.code, 'E-104');
    assert.equal(feed.events[0].data.shift, 'A');
    const next = (await s.call('GET', `/eco/v1/feed?after=${feed.head}`, undefined, s.keys.link)).body;
    assert.equal(next.events.length, 0);
  });

  test('acks make every event traceable; a link cannot acknowledge for someone else', async () => {
    const feed = (await s.call('GET', '/eco/v1/feed?after=0', undefined, s.keys.link)).body;
    const r = await s.call('POST', '/eco/v1/acks', { acks: [
      { event_id: feed.events[0].id, consumer: 'link-mizan', status: 'applied', detail: { target_ref: 'ADJ-00001' } },
      { event_id: feed.events[1].id, consumer: 'link-mizan', status: 'parked', detail: { code: 'stock.insufficient', message: 'not enough' } },
    ] }, s.keys.link);
    assert.equal(r.body.recorded, 2);
    const parked = (await s.call('GET', '/api/integration/events?status=parked')).body;
    assert.equal(parked.length, 1);
    assert.equal(parked[0].code, 'stock.insufficient');
    const forged = await s.call('POST', '/eco/v1/acks', { acks: [{ event_id: feed.events[0].id, consumer: 'someone-else', status: 'applied' }] }, s.keys.link);
    assert.equal(forged.status, 403);
    const health = (await s.call('GET', '/api/system/health')).body;
    assert.equal(health.eco.find((c: any) => c.id === 'no_parked_events').ok, false);
  });
});

describe('the ledger is tamper-evident', () => {
  test('editing an old line is detected and located; the database refuses edits in the first place', async () => {
    const s = await stocked();
    const wo = (await s.call('POST', '/api/work-orders', { commandId: 'cmd-create-9', itemId: s.chair, plannedQty: '3', warehouseId: s.main })).body.id;
    for (let i = 0; i < 3; i++) await s.call('POST', `/api/work-orders/${wo}/complete`, { commandId: `done-9-${i}`, qty: '1' });
    assert.deepEqual((await s.call('GET', '/api/ledger/verify')).body.ok, true);
    const raw = new DatabaseSync(s.app.ctx.db.file);
    assert.throws(() => raw.exec("UPDATE exe_ledger SET qty = 5000 WHERE seq = 2"), /append-only/);
    assert.throws(() => raw.exec('DELETE FROM exe_ledger WHERE seq = 2'), /append-only/);
    // someone with the file drops the guard and edits anyway
    raw.exec('DROP TRIGGER exe_ledger_immutable; UPDATE exe_ledger SET qty = 5000 WHERE seq = 2');
    raw.close();
    const v = (await s.call('GET', '/api/ledger/verify')).body;
    assert.equal(v.ok, false);
    assert.equal(v.firstBadSeq, 2);
    const health = (await s.call('GET', '/api/system/health')).body;
    assert.equal(health.exe.find((c: any) => c.id === 'ledger_chain').ok, false);
    await s.close();
  });
});

describe('a field added to the ledger later leaves every older line valid', () => {
  test('a line without a station hashes exactly as before the station existed; with one, the station is sealed in', () => {
    const row = { seq: 1, id: 'x', txn_type: 'COMPLETE', command_id: 'c', work_order_id: 'w', item_id: 'i', warehouse_id: 'h', qty: 1000,
      lot_no: null, reason_code: null, user_name: 'u', person_id: null, production_date: '2026-09-28', shift_code: 'A', occurred_at: 't' };
    const before = createHash('sha256').update(GENESIS + '|' + stable(row)).digest('hex'); // the formula of the lines already written
    assert.equal(lineHash(GENESIS, { ...row, station_code: null }), before);
    const sealed = lineHash(GENESIS, { ...row, station_code: 'ST20' });
    assert.notEqual(sealed, before);
    assert.notEqual(lineHash(GENESIS, { ...row, station_code: 'ST21' }), sealed, 'a changed station breaks the chain');
  });
});

describe('random production sequences keep quantities conserved (property)', () => {
  test('200 random commands: projection = ledger, completed + scrapped <= planned, one event per accepted fact', async () => {
    const s = await stocked();
    let rnd = 12345;
    const next = () => (rnd = (rnd * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const orders: string[] = [];
    let accepted = 0;
    for (let i = 0; i < 200; i++) {
      const r = next();
      if (orders.length === 0 || r < 0.1) {
        const res = await s.call('POST', '/api/work-orders', { commandId: `prop-create-${i}`, itemId: s.chair, plannedQty: String(1 + Math.floor(next() * 20)), warehouseId: s.main });
        orders.push(res.body.id);
        continue;
      }
      const wo = orders[Math.floor(next() * orders.length)]!;
      const qty = (Math.floor(next() * 4000) / 1000 + 0.001).toFixed(3);
      const kind = r < 0.45 ? 'consume' : r < 0.8 ? 'complete' : r < 0.95 ? 'scrap' : 'close';
      const body: Record<string, unknown> = { commandId: `prop-cmd-${i}` };
      if (kind === 'consume') Object.assign(body, { itemId: s.steel, qty, warehouseId: s.main });
      if (kind === 'complete') Object.assign(body, { qty });
      if (kind === 'scrap') Object.assign(body, { qty, reasonCode: 'R' });
      const res = await s.call('POST', `/api/work-orders/${wo}/${kind}`, body);
      if (res.status === 200) accepted++;
      else assert.ok(['wo.over_complete', 'wo.not_open', 'wo.closed'].includes(res.body.error.code), JSON.stringify(res.body));
      // a retry of the same command never books twice
      if (next() < 0.2) {
        const again = await s.call('POST', `/api/work-orders/${wo}/${kind}`, body);
        if (res.status === 200) {
          assert.equal(again.body.replayed, true);
          assert.equal(again.body.eventId, res.body.eventId);
        } else assert.equal(again.body.error.code, res.body.error.code);
      }
    }
    for (const id of orders) {
      const wo = (await s.call('GET', `/api/work-orders/${id}`)).body;
      assert.ok(parseQty(wo.completed_qty) + parseQty(wo.scrapped_qty) <= parseQty(wo.planned_qty));
    }
    const health = (await s.call('GET', '/api/system/health')).body;
    for (const mod of Object.values(health) as { id: string; ok: boolean }[][]) {
      for (const c of mod) if (c.id !== 'no_parked_events') assert.ok(c.ok, JSON.stringify(c));
    }
    const feed = (await s.call('GET', '/eco/v1/feed?after=0&limit=500', undefined, s.keys.link)).body;
    assert.equal(feed.events.length, accepted);
    await s.close();
  });
});

describe('production date', () => {
  test('a night shift before the day start belongs to the previous production day (Cairo time)', () => {
    assert.equal(productionDate(new Date('2026-09-27T03:30:00Z'), 'Africa/Cairo', '07:00'), '2026-09-26'); // 06:30 local
    assert.equal(productionDate(new Date('2026-09-27T04:30:00Z'), 'Africa/Cairo', '07:00'), '2026-09-27'); // 07:30 local
    assert.equal(productionDate(new Date('2026-09-26T22:30:00Z'), 'Africa/Cairo', '07:00'), '2026-09-26'); // 01:30 local next day
  });
});

void warehouse;
