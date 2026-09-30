import { productionDate } from '../../kernel/clock.js';
import type { Ctx, RouteKit } from '../../kernel/modules.js';

/**
 * The live view (plan 20-GMES WP-G8, flow F9): `GET /eco/v1/live?lines=FA-1,FA-2&k=<key>` is a server-sent-events stream
 * that Space Planner's BROWSER page opens (an EventSource cannot send headers, so the read key travels in `k`; only this
 * route accepts it there). It says what each station of the requested lines is doing now, and the day's output per line.
 * Read-only: it never writes and never computes money. Only origins on the allow-list (GMES_LIVE_ORIGINS, default the local
 * Space Planner) may read it from a page.
 */
const DEFAULT_ORIGINS = ['http://127.0.0.1:4600', 'http://localhost:4600'];
const allowed = () => (process.env.GMES_LIVE_ORIGINS ? process.env.GMES_LIVE_ORIGINS.split(',').map((x) => x.trim()).filter(Boolean) : DEFAULT_ORIGINS);

type State = 'running' | 'stopped' | 'starved';

export async function liveSnapshot(ctx: Ctx, lines: string[]) {
  const day = productionDate(ctx.clock.now(), ctx.config.timeZone, ctx.config.productionDayStart);
  const nodes = await ctx.db.all<{ code: string; type: string; parent: string | null }>(
    `SELECT n.code, n.type, p.code parent FROM mdm_plant_node n LEFT JOIN mdm_plant_node p ON p.id = n.parent_id WHERE n.active = 1 AND n.type IN ('line', 'station') ORDER BY n.code`);
  const wanted = new Set(lines.length ? lines : nodes.filter((n) => n.type === 'line').map((n) => n.code));
  const stops = ctx.services.has('oee') ? await ctx.services.get('oee').stoppages({ openOnly: true }) : [];
  const stations: { station: string; line: string; state: State; since?: string; reason?: string }[] = [];
  const output: { line: string; good: number; scrap: number; day: string }[] = [];
  for (const line of nodes.filter((n) => n.type === 'line' && wanted.has(n.code))) {
    const running = !!(await ctx.db.get("SELECT 1 FROM exe_work_order WHERE line_code = ? AND status = 'released'", [line.code]));
    const lineStop = stops.find((s) => s.line === line.code && !s.station);
    for (const st of nodes.filter((n) => n.type === 'station' && n.parent === line.code)) {
      const stop = stops.find((s) => s.station === st.code) ?? lineStop;
      stations.push(stop ? { station: st.code, line: line.code, state: 'stopped', since: stop.startedAt, reason: stop.reason } : { station: st.code, line: line.code, state: running ? 'running' : 'starved' });
    }
    const o = await ctx.db.get<{ good: number | null; scrap: number | null }>(
      `SELECT SUM(CASE WHEN l.txn_type = 'COMPLETE' THEN l.qty ELSE 0 END) good, SUM(CASE WHEN l.txn_type = 'SCRAP' THEN l.qty ELSE 0 END) scrap
       FROM exe_ledger l JOIN exe_work_order w ON w.id = l.work_order_id WHERE w.line_code = ? AND l.production_date = ?`, [line.code, day]);
    output.push({ line: line.code, good: (o?.good ?? 0) / 1000, scrap: (o?.scrap ?? 0) / 1000, day });
  }
  return { stations, output };
}

export function liveRoutes({ http, require }: RouteKit, ctx: Ctx) {
  http.get('/eco/v1/live', async (req, reply) => {
    require(req, 'eco.live.read');
    const origin = req.headers.origin;
    if (origin && !allowed().includes(origin)) return reply.status(403).send({ error: { code: 'live.origin', message: `${origin} may not read the live view` } });
    const lines = String((req.query as { lines?: string }).lines ?? '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no',
      ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
    });
    const last = new Map<string, string>();
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    let busy = false;
    const tick = async (first: boolean) => {
      if (busy) return;
      busy = true;
      try {
        const snap = await liveSnapshot(ctx, lines);
        for (const s of snap.stations) { const k = 'st:' + s.station, v = JSON.stringify(s); if (first || last.get(k) !== v) { last.set(k, v); send('station.state', s); } }
        for (const o of snap.output) { const k = 'ln:' + o.line, v = JSON.stringify(o); if (first || last.get(k) !== v) { last.set(k, v); send('line.output', o); } }
      } catch { /* the next tick tries again */ } finally { busy = false; }
    };
    await tick(true);
    const poll = setInterval(() => void tick(false), 2000);
    const beat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
    req.raw.on('close', () => { clearInterval(poll); clearInterval(beat); });
  });
}
