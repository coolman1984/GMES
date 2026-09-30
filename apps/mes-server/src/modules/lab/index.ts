import { z } from 'zod';
import { laborId } from '@eco/contracts';
import { localInstant, productionDate } from '../../kernel/clock.js';
import type { Db } from '../../kernel/db.js';
import { fail } from '../../kernel/errors.js';
import type { AppModule, Ctx } from '../../kernel/modules.js';

/**
 * Labour facts to HR (plan 20-GMES WP-G6, flow F8): for each person and production day, how many minutes were spent on which
 * line and station. Evidence, not a timesheet: the day's minutes come from HR (attendance worked minutes, else the planned paid
 * minutes) and are SPLIT in proportion to the person's bookings of that day (production facts and scans that carry their
 * person id). Nothing is invented: a person with no minutes from HR, or no bookings, has no labour fact. A recompute that
 * changes a figure is a newer version of the same snapshot.
 */
export const labMigration = {
  id: '001_labour',
  up: `
    CREATE TABLE lab_day (
      id              TEXT PRIMARY KEY,           -- UUIDv5(company, "gmes:labor:<employee code>:<date>")
      employee_id     TEXT NOT NULL,
      production_date TEXT NOT NULL,
      version         INTEGER NOT NULL,
      total_minutes   INTEGER NOT NULL,
      entries         TEXT NOT NULL,
      shift_code      TEXT,
      closed_at       TEXT NOT NULL
    );
    CREATE INDEX lab_day_date ON lab_day(production_date);
  `,
};

/** Splits `total` over the weights exactly (largest remainder, ties by key): the parts always add up to `total`. */
export function splitMinutes(weights: Map<string, number>, total: number): Map<string, number> {
  const sum = [...weights.values()].reduce((a, b) => a + b, 0);
  const out = new Map<string, number>();
  if (total <= 0 || sum <= 0) return out;
  const keys = [...weights.keys()].sort();
  let given = 0;
  const rest: { key: string; frac: number }[] = [];
  for (const k of keys) {
    const share = Math.floor((weights.get(k)! * total) / sum);
    out.set(k, share);
    given += share;
    rest.push({ key: k, frac: (weights.get(k)! * total) % sum });
  }
  rest.sort((a, b) => b.frac - a.frac || (a.key < b.key ? -1 : 1));
  for (let i = 0; given < total; i = (i + 1) % rest.length) { out.set(rest[i]!.key, out.get(rest[i]!.key)! + 1); given++; }
  return new Map([...out].filter(([, v]) => v > 0));
}

interface Entry { line: string; station?: string; minutes: number }

/** Computes and publishes the labour facts of one production day. Idempotent: an unchanged figure publishes nothing. */
export async function closeDay(ctx: Ctx, date: string): Promise<{ date: string; people: number; published: number }> {
  return ctx.db.tx(async (t) => {
    // bookings of the day by person: production facts (their line comes from the work order) and unit events
    const w = new Map<string, Map<string, number>>();
    const add = (person: string, line: string | null, station: string | null) => {
      if (!line) return;
      const key = `${line}|${station ?? ''}`;
      const m = w.get(person) ?? new Map<string, number>();
      m.set(key, (m.get(key) ?? 0) + 1);
      w.set(person, m);
    };
    for (const r of await t.all<{ person_id: string; line_code: string | null; station_code: string | null }>(
      `SELECT l.person_id, o.line_code, l.station_code FROM exe_ledger l JOIN exe_work_order o ON o.id = l.work_order_id
       WHERE l.production_date = ? AND l.person_id IS NOT NULL AND l.txn_type IN ('CONSUME', 'COMPLETE', 'SCRAP')`, [date])) add(r.person_id, r.line_code, r.station_code);
    for (const r of await t.all<{ person_id: string; line_code: string | null; station: string | null }>(
      `SELECT person_id, line_code, station FROM trk_event WHERE production_date = ? AND person_id IS NOT NULL`, [date]).catch(() => [])) add(r.person_id, r.line_code, r.station);

    let published = 0;
    for (const [person, weights] of [...w].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const emp = await t.get<{ id: string; code: string }>('SELECT id, code FROM mdm_employee WHERE id = ?', [person]);
      if (!emp) continue;
      const att = await t.get<{ worked_minutes: number | null; shift_code: string | null }>('SELECT worked_minutes, shift_code FROM mdm_attendance_day WHERE employee_id = ? AND work_date = ?', [emp.id, date]);
      const sch = await t.get<{ paid_minutes: number; status: string; shift_code: string | null }>('SELECT paid_minutes, status, shift_code FROM mdm_schedule_day WHERE employee_id = ? AND work_date = ?', [emp.id, date]);
      const minutes = Math.min(1440, att?.worked_minutes ? att.worked_minutes : sch && sch.status === 'work' ? sch.paid_minutes : 0);
      const parts = splitMinutes(weights, minutes);
      if (!parts.size) continue;
      const entries: Entry[] = [...parts].map(([k, m]) => { const [line, station] = k.split('|'); return { line: line!, ...(station ? { station } : {}), minutes: m }; });
      const total = entries.reduce((a, e) => a + e.minutes, 0);
      const shift = att?.shift_code ?? sch?.shift_code ?? null;
      const id = laborId(ctx.config.companyId, emp.code, date);
      const prev = await t.get<{ version: number; entries: string; total_minutes: number }>('SELECT version, entries, total_minutes FROM lab_day WHERE id = ?', [id]);
      const json = JSON.stringify(entries);
      if (prev && prev.entries === json && prev.total_minutes === total) continue;
      const version = (prev?.version ?? 0) + 1;
      await t.run(`INSERT INTO lab_day (id, employee_id, production_date, version, total_minutes, entries, shift_code, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET version = excluded.version, total_minutes = excluded.total_minutes, entries = excluded.entries, shift_code = excluded.shift_code, closed_at = excluded.closed_at`,
        [id, emp.id, date, version, total, json, shift, ctx.clock.now().toISOString()]);
      await ctx.services.get('eco').publish(t, {
        type: 'mes.labor_day.v1', subject: `labor_day/${id}`, correlation: `labor_day/${id}`,
        data: { id, version, origin: { app: 'gmes', type: 'labor_day', key: `${emp.code}:${date}` }, employee: { id: emp.id, code: emp.code }, production_date: date, ...(shift ? { shift } : {}), entries, total_minutes: total },
      });
      published++;
    }
    return { date, people: w.size, published };
  });
}

/** Closes the recent days whose closing time has passed (a production day ends 26 hours after it starts). */
export async function closeDueDays(ctx: Ctx): Promise<void> {
  const now = ctx.clock.now();
  const today = productionDate(now, ctx.config.timeZone, ctx.config.productionDayStart);
  for (let back = 1; back <= 7; back++) {
    const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - back);
    const day = d.toISOString().slice(0, 10);
    const closesAt = localInstant(day, ctx.config.productionDayStart, ctx.config.timeZone) + 26 * 3_600_000;
    if (now.getTime() < closesAt) continue;
    await closeDay(ctx, day);
  }
}

export function startLabour(ctx: Ctx, everyMs = 900_000): () => void {
  let busy = false;
  const timer = setInterval(() => { if (busy) return; busy = true; closeDueDays(ctx).catch(() => undefined).finally(() => { busy = false; }); }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}

const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const labModule: AppModule = {
  id: 'lab',
  dependsOn: ['system', 'mdm', 'exe', 'eco'],
  scopes: ['lab.read', 'lab.run'],
  migrations: [labMigration],
  routes({ http, require }, ctx) {
    http.post('/api/labor/close-day', async (req) => {
      require(req, 'lab.run');
      const { date } = z.object({ date: zDate }).parse(req.body);
      const today = productionDate(ctx.clock.now(), ctx.config.timeZone, ctx.config.productionDayStart);
      if (date > today) fail('labor.future', 'a day that has not started cannot be closed');
      return closeDay(ctx, date);
    });
    http.get('/api/labor', async (req) => {
      require(req, 'lab.read');
      const q = z.object({ date: zDate }).parse(req.query);
      const rows = await ctx.db.all<{ code: string; display_name: string | null; version: number; total_minutes: number; entries: string; shift_code: string | null }>(
        `SELECT e.code, e.display_name, d.version, d.total_minutes, d.entries, d.shift_code FROM lab_day d JOIN mdm_employee e ON e.id = d.employee_id WHERE d.production_date = ? ORDER BY e.code`, [q.date]);
      return rows.map((r) => ({ employee: r.code, name: r.display_name, shift: r.shift_code, version: r.version, total_minutes: r.total_minutes, entries: JSON.parse(r.entries) as Entry[] }));
    });
    http.get('/api/labor/by-line', async (req) => {
      require(req, 'lab.read');
      const q = z.object({ from: zDate, to: zDate }).parse(req.query);
      const rows = await ctx.db.all<{ entries: string; production_date: string }>('SELECT entries, production_date FROM lab_day WHERE production_date BETWEEN ? AND ?', [q.from, q.to]);
      const sum = new Map<string, number>();
      for (const r of rows) for (const e of JSON.parse(r.entries) as Entry[]) sum.set(`${r.production_date}|${e.line}`, (sum.get(`${r.production_date}|${e.line}`) ?? 0) + e.minutes);
      return [...sum].sort().map(([k, minutes]) => { const [date, line] = k.split('|'); return { date, line, minutes, hours: Math.round((minutes / 60) * 10) / 10 }; });
    });
  },
};

export type { Db };
