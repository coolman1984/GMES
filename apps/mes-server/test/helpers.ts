import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hrId, mizanId, sourceOf, uuidv7 } from '@eco/contracts';
import { buildApp, type App } from '../src/app.js';
import type { Clock } from '../src/kernel/clock.js';
import { addKey } from '../src/modules/system/index.js';

export const COMPANY = '0192f7c4-8a3e-7b21-9c55-3d1f2a4b6c7d';
export const MIZAN_SOURCE = sourceOf(COMPANY, 'mizan', 'link-mizan');
export const HR_SOURCE = sourceOf(COMPANY, 'hr', 'hr-main');

/** A clock tests can move; ids stay time-ordered and unique. */
export function testClock(start = '2026-09-27T08:00:00.000Z'): Clock & { set(iso: string): void } {
  let now = new Date(start);
  let n = 0;
  return {
    now: () => new Date(now),
    newId: () => uuidv7(now.getTime(), Uint8Array.from({ length: 10 }, (_, i) => (i === 9 ? ++n & 0xff : i === 8 ? (n >> 8) & 0xff : 0))),
    set(iso: string) {
      now = new Date(iso);
    },
  };
}

export interface TestServer {
  app: App;
  clock: ReturnType<typeof testClock>;
  keys: { admin: string; operator: string; link: string; reader: string };
  call(method: string, url: string, body?: unknown, key?: string): Promise<{ status: number; body: any }>;
  close(): Promise<void>;
}

export async function server(owner: 'mizan' | 'gmes' = 'mizan', person: 'hr' | 'none' = 'none'): Promise<TestServer> {
  const dir = mkdtempSync(join(tmpdir(), 'gmes-test-'));
  const clock = testClock();
  const app = await buildApp({
    dbFile: join(dir, 'gmes.db'), clock,
    config: { companyId: COMPANY, node: 'plant-1', timeZone: 'Africa/Cairo', productionDayStart: '07:00', ownership: { item: owner, warehouse: owner, person } },
  });
  const keys = {
    admin: await addKey(app.ctx, 'admin', ['*']),
    operator: await addKey(app.ctx, 'station-3', ['exe.orders.write', 'exe.orders.read', 'mdm.items.read']),
    link: await addKey(app.ctx, 'link-mizan', ['eco.feed.read', 'eco.inbox.write', 'eco.acks.write']),
    reader: await addKey(app.ctx, 'viewer', ['exe.orders.read']),
  };
  const call = async (method: string, url: string, body?: unknown, key: string | null = keys.admin) => {
    const res = await app.http.inject({ method: method as 'GET', url, payload: body as object, headers: key ? { 'x-eco-key': key } : {} });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  };
  return { app, clock, keys, call, close: () => app.close() };
}

/** Signs a person in through the screens' API and returns a caller that sends their session cookie. */
export async function signIn(s: TestServer, login: string, password: string) {
  const r = await s.app.http.inject({ method: 'POST', url: '/api/auth/login', payload: { login, password } });
  if (r.statusCode !== 200) throw new Error(`sign-in ${login}: ${r.body}`);
  const cookie = String(r.headers['set-cookie']).split(';')[0]!;
  const call = async (method: string, url: string, body?: unknown) => {
    const res = await s.app.http.inject({ method: method as 'GET', url, payload: body as object, headers: { cookie } });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  };
  return Object.assign(call, { cookie });
}

let seq = 0;
/** A master-data snapshot from Mizan as the link sends it. */
export function snapshot(type: string, data: Record<string, unknown>, id?: string, source = MIZAN_SOURCE) {
  seq++;
  return {
    specversion: '1.0', id: id ?? uuidv7(Date.UTC(2026, 8, 27) + seq, new Uint8Array(10).fill(seq & 0xff)), source, type,
    subject: `${type.split('.')[1]}/${data.id}`, time: '2026-09-27T08:00:00.000Z', datacontenttype: 'application/json', ecoseq: seq,
    ecocorrelation: `${type.split('.')[1]}/${data.id}`, data,
  };
}

export const item = (localId: number, code: string, extra: Record<string, unknown> = {}) => ({
  id: mizanId(COMPANY, 'item', localId), code, name: { en: code, ar: code }, active: true, version: 1,
  origin: { app: 'mizan', type: 'item', key: String(localId) }, kind: 'product', stock_tracked: true, tracking: 'none', base_uom: 'PCS', units: [], ...extra,
});
export const warehouse = (localId: number, code: string, extra: Record<string, unknown> = {}) => ({
  id: mizanId(COMPANY, 'warehouse', localId), code, name: { en: code, ar: code }, active: true, version: 1,
  origin: { app: 'mizan', type: 'warehouse', key: String(localId) }, is_default: localId === 1, ...extra,
});

/** A server with steel (RM), a chair (FG) and the MAIN warehouse mirrored from Mizan. */
export async function stocked(person: 'hr' | 'none' = 'none'): Promise<TestServer & { steel: string; chair: string; main: string }> {
  const s = await server('mizan', person);
  const r = await s.call('POST', '/eco/v1/inbox', {
    events: [snapshot('eco.item.v1', item(1, 'RM-STEEL', { base_uom: 'KG' })), snapshot('eco.item.v1', item(2, 'FG-CHAIR')), snapshot('eco.warehouse.v1', warehouse(1, 'MAIN'))],
  }, s.keys.link);
  if (r.body.results.some((x: any) => x.result !== 'applied')) throw new Error(JSON.stringify(r.body));
  return { ...s, steel: mizanId(COMPANY, 'item', 1), chair: mizanId(COMPANY, 'item', 2), main: mizanId(COMPANY, 'warehouse', 1) };
}

/** An employee snapshot as the HR system publishes it. */
export const employee = (code: string, extra: Record<string, unknown> = {}) => ({
  id: hrId(COMPANY, 'employee', code), code, employment_status: 'Active', active: true, version: 1,
  origin: { app: 'hr', type: 'employee', key: code }, ...extra,
});
