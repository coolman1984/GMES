import { z } from 'zod';
import { conflict, notFound } from '../../kernel/errors.js';
import { signatureHeaders } from '../../kernel/signing.js';
import type { Ctx, RouteKit } from '../../kernel/modules.js';
import { open, seal } from '../../kernel/secrets.js';

/**
 * The pusher (plan 01 §1.3, WP-G7): manufacturing's outbox is POSTed to each configured peer's /eco/v1/inbox, after that
 * peer's cursor, filtered by the types it wants. The peer's per-event answer decides: applied / unchanged / stale /
 * duplicate move on; `eco.not_accepted` is recorded as skipped; any other refusal is parked (visible in
 * /api/integration/events) and the cursor still moves — one bad event never blocks the feed. A network failure or a
 * 5xx stops the pass without moving the cursor; the next pass resumes from the same place.
 */
export const peersMigration = {
  id: '002_peers',
  up: `
    CREATE TABLE eco_peer (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      url         TEXT NOT NULL,
      key_sealed  TEXT NOT NULL,
      consumer    TEXT NOT NULL,
      types       TEXT,
      cursor      INTEGER NOT NULL DEFAULT 0,
      active      INTEGER NOT NULL DEFAULT 1,
      last_ok_at  TEXT,
      last_error  TEXT,
      created_at  TEXT NOT NULL
    );
  `,
};

export type Http = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }) => Promise<{ status: number; json(): Promise<unknown> }>;
export const http: { current: Http } = {
  current: async (url, init) => {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
    return { status: res.status, json: () => res.json() };
  },
};

interface PeerRow { id: string; name: string; url: string; key_sealed: string; consumer: string; types: string | null; cursor: number; active: number; last_ok_at: string | null; last_error: string | null }
interface OutboxRow { seq: number; id: string; type: string; subject: string; correlation: string; causation: string | null; time: string; data: string }
const OK = new Set(['applied', 'unchanged', 'stale', 'duplicate']);
const PAGE = 200;
const trim = (u: string) => u.replace(/\/+$/, '');
const view = (p: PeerRow) => ({ id: p.id, name: p.name, url: p.url, consumer: p.consumer, types: p.types ? p.types.split(' ') : null, cursor: p.cursor, active: !!p.active, last_ok_at: p.last_ok_at, last_error: p.last_error });

const running = new WeakMap<Ctx, Set<string>>();
export async function pushPeer(ctx: Ctx, id: string, source: string, envelope: (source: string, r: OutboxRow) => unknown, eventIds?: string[]) {
  const busy = running.get(ctx) ?? new Set<string>();
  running.set(ctx, busy);
  if (busy.has(id)) conflict('eco.peer_busy', 'This peer already has a sync or recovery in progress');
  busy.add(id);
  try { return await pushPeerOnce(ctx, id, source, envelope, eventIds); }
  finally { busy.delete(id); }
}
async function pushPeerOnce(ctx: Ctx, id: string, source: string, envelope: (source: string, r: OutboxRow) => unknown, eventIds?: string[]) {
  const p = (await ctx.db.get<PeerRow>('SELECT * FROM eco_peer WHERE id = ?', [id])) ?? notFound('eco_peer', id);
  const report = { peer: p.name, pushed: 0, skipped: 0, parked: 0, error: undefined as string | undefined };
  if (!p.active) return { ...report, error: 'inactive' };
  const retryRows = eventIds ? await ctx.db.all<OutboxRow>(`SELECT o.* FROM eco_outbox o JOIN eco_ack a ON a.event_id = o.id WHERE a.consumer = ? AND a.status = 'parked' AND o.id IN (${eventIds.map(() => '?').join(',')}) ORDER BY o.seq`, [p.consumer, ...eventIds]) : null;
  if (retryRows && retryRows.length !== eventIds!.length) conflict('eco.retry_not_parked', 'Every requested event must be parked for this peer');
  const wanted = p.types ? new Set(p.types.split(' ')) : null;
  try {
    for (;;) {
      const rows = retryRows ?? await ctx.db.all<OutboxRow>('SELECT * FROM eco_outbox WHERE seq > ? ORDER BY seq LIMIT ?', [p.cursor, PAGE]);
      if (!rows.length) break;
      const send = rows.filter((r) => !wanted || wanted.has(r.type));
      let results: { id?: string; result: string; code?: string; message?: string }[] = [];
      if (send.length) {
        for (const ev of send) {
        const wo = JSON.parse(ev.data).work_order?.id;
        const held = wo && await ctx.db.get(`SELECT 1 FROM eco_outbox o JOIN eco_ack a ON a.event_id = o.id WHERE a.consumer = ? AND a.status = 'parked' AND o.seq < ? AND json_extract(o.data, '$.work_order.id') = ? LIMIT 1`, [p.consumer, ev.seq, wo]);
        if (held) { results.push({ result: 'rejected', code: 'eco.prerequisite_parked', message: 'Recover the earlier work-order fact first' }); continue; }
        const key = open(p.key_sealed), text = JSON.stringify({ events: [envelope(source, ev)] });
        const res = await http.current(trim(p.url) + '/eco/v1/inbox', {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-eco-key': key, ...signatureHeaders(key, 'POST', '/eco/v1/inbox', text) }, body: text,
        });
        const body = (await res.json().catch(() => null)) as { results?: typeof results; error?: unknown } | null;
        if (res.status >= 400) throw new Error(`${p.name} answered ${res.status}: ${JSON.stringify(body?.error ?? body).slice(0, 200)}`);
        const received = body?.results ?? [];
        if (received.length !== 1) throw new Error(`${p.name} answered ${received.length} results for one event`);
        if (received[0]?.id !== ev.id) throw new Error(`${p.name} answered for a different event`);
        results.push(received[0]!);
        const r = received[0]!;
        const status = OK.has(r.result) ? 'applied' : r.code === 'eco.not_accepted' ? 'skipped' : 'parked';
        await ctx.db.run(`INSERT INTO eco_ack (event_id, consumer, status, code, message, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(event_id, consumer) DO UPDATE SET status=excluded.status, code=excluded.code, message=excluded.message, updated_at=excluded.updated_at`, [ev.id, p.consumer, status, r.code ?? null, r.message ?? null, ctx.clock.now().toISOString()]);
        }
      }
      const now = ctx.clock.now().toISOString();
      await ctx.db.tx(async (t) => {
        for (let i = 0; i < send.length; i++) {
          const r = results[i]!;
          if (OK.has(r.result)) { report.pushed++; continue; }
          const status = r.code === 'eco.not_accepted' ? 'skipped' : 'parked';
          status === 'skipped' ? report.skipped++ : report.parked++;
          await t.run(`INSERT INTO eco_ack (event_id, consumer, status, code, message, updated_at) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (event_id, consumer) DO UPDATE SET status = excluded.status, code = excluded.code, message = excluded.message, updated_at = excluded.updated_at`,
            [send[i]!.id, p.consumer, status, r.code ?? 'rejected', (r.message ?? 'refused').slice(0, 1000), now]);
        }
        if (retryRows) return;
        p.cursor = rows[rows.length - 1]!.seq;
        await t.run('UPDATE eco_peer SET cursor = ? WHERE id = ?', [p.cursor, p.id]);
      });
      if (retryRows || rows.length < PAGE) break;
    }
    await ctx.db.run('UPDATE eco_peer SET last_ok_at = ?, last_error = NULL WHERE id = ?', [ctx.clock.now().toISOString(), p.id]);
  } catch (e) {
    report.error = (e as Error).message;
    await ctx.db.run('UPDATE eco_peer SET last_error = ? WHERE id = ?', [report.error.slice(0, 500), p.id]);
  }
  return report;
}

export async function pushAll(ctx: Ctx, source: string, envelope: (source: string, r: OutboxRow) => unknown) {
  const out = [];
  for (const p of await ctx.db.all<{ id: string }>('SELECT id FROM eco_peer WHERE active = 1 ORDER BY name')) out.push(await pushPeer(ctx, p.id, source, envelope));
  return out;
}

export function peerRoutes({ http: h, require }: RouteKit, ctx: Ctx, source: string, envelope: (source: string, r: OutboxRow) => unknown) {
  const zUrl = z.string().max(300).regex(/^https?:\/\/[^\s/]+(:\d+)?(\/\S*)?$/, 'the full address, e.g. http://192.168.1.20:4800');
  h.get('/api/eco/peers', async (req) => {
    require(req, 'eco.peers.manage');
    return (await ctx.db.all<PeerRow>('SELECT * FROM eco_peer ORDER BY name')).map(view);
  });
  h.post('/api/eco/peers', async (req) => {
    require(req, 'eco.peers.manage');
    const i = z.object({ name: z.string().regex(/^[A-Za-z0-9._-]{2,60}$/), url: zUrl, key: z.string().min(8).max(300), consumer: z.string().min(2).max(60).default('gmes'),
      types: z.array(z.string().max(100)).max(50).nullish(), fromStart: z.boolean().default(true) }).parse(req.body);
    if (await ctx.db.get('SELECT 1 FROM eco_peer WHERE name = ?', [i.name])) conflict('eco.peer_exists', `a peer named ${i.name} exists`);
    const id = ctx.clock.newId();
    const cursor = i.fromStart ? 0 : ((await ctx.db.get<{ s: number | null }>('SELECT MAX(seq) s FROM eco_outbox'))!.s ?? 0);
    await ctx.db.run('INSERT INTO eco_peer (id, name, url, key_sealed, consumer, types, cursor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, i.name, trim(i.url), seal(i.key), i.consumer, i.types?.length ? i.types.join(' ') : null, cursor, ctx.clock.now().toISOString()]);
    return { id };
  });
  h.put('/api/eco/peers/:id', async (req) => {
    require(req, 'eco.peers.manage');
    const { id } = req.params as { id: string };
    const i = z.object({ url: zUrl.optional(), key: z.string().min(8).max(300).optional(), active: z.boolean().optional(), types: z.array(z.string().max(100)).max(50).nullish() }).parse(req.body);
    const p = (await ctx.db.get<PeerRow>('SELECT * FROM eco_peer WHERE id = ?', [id])) ?? notFound('eco_peer', id);
    await ctx.db.run('UPDATE eco_peer SET url = ?, key_sealed = ?, active = ?, types = ? WHERE id = ?', [
      i.url ? trim(i.url) : p.url, i.key ? seal(i.key) : p.key_sealed, i.active === undefined ? p.active : i.active ? 1 : 0,
      i.types === undefined ? p.types : i.types?.length ? i.types.join(' ') : null, id]);
    return { ok: true };
  });
  h.delete('/api/eco/peers/:id', async (req) => {
    require(req, 'eco.peers.manage');
    const { id } = req.params as { id: string };
    if (!(await ctx.db.run('DELETE FROM eco_peer WHERE id = ?', [id])).changes) notFound('eco_peer', id);
    return { ok: true };
  });
  h.post('/api/eco/peers/:id/push', async (req) => {
    require(req, 'eco.peers.manage');
    return pushPeer(ctx, (req.params as { id: string }).id, source, envelope);
  });
  h.post('/api/eco/peers/:id/retry-parked', async (req) => {
    const actor = require(req, 'eco.peers.manage');
    const { id } = req.params as { id: string };
    const input = z.object({ eventIds: z.array(z.string().min(1).max(100)).min(1).max(200), reason: z.string().trim().min(3).max(500) }).parse(req.body);
    if (new Set(input.eventIds).size !== input.eventIds.length) conflict('eco.retry_duplicates', 'Choose each event once');
    await ctx.db.tx((t) => ctx.services.get('sys').audit(t, actor.name, 'eco.retry_parked.request', id, input));
    const result = await pushPeer(ctx, id, source, envelope, input.eventIds);
    await ctx.db.tx((t) => ctx.services.get('sys').audit(t, actor.name, 'eco.retry_parked.result', id, result));
    return result;
  });
  h.post('/api/eco/push', async (req) => {
    require(req, 'eco.peers.manage');
    return { peers: await pushAll(ctx, source, envelope) };
  });
}
