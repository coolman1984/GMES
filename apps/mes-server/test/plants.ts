import assert from 'node:assert/strict';
import { server, item as itemSnapshot, warehouse, snapshot } from './helpers.js';

/**
 * A small TV plant: an SMD line that makes main boards (PBA) and a main-assembly line that fits a bought-in panel and
 * the main board into a TV, tests it and packs it.
 */
export async function tvPlant(owner: 'gmes' | 'mizan' = 'gmes') {
  const s = await server(owner);
  const ok = async (method: string, url: string, body?: unknown) => {
    const r = await s.call(method, url, body);
    assert.ok(r.status < 300, `${method} ${url}: ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const node = async (code: string, type: string, parentId: string | null) => (await ok('POST', '/api/plant', { code, type, parentId, nameEn: code })).id as string;
  const p = await node('P1', 'plant', null);
  const smd = await node('SMD', 'area', p);
  const smdLine = await node('SMD-01', 'line', smd);
  for (const st of ['LD', 'AOI']) await node(`SMD-01-${st}`, 'station', smdLine);
  const ma = await node('MA', 'area', p);
  const maLine = await node('MA-01', 'line', ma);
  for (const st of ['PL', 'MB', 'FT', 'PK']) await node(`MA-01-${st}`, 'station', maLine);
  let itemNo = 0;
  const item = async (code: string, tracking: string) => {
    if (owner === 'gmes') return (await ok('POST', '/api/items', { code, nameEn: code, nameAr: 'صنف ' + code, tracking })).id as string;
    const data = itemSnapshot(++itemNo, code, { tracking });
    const reply = await ok('POST', '/eco/v1/inbox', { events: [snapshot('eco.item.v1', data)] });
    assert.equal(reply.results[0].result, 'applied', JSON.stringify(reply));
    return data.id;
  };
  const ids = { tv: await item('TV-55', 'serial'), pba: await item('PBA-55', 'serial'), panel: await item('PNL-55', 'serial'), screw: await item('SCREW', 'none'), carton: await item('CARTON', 'lot') };
  let wh: string;
  if (owner === 'gmes') wh = (await ok('POST', '/api/warehouses', { code: 'MAIN', nameEn: 'Main', nameAr: 'الرئيسي' })).id;
  else {
    const data = warehouse(1, 'MAIN');
    const reply = await ok('POST', '/eco/v1/inbox', { events: [snapshot('eco.warehouse.v1', data)] });
    assert.equal(reply.results[0].result, 'applied', JSON.stringify(reply));
    wh = data.id;
  }
  const route = async (itemId: string, ops: unknown[]) => {
    const r = await ok('POST', '/api/routings', { itemId, operations: ops });
    const cur = await ok('GET', `/api/routings/${r.id}`);
    await ok('POST', `/api/routings/${r.id}/approve`, { version: cur.version });
    return r.id as string;
  };
  const tvRoute = await route(ids.tv, [
    { seq: 10, code: 'PL', nameEn: 'Panel loading' }, { seq: 20, code: 'MB', nameEn: 'Main board' },
    { seq: 30, code: 'FT', nameEn: 'Function test', kind: 'test', cycleSec: 42 }, { seq: 40, code: 'PK', nameEn: 'Packing', kind: 'pack' }]);
  await route(ids.pba, [{ seq: 10, code: 'LD', nameEn: 'Loader' }, { seq: 20, code: 'AOI', nameEn: 'Optical inspection', kind: 'inspection' }]);
  const bom = await ok('POST', '/api/boms', { itemId: ids.tv, lines: [
    { componentId: ids.panel, qtyPer: '1', opCode: 'PL', scan: 'serial' }, { componentId: ids.pba, qtyPer: '1', opCode: 'MB', scan: 'serial' },
    { componentId: ids.screw, qtyPer: '4', opCode: 'MB', scan: 'none' }, { componentId: ids.carton, qtyPer: '1', opCode: 'PK', scan: 'lot' }] });
  await ok('POST', `/api/boms/${bom.id}/approve`, { version: (await ok('GET', `/api/boms/${bom.id}`)).version });
  return { ...s, ok, ids, wh, tvRoute, bomId: bom.id as string };
}

