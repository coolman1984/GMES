import type { OeeFigures, ProdShift, Stoppage } from '../../contracts/services.js';
import { shiftWindow } from '../../kernel/clock.js';
import type { Db } from '../../kernel/db.js';
import type { Ctx } from '../../kernel/modules.js';

/**
 * OEE as ISO 22400 defines it, from facts the system already holds — nothing typed in twice, nothing invented:
 *
 *   planned busy time  = the net time of the production shifts the line WORKED that day (a shift with a work order or output),
 *                        up to now for a shift still running, minus planned stops (breaks, meetings)
 *   run time           = planned busy time − unplanned downtime (the stoppages of the line)
 *   Availability       = run time / planned busy time
 *   Performance        = Σ (units × ideal cycle time) / run time; the ideal cycle of a unit is the slowest operation of its
 *                        routing (the line's pace), else the line's capacity per shift over 480 minutes
 *   Quality            = good units / (good + scrap)          (from the production ledger)
 *   OEE                = A × P × Q
 * When no ideal cycle is known for what ran, Performance and OEE are null ("—"), never guessed.
 */
const DEFAULT_SHIFTS: ProdShift[] = [
  { code: 'A', name_en: 'A', name_ar: 'A', start_at: '07:00', end_at: '15:00', break_min: 0, active: 1, version: 1 },
  { code: 'B', name_en: 'B', name_ar: 'B', start_at: '15:00', end_at: '23:00', break_min: 0, active: 1, version: 1 },
  { code: 'C', name_en: 'C', name_ar: 'C', start_at: '23:00', end_at: '07:00', break_min: 0, active: 1, version: 1 },
];

export async function oeeOf(ctx: Ctx, db: Db, stoppages: (q: { date?: string; line?: string }) => Promise<Stoppage[]>,
  q: { line: string; date: string; shift?: string }): Promise<OeeFigures> {
  const now = ctx.clock.now().getTime();
  const eng = ctx.services.has('eng') ? ctx.services.get('eng') : null;
  let shifts = eng ? await eng.shifts() : [];
  if (!shifts.length) shifts = DEFAULT_SHIFTS;
  // what the line did that day: work orders planned on it (by shift) and output booked on it (by instant)
  const planned = new Set((await db.all<{ s: string | null }>('SELECT DISTINCT shift_code s FROM exe_work_order WHERE line_code = ? AND production_date = ?',
    [q.line, q.date])).map((r) => r.s).filter(Boolean) as string[]);
  const booked = await db.all<{ item_id: string; routing_id: string | null; kind: string; qty: number; at: string }>(`SELECT w.item_id, w.routing_id, l.txn_type kind, l.qty, l.occurred_at at
    FROM exe_ledger l JOIN exe_work_order w ON w.id = l.work_order_id WHERE w.line_code = ? AND l.production_date = ? AND l.txn_type IN ('COMPLETE', 'SCRAP')`, [q.line, q.date]);
  const reasons = new Map((await db.all<{ code: string; planned: number; loss: string }>('SELECT code, planned, loss FROM oee_reason')).map((r) => [r.code, r]));
  const stops = await stoppages({ date: q.date, line: q.line });
  // a shift counts when the line worked in it: a work order planned for it, or output booked inside its window
  const windows = shifts.filter((s) => s.active !== 0).map((s) => ({ s, w: shiftWindow(q.date, s, ctx.config.timeZone, ctx.config.productionDayStart) }))
    .filter(({ s, w }) => planned.has(s.code) || booked.some((b) => { const t = Date.parse(b.at); return t >= w.from && t < w.to; }));
  const worked = windows.map((x) => x.s.code);
  const chosen = windows.filter((x) => !q.shift || x.s.code === q.shift);
  let plannedMin = 0, plannedStops = 0, downtime = 0;
  const losses: Record<string, number> = {};
  for (const { s, w } of chosen) {
    const end = Math.min(w.to, now);
    if (end <= w.from) continue;
    const len = (end - w.from) / 60000;
    plannedMin += len - s.break_min * (len / ((w.to - w.from) / 60000));
    // stops overlap (a station stops while its line is stopped): time is counted once, as the union of the intervals;
    // a planned stop (a break) wins over an unplanned one at the same moment
    const planned: [number, number][] = [], unplanned: [number, number][] = [];
    for (const st of stops) {
      const a = Math.max(Date.parse(st.startedAt), w.from), b = Math.min(st.endedAt ? Date.parse(st.endedAt) : now, end);
      if (b <= a) continue;
      const r = reasons.get(st.reason);
      (r?.planned ? planned : unplanned).push([a, b]);
      const k = r?.loss ?? 'other';
      losses[k] = (losses[k] ?? 0) + (b - a) / 60000;
    }
    const P = union(planned);
    plannedStops += length(P) / 60000;
    downtime += (length(union(unplanned)) - length(intersect(union(unplanned), P))) / 60000;
  }
  const busy = Math.max(0, plannedMin - plannedStops);
  const run = Math.max(0, busy - downtime);
  // output inside the chosen shifts, grouped by what was made (for its ideal cycle time)
  const inChosen = (at: string) => { const t = Date.parse(at); return chosen.some(({ w }) => t >= w.from && t < w.to); };
  const groups = new Map<string, { item_id: string; routing_id: string | null; kind: string; qty: number }>();
  for (const b of booked.filter((x) => !q.shift || inChosen(x.at))) {
    const k = `${b.item_id}|${b.routing_id}|${b.kind}`;
    const g = groups.get(k) ?? { item_id: b.item_id, routing_id: b.routing_id, kind: b.kind, qty: 0 };
    g.qty += b.qty;
    groups.set(k, g);
  }
  const out = [...groups.values()];
  const line = await ctx.services.get('mdm').plantNode(q.line, db);
  let good = 0, scrap = 0, ideal = 0, idealKnown = true;
  for (const o of out) {
    const units = o.qty / 1000;
    if (o.kind === 'COMPLETE') good += units; else scrap += units;
    let cycle: number | null = null;   // minutes per unit
    if (o.routing_id && eng) {
      const r = await eng.routing(o.routing_id, db);
      const slow = Math.max(0, ...r.operations.map((x) => x.cycle_ms ?? 0));
      if (slow) cycle = slow / 60000;
    }
    if (cycle === null && line?.capacity_per_shift) cycle = 480 / line.capacity_per_shift;
    if (cycle === null) idealKnown = false; else ideal += units * cycle;
  }
  const total = good + scrap;
  const A = busy > 0 ? run / busy : null;
  const P = run > 0 && idealKnown && total > 0 ? ideal / run : null;
  const Q = total > 0 ? good / total : null;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const pct = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 10);
  return {
    line: q.line, date: q.date, shift: q.shift ?? null, shiftsWorked: worked,
    plannedMin: r1(plannedMin), plannedStopMin: r1(plannedStops), busyMin: r1(busy), downtimeMin: r1(downtime), runMin: r1(run),
    good, scrap, idealMin: idealKnown ? r1(ideal) : null,
    availability: pct(A), performance: pct(P), quality: pct(Q), oee: A !== null && P !== null && Q !== null ? pct(A * Math.min(P, 1) * Q) : null,
    losses: Object.fromEntries(Object.entries(losses).map(([k, v]) => [k, r1(v)])),
    speedLossMin: idealKnown && run > 0 ? r1(Math.max(0, run - ideal)) : null,
  };
}

function union(xs: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of [...xs].sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b); else out.push([a, b]);
  }
  return out;
}
function intersect(xs: [number, number][], ys: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of xs) for (const [c, d] of ys) { const f = Math.max(a, c), t = Math.min(b, d); if (t > f) out.push([f, t]); }
  return out;
}
const length = (xs: [number, number][]) => xs.reduce((n, [a, b]) => n + (b - a), 0);
