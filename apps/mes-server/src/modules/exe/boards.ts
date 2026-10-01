import { formatQty } from '@eco/contracts';
import { z } from 'zod';
import type { Stoppage } from '../../contracts/services.js';
import { localHour, productionDate } from '../../kernel/clock.js';
import { fail } from '../../kernel/errors.js';
import type { Ctx, RouteKit } from '../../kernel/modules.js';

/**
 * The figures of the boards (the start page and the line board DSH5010), all read from the ledger.
 * Nothing is estimated: OEE comes from the OEE module (null parts are shown as "—");
 * the hourly plan exists only when the line has a capacity per shift (8 hours).
 */
const zDay = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
const qty = (n: number) => Number(formatQty(n));

export function boardRoutes({ http, require }: RouteKit, ctx: Ctx) {
  const today = () => productionDate(ctx.clock.now(), ctx.config.timeZone, ctx.config.productionDayStart);
  const stops = async (q: { date?: string; line?: string; openOnly?: boolean }): Promise<Stoppage[]> =>
    ctx.services.has('oee') ? ctx.services.get('oee').stoppages(q) : [];

  // the running work order of a line: the released one with the most recent booking, else the newest released
  const current = async (line: string) => ctx.db.get<{ id: string; code: string; item_id: string; planned_qty: number; completed_qty: number; scrapped_qty: number }>(
    `SELECT w.id, w.code, w.item_id, w.planned_qty, w.completed_qty, w.scrapped_qty FROM exe_work_order w WHERE w.line_code = ? AND w.status = 'released'
     ORDER BY COALESCE((SELECT MAX(seq) FROM exe_ledger l WHERE l.work_order_id = w.id), 0) DESC, w.priority, w.production_date, w.code LIMIT 1`, [line]);
  // the order of the day that finished last on a line: the board keeps showing it (and its unit) once nothing runs
  const lastDone = async (line: string, date: string) => ctx.db.get<{ id: string; code: string; item_id: string; planned_qty: number; completed_qty: number; scrapped_qty: number }>(
    `SELECT w.id, w.code, w.item_id, w.planned_qty, w.completed_qty, w.scrapped_qty FROM exe_work_order w
     WHERE w.line_code = ? AND w.status = 'completed' AND EXISTS (SELECT 1 FROM exe_ledger l WHERE l.work_order_id = w.id AND l.production_date = ?)
     ORDER BY (SELECT MAX(seq) FROM exe_ledger l WHERE l.work_order_id = w.id) DESC LIMIT 1`, [line, date]);
  const woView = async (w: Awaited<ReturnType<typeof current>>) => {
    if (!w) return null;
    const i = await ctx.services.get('mdm').item(w.item_id);
    return { id: w.id, code: w.code, item: { code: i.code, name_en: i.name_en, name_ar: i.name_ar, uom: i.base_uom, tracking: i.tracking },
      planned: qty(w.planned_qty), completed: qty(w.completed_qty), scrapped: qty(w.scrapped_qty) };
  };

  http.get('/api/boards/plant', async (req) => {
    require(req, 'exe.orders.read');
    const date = zDay.parse(req.query).date ?? today();
    const mdm = ctx.services.get('mdm');
    const lines = (await mdm.plantNodes('line')).filter((l) => l.active);
    const made = await ctx.db.all<{ line: string | null; kind: string; q: number }>(
      `SELECT w.line_code line, l.txn_type kind, SUM(l.qty) q FROM exe_ledger l JOIN exe_work_order w ON w.id = l.work_order_id
       WHERE l.production_date = ? AND l.txn_type IN ('COMPLETE', 'SCRAP') GROUP BY w.line_code, l.txn_type`, [date]);
    const planned = await ctx.db.get<{ q: number | null; n: number }>(`SELECT SUM(planned_qty) q, COUNT(*) n FROM exe_work_order WHERE production_date = ?`, [date]);
    const open = await ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM exe_work_order WHERE status = 'released'`);
    const openStops = await stops({ openOnly: true });
    const dayStops = await stops({ date });
    const sum = (kind: string, line?: string) => made.filter((m) => m.kind === kind && (line === undefined || m.line === line)).reduce((a, m) => a + m.q, 0);
    return {
      date,
      good: qty(sum('COMPLETE')), scrap: qty(sum('SCRAP')), planned: qty(planned!.q ?? 0), ordersOfDay: planned!.n, openOrders: open!.n,
      stoppages: { open: openStops.length, minutesToday: dayStops.reduce((a, s) => a + s.minutes, 0) },
      lines: await Promise.all(lines.map(async (l) => {
        const stop = openStops.find((s) => s.line === l.code) ?? null;
        const wo = await woView(await current(l.code));
        const oee = ctx.services.has('oee') ? await ctx.services.get('oee').oee({ line: l.code, date }) : null;
        return { code: l.code, name_en: l.name_en, name_ar: l.name_ar, state: stop ? 'down' : wo ? 'run' : 'idle', stop, workOrder: wo,
          good: qty(sum('COMPLETE', l.code)), scrap: qty(sum('SCRAP', l.code)),
          oee: oee && { oee: oee.oee, availability: oee.availability, performance: oee.performance, quality: oee.quality } };
      })),
    };
  });

  http.get('/api/boards/line/:code', async (req) => {
    require(req, 'exe.orders.read');
    const { code } = req.params as { code: string };
    const date = zDay.parse(req.query).date ?? today();
    const line = await ctx.services.get('mdm').plantNode(code);
    if (!line || line.type !== 'line') return fail('line.unknown', `${code} is not a line of the plant model`);
    const lines = await ctx.db.all<{ kind: string; qty: number; occurred_at: string }>(
      `SELECT l.txn_type kind, l.qty, l.occurred_at FROM exe_ledger l JOIN exe_work_order w ON w.id = l.work_order_id
       WHERE w.line_code = ? AND l.production_date = ? AND l.txn_type IN ('COMPLETE', 'SCRAP')`, [code, date]);
    // 24 buckets starting at the hour the production day starts
    const start = Number(ctx.config.productionDayStart.slice(0, 2));
    const hours = Array.from({ length: 24 }, (_, i) => ({ hour: (start + i) % 24, good: 0, scrap: 0 }));
    for (const l of lines) {
      const b = hours[(localHour(new Date(l.occurred_at), ctx.config.timeZone) - start + 24) % 24]!;
      if (l.kind === 'COMPLETE') b.good += l.qty; else b.scrap += l.qty;
    }
    const good = lines.filter((l) => l.kind === 'COMPLETE').reduce((a, l) => a + l.qty, 0);
    const scrap = lines.filter((l) => l.kind === 'SCRAP').reduce((a, l) => a + l.qty, 0);
    const planned = await ctx.db.get<{ q: number | null }>(`SELECT SUM(planned_qty) q FROM exe_work_order WHERE line_code = ? AND production_date = ?`, [code, date]);
    const dayStops = await stops({ date, line: code });
    const openStop = (await stops({ line: code, openOnly: true }))[0] ?? null;
    return {
      date, line: { code: line.code, name_en: line.name_en, name_ar: line.name_ar, capacityPerShift: line.capacity_per_shift },
      planPerHour: line.capacity_per_shift ? Math.round(line.capacity_per_shift / 8) : null,
      hours: hours.map((h) => ({ hour: h.hour, good: qty(h.good), scrap: qty(h.scrap) })),
      good: qty(good), scrap: qty(scrap), planned: qty(planned!.q ?? 0),
      state: openStop ? 'down' : 'run', openStop, stoppages: dayStops, workOrder: await woView(await current(code)),
      lastOrder: await woView(await lastDone(code, date)),
      oee: ctx.services.has('oee') ? await ctx.services.get('oee').oee({ line: code, date }) : null,
    };
  });
}
