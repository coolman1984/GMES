/**
 * End to end, black box: a REAL Mizan process (pinned version, its own unchanged code and API),
 * a real manufacturing server, and the link between them over HTTP.
 * Covers the ✅ scenarios of docs/ecosystem/05-end-to-end-scenarios.md.
 */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { mizanId, newUuidv7 } from '@eco/contracts';
import { TransientError } from '../src/errors.js';
import { Link } from '../src/link.js';
import { MesClient } from '../src/mes.js';
import { MizanClient } from '../src/mizan.js';
import { LinkState } from '../src/state.js';
import { MizanAdmin, MizanProcess, mesServer, mizanDir } from './harness.js';

const DIR = mizanDir();
const required = process.env.ECO_E2E_REQUIRED === '1';
if (!DIR && required) throw new Error('ECO_E2E_REQUIRED=1 but no Mizan checkout: run scripts/fetch-mizan.ps1');

describe('manufacturing <-> Mizan, end to end', { skip: DIR ? false : 'no Mizan checkout (run scripts/fetch-mizan.ps1 or set MIZAN_DIR)' }, () => {
  const company = newUuidv7();
  const mizan = new MizanProcess(DIR ?? '');
  let admin: MizanAdmin;
  let mes: Awaited<ReturnType<typeof mesServer>>;
  const statePath = join(tmpdir(), `link-state-${company}.db`);
  let state: LinkState;
  let link: Link;
  const ids = { steel: 0, chair: 0, main: 0, wip: 0 };
  const g = { steel: '', chair: '', main: '' };
  let cmd = 0;

  const makeLink = (faults?: { afterMizanPost?: (id: string) => void; beforeMizanPost?: (id: string) => void }) =>
    new Link(
      { companyId: company, consumer: 'link-mizan', accounts: { wip: '1145', variance: '5170' }, faults },
      new MizanClient(mizan.url, 'mes-link', 'link-password-1'),
      new MesClient(mes.url, mes.linkKey),
      state,
    );
  const op = async (path: string, body: Record<string, unknown>) => {
    const res = await fetch(mes.url + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-eco-key': mes.opKey }, body: JSON.stringify({ commandId: `e2e-cmd-${++cmd}`, ...body }) });
    const json = await res.json();
    if (res.status !== 200) throw new Error(`${path} -> ${res.status} ${JSON.stringify(json)}`);
    return json;
  };
  const mesGet = async (path: string) => (await fetch(mes.url + path, { headers: { 'x-eco-key': mes.adminKey } })).json();
  const level = async (item: number) => (await admin.ok('GET', `/api/inventory/levels?warehouseId=${ids.main}`))[item] ?? 0;
  const ecoDocs = async () => (await admin.ok('GET', '/api/inventory/operations?q=eco:&limit=500')).rows.filter((r: any) => r.reference?.startsWith('eco:'));
  const account = async (code: string) => (await admin.ok('GET', '/api/accounts')).find((a: any) => a.code === code);
  const newOrder = async (qty: string) => (await op('/api/work-orders', { itemId: g.chair, plannedQty: qty, warehouseId: g.main, productionDate: '2026-09-27' })).id as string;
  const mizanHealthy = async () => {
    const h = await admin.ok('GET', '/api/system/health');
    const bad = h.flatMap((m: any) => (m.error ? [{ module: m.module, error: m.error }] : m.checks.filter((c: any) => !c.ok).map((c: any) => ({ module: m.module, ...c }))));
    assert.deepEqual(bad, [], 'Mizan health');
  };

  before(async () => {
    await mizan.start();
    admin = new MizanAdmin(mizan.url);
    await admin.setup();
    await admin.ok('POST', '/api/accounts', { code: '1145', nameEn: 'Work in progress', nameAr: 'إنتاج تحت التشغيل', type: 'asset', subtype: 'current_asset' });
    await admin.ok('POST', '/api/accounts', { code: '5170', nameEn: 'Production variances', nameAr: 'انحرافات الإنتاج', type: 'expense', subtype: 'cogs' });
    ids.steel = (await admin.ok('POST', '/api/items', { sku: 'RM-STEEL', nameEn: 'Steel tube', nameAr: 'مواسير صلب', kind: 'product', unit: 'kg' })).id;
    ids.chair = (await admin.ok('POST', '/api/items', { sku: 'FG-CHAIR', nameEn: 'Chair', nameAr: 'كرسي', kind: 'product', unit: 'pcs' })).id;
    ids.main = (await admin.ok('GET', '/api/inventory/warehouses')).find((w: any) => w.code === 'MAIN').id;
    // 100 kg of steel at 50.00 EGP/kg
    await admin.ok('POST', '/api/inventory/operations', { kind: 'adjustment', date: '2026-09-01', warehouseId: ids.main, post: true, lines: [{ itemId: ids.steel, qty: 100_000, unitCost: 5000 }] });
    // The link's own restricted user: stock documents and journals, nothing else.
    const role = await admin.ok('POST', '/api/roles', { name: 'Manufacturing link', permissions: [
      'inventory.stock.read', 'inventory.operations.write', 'inventory.operations.post', 'catalog.items.read', 'gl.accounts.read', 'gl.journal.read', 'gl.journal.write', 'gl.journal.post',
    ] });
    await admin.ok('POST', '/api/users', { username: 'mes-link', displayName: 'Manufacturing link', password: 'link-password-1', roleIds: [role.id] });
    // A fresh Mizan warns until its first backup exists; a real install takes one on day one.
    await admin.ok('POST', '/api/system/backups', {});
    mes = await mesServer(company);
    state = new LinkState(statePath);
    link = makeLink();
    g.steel = mizanId(company, 'item', ids.steel);
    g.chair = mizanId(company, 'item', ids.chair);
    g.main = mizanId(company, 'warehouse', ids.main);
  });
  after(async () => {
    state?.close();
    await mes?.app.close();
    await mizan.stop();
    rmSync(statePath, { force: true });
  });

  test('S1: items and warehouses flow from their owner (Mizan) to manufacturing, once', async () => {
    const r1 = await link.runOnce();
    assert.equal(r1.stoppedBy, undefined);
    assert.ok(r1.mirrored.sent >= 3);
    const items = await mesGet('/api/items');
    const steel = items.find((i: any) => i.code === 'RM-STEEL');
    assert.equal(steel.id, g.steel);
    assert.equal(steel.base_uom, 'KG');
    assert.equal(steel.owner, 'mizan');
    assert.equal((await link.runOnce()).mirrored.sent, 0, 'nothing changed, nothing sent');
    await admin.ok('PUT', `/api/items/${ids.chair}`, { sku: 'FG-CHAIR', nameEn: 'Office chair', nameAr: 'كرسي مكتب', kind: 'product', unit: 'pcs' });
    assert.equal((await link.runOnce()).mirrored.sent, 1);
    assert.equal((await mesGet('/api/items')).find((i: any) => i.code === 'FG-CHAIR').name_en, 'Office chair');
  });

  test('S2+S3+S7: consumption and completion become stock documents valued by Mizan; a double scan posts once', async () => {
    const wo = await newOrder('10');
    const scan = { commandId: 'scan-steel-1', itemId: g.steel, qty: '25', warehouseId: g.main, productionDate: '2026-09-27', shift: 'A' };
    for (let i = 0; i < 2; i++) await fetch(`${mes.url}/api/work-orders/${wo}/consume`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-eco-key': mes.opKey }, body: JSON.stringify(scan) });
    await op(`/api/work-orders/${wo}/complete`, { qty: '4', productionDate: '2026-09-27' });
    await op(`/api/work-orders/${wo}/scrap`, { qty: '1', reasonCode: 'WELD', productionDate: '2026-09-27' });
    await op(`/api/work-orders/${wo}/complete`, { qty: '5', productionDate: '2026-09-27' });
    await op(`/api/work-orders/${wo}/close`, { productionDate: '2026-09-27' });
    const r = await link.runOnce();
    assert.equal(r.stoppedBy, undefined);
    assert.equal(r.parked, 0);

    assert.equal(await level(ids.steel), 75_000, '100 - 25 kg');
    assert.equal(await level(ids.chair), 9_000, '9 good chairs; the scrapped one never reaches stock');
    const docs = await ecoDocs();
    assert.equal(docs.length, 3, 'one issue + two receipts, the double scan posted once');
    // 25 kg x 50.00 = 1,250.00 issued; all of it came back as chairs (scrap absorbed): WIP ends at zero.
    const card = await admin.ok('GET', `/api/inventory/items/${ids.chair}`);
    assert.equal(card.value, 125_000);
    assert.equal((await account('1145')).balance, 0, 'work in progress fully relieved');
    const events = await mesGet(`/api/integration/events?correlation=work_order/${wo}`);
    assert.deepEqual(events.map((e: any) => e.status), ['applied', 'applied', 'skipped', 'applied', 'skipped']);
    assert.match(events[0].target_ref, /^ADJ-/);
    await mizanHealthy();
  });

  test('scrap before a completion shifts cost onto the good units; closing sends what is left to variances', async () => {
    const wo = await newOrder('5');
    await op(`/api/work-orders/${wo}/consume`, { itemId: g.steel, qty: '10', warehouseId: g.main, productionDate: '2026-09-27' }); // 500.00 into WIP
    await op(`/api/work-orders/${wo}/scrap`, { qty: '1', reasonCode: 'EARLY', productionDate: '2026-09-27' });
    await op(`/api/work-orders/${wo}/complete`, { qty: '2', productionDate: '2026-09-27' }); // 2 of the 4 still possible: 250.00
    await op(`/api/work-orders/${wo}/complete`, { qty: '1', productionDate: '2026-09-27' }); // 1 of 2: 125.00
    await op(`/api/work-orders/${wo}/scrap`, { qty: '1', reasonCode: 'LATE', productionDate: '2026-09-27' }); // the order ends on a scrap
    await op(`/api/work-orders/${wo}/close`, { productionDate: '2026-09-27' });
    await link.runOnce();
    const events = await mesGet(`/api/integration/events?correlation=work_order/${wo}`);
    assert.deepEqual(events.map((e: any) => e.status), ['applied', 'skipped', 'applied', 'applied', 'skipped', 'applied']);
    assert.equal(JSON.parse(events[2].figures).value_minor, '25000', 'cost is shared over the units that can still be good');
    assert.equal(JSON.parse(events[3].figures).value_minor, '12500');
    assert.equal((await account('1145')).balance, 0);
    assert.equal((await account('5170')).balance, 12_500, '125.00 left by the late scrap');
    assert.match(events[5].target_ref, /^JE-/);
    await mizanHealthy();
  });

  test('S4: accounting is down while the plant works; everything lands once when it is back', async () => {
    await mizan.stop();
    const wo = await newOrder('2');
    await op(`/api/work-orders/${wo}/consume`, { itemId: g.steel, qty: '4', warehouseId: g.main, productionDate: '2026-09-27' });
    await op(`/api/work-orders/${wo}/complete`, { qty: '2', productionDate: '2026-09-27' });
    const cursor = state.cursor;
    const down = await link.runOnce();
    assert.ok(down.stoppedBy, 'the cycle stops instead of skipping');
    assert.equal(state.cursor, cursor, 'the cursor does not move while Mizan is unreachable');
    await mizan.start();
    const before = (await ecoDocs()).length;
    const up = await link.runOnce();
    assert.equal(up.stoppedBy, undefined);
    assert.equal((await ecoDocs()).length, before + 2);
    assert.equal((await account('1145')).balance, 0);
  });

  test('S4b: the network drops in the middle of the feed: nothing is parked, skipped or advanced past', async () => {
    const wo = await newOrder('1');
    const { eventId } = await op(`/api/work-orders/${wo}/consume`, { itemId: g.steel, qty: '1', warehouseId: g.main, productionDate: '2026-09-27' });
    const flaky = makeLink({ beforeMizanPost: (id) => { if (id === eventId) throw new TransientError('simulated network drop'); } });
    const cursor = state.cursor;
    const r = await flaky.runOnce();
    assert.match(r.stoppedBy ?? '', /simulated network drop/);
    assert.equal(state.cursor, cursor);
    assert.equal(state.isDone(eventId), false);
    assert.equal(state.parked().length, 0);
    await op(`/api/work-orders/${wo}/complete`, { qty: '1', productionDate: '2026-09-27' });
    const ok = await link.runOnce();
    assert.equal(ok.applied, 2);
    assert.equal((await ecoDocs()).filter((d: any) => d.reference === `eco:${eventId}`).length, 1);
    assert.equal((await account('1145')).balance, 0);
  });

  test('S5: the link crashes after Mizan accepted a document; the retry finds it and posts nothing twice', async () => {
    const wo = await newOrder('1');
    const { eventId } = await op(`/api/work-orders/${wo}/consume`, { itemId: g.steel, qty: '2', warehouseId: g.main, productionDate: '2026-09-27' });
    const crashing = makeLink({ afterMizanPost: (id) => { if (id === eventId) throw new Error('simulated crash'); } });
    await assert.rejects(crashing.runOnce(), /simulated crash/);
    assert.equal((await ecoDocs()).filter((d: any) => d.reference === `eco:${eventId}`).length, 1);
    await link.runOnce();
    assert.equal((await ecoDocs()).filter((d: any) => d.reference === `eco:${eventId}`).length, 1, 'still exactly one');
    assert.equal(state.isDone(eventId), true);
    await op(`/api/work-orders/${wo}/complete`, { qty: '1', productionDate: '2026-09-27' });
    await link.runOnce();
    assert.equal((await account('1145')).balance, 0);
  });

  test('S6: not enough stock in Mizan parks the event and holds back only its own work order', async () => {
    const short = await newOrder('3');
    const other = await newOrder('1');
    await op(`/api/work-orders/${short}/consume`, { itemId: g.steel, qty: '500', warehouseId: g.main, productionDate: '2026-09-27' });
    await op(`/api/work-orders/${short}/complete`, { qty: '1', productionDate: '2026-09-27' });
    await op(`/api/work-orders/${other}/consume`, { itemId: g.steel, qty: '1', warehouseId: g.main, productionDate: '2026-09-27' });
    await op(`/api/work-orders/${other}/complete`, { qty: '1', productionDate: '2026-09-27' });
    const r = await link.runOnce();
    assert.equal(r.parked, 2);
    const parked = await mesGet('/api/integration/events?status=parked');
    assert.deepEqual(parked.map((p: any) => p.code), ['stock.insufficient', 'eco.held_behind']);
    const otherEvents = await mesGet(`/api/integration/events?correlation=work_order/${other}`);
    assert.deepEqual(otherEvents.map((e: any) => e.status), ['applied', 'applied'], 'another order is not blocked');
    const health = await mesGet('/api/system/health');
    assert.equal(health.eco.find((c: any) => c.id === 'no_parked_events').ok, false, 'the exception is visible in manufacturing');
    // the storekeeper receives steel in Mizan; the next cycle clears the order in order
    await admin.ok('POST', '/api/inventory/operations', { kind: 'adjustment', date: '2026-09-02', warehouseId: ids.main, post: true, lines: [{ itemId: ids.steel, qty: 500_000, unitCost: 5000 }] });
    const again = await link.runOnce();
    assert.equal(again.retriedOk, 2);
    assert.deepEqual(await mesGet('/api/integration/events?status=parked'), []);
    await mizanHealthy();
  });

  test('state lost: replaying the whole feed from zero writes nothing twice and rebuilds the same work-in-progress figures', async () => {
    const wipBefore = state.db.prepare('SELECT * FROM wip ORDER BY work_order_id').all();
    const docsBefore = (await ecoDocs()).length;
    const jesBefore = (await admin.ok('GET', '/api/journal?q=eco:&limit=500')).rows.length;
    state.close();
    rmSync(statePath, { force: true });
    rmSync(statePath + '-wal', { force: true });
    rmSync(statePath + '-shm', { force: true });
    state = new LinkState(statePath);
    link = makeLink();
    const r = await link.runOnce();
    assert.equal(r.stoppedBy, undefined);
    assert.equal(r.parked, 0);
    assert.equal((await ecoDocs()).length, docsBefore);
    assert.equal((await admin.ok('GET', '/api/journal?q=eco:&limit=500')).rows.length, jesBefore);
    assert.deepEqual(state.db.prepare('SELECT * FROM wip ORDER BY work_order_id').all(), wipBefore);
    await mizanHealthy();
  });

  test('refuses to start when work in progress would be booked to an inventory-type account (LESSONS: breaks Mizan valuation)', async () => {
    const wrong = new Link(
      { companyId: company, consumer: 'link-mizan', accounts: { wip: '1140', variance: '5170' } },
      new MizanClient(mizan.url, 'mes-link', 'link-password-1'), new MesClient(mes.url, mes.linkKey), state,
    );
    await assert.rejects(wrong.runOnce(), /must not have the subtype "inventory"/);
  });

  test('manufacturing itself stays consistent: ledger chain intact, orders equal the ledger, feed gap-free', async () => {
    const h = await mesGet('/api/system/health');
    for (const [mod, checks] of Object.entries(h) as [string, { id: string; ok: boolean }[]][]) for (const c of checks) assert.ok(c.ok, `${mod}.${c.id}`);
  });
});
