import { z } from 'zod';
import type { OeeService, Stoppage } from '../../contracts/services.js';
import { productionDate } from '../../kernel/clock.js';
import { runCommand } from '../../kernel/commands.js';
import type { Db } from '../../kernel/db.js';
import { conflict, fail, notFound } from '../../kernel/errors.js';
import type { AppModule } from '../../kernel/modules.js';
import { oeeOf } from './calc.js';

/**
 * Downtime: a line (or one of its stations) stops for a reason and later runs again.
 *
 * Stored as append-only FACTS (START, END), never as a row that is updated: a stoppage is what those facts say.
 * One open stoppage per line/station at a time. The reasons are the plant's own list (oee_reason, screen SYS9040):
 * each belongs to a loss category of ISO 22400 and says whether it is PLANNED (a break: not a loss of availability)
 * or not. A reason in use is never deleted, only deactivated, so old stoppages keep their meaning.
 * OEE (calc.ts) is computed from these facts, the production shifts, the routings' cycle times and the ledger.
 */
export const LOSSES = ['breakdown', 'setup', 'material', 'quality', 'planned', 'other'] as const;
const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

interface EventRow { seq: number; kind: 'START' | 'END'; stoppage_id: string; line_code: string; station_code: string | null; reason_code: string; at: string; by_user: string; production_date: string }

async function stoppagesOf(db: Db, now: Date, q: { date?: string; line?: string; openOnly?: boolean; id?: string }): Promise<Stoppage[]> {
  const where: string[] = [];
  const params: string[] = [];
  if (q.id) { where.push('stoppage_id = ?'); params.push(q.id); }
  if (q.date) { where.push(`stoppage_id IN (SELECT stoppage_id FROM oee_event WHERE kind = 'START' AND production_date = ?)`); params.push(q.date); }
  if (q.line) { where.push('line_code = ?'); params.push(q.line); }
  const rows = await db.all<EventRow>(`SELECT * FROM oee_event ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY seq`, params);
  const byId = new Map<string, Stoppage>();
  for (const r of rows) {
    if (r.kind === 'START') {
      byId.set(r.stoppage_id, { id: r.stoppage_id, line: r.line_code, station: r.station_code, reason: r.reason_code, productionDate: r.production_date,
        startedAt: r.at, startedBy: r.by_user, endedAt: null, endedBy: null, minutes: 0 });
    } else {
      const s = byId.get(r.stoppage_id);
      if (s) { s.endedAt = r.at; s.endedBy = r.by_user; }
    }
  }
  const out = [...byId.values()].filter((s) => !q.openOnly || !s.endedAt);
  for (const s of out) s.minutes = Math.max(0, Math.round(((s.endedAt ? Date.parse(s.endedAt) : now.getTime()) - Date.parse(s.startedAt)) / 60000));
  return out.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

export const oeeModule: AppModule = {
  id: 'oee',
  dependsOn: ['system', 'mdm'],
  scopes: ['oee.stops.read', 'oee.stops.write', 'oee.reasons.write'],
  migrations: [
    {
      id: '001_stoppages',
      up: `
        CREATE TABLE oee_event (
          seq             INTEGER PRIMARY KEY,
          kind            TEXT NOT NULL CHECK (kind IN ('START', 'END')),
          stoppage_id     TEXT NOT NULL,
          line_code       TEXT NOT NULL,
          station_code    TEXT,
          reason_code     TEXT NOT NULL,
          at              TEXT NOT NULL,
          by_user         TEXT NOT NULL,
          production_date TEXT NOT NULL,
          command_id      TEXT NOT NULL
        );
        CREATE INDEX oee_event_stoppage ON oee_event(stoppage_id);
        CREATE INDEX oee_event_line_day ON oee_event(line_code, production_date);
        CREATE UNIQUE INDEX oee_event_one_end ON oee_event(stoppage_id) WHERE kind = 'END';
        CREATE TRIGGER oee_event_immutable BEFORE UPDATE ON oee_event BEGIN SELECT RAISE(ABORT, 'oee: downtime facts are append-only'); END;
        CREATE TRIGGER oee_event_no_delete BEFORE DELETE ON oee_event BEGIN SELECT RAISE(ABORT, 'oee: downtime facts are append-only'); END;
      `,
    },
    {
      id: '002_reasons',
      up: `
        CREATE TABLE oee_reason (
          code     TEXT PRIMARY KEY CHECK (length(code) BETWEEN 2 AND 24),
          name_en  TEXT NOT NULL,
          name_ar  TEXT NOT NULL,
          loss     TEXT NOT NULL CHECK (loss IN ('breakdown', 'setup', 'material', 'quality', 'planned', 'other')),
          planned  INTEGER NOT NULL DEFAULT 0 CHECK (planned IN (0, 1)),
          active   INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
          version  INTEGER NOT NULL DEFAULT 1
        );
        CREATE TRIGGER oee_reason_no_delete BEFORE DELETE ON oee_reason BEGIN SELECT RAISE(ABORT, 'oee: a stop reason is deactivated, never deleted'); END;
        INSERT INTO oee_reason (code, name_en, name_ar, loss, planned) VALUES
          ('material', 'Material shortage', 'نقص خامات', 'material', 0),
          ('breakdown', 'Breakdown', 'عطل', 'breakdown', 0),
          ('changeover', 'Changeover', 'تغيير موديل', 'setup', 0),
          ('quality', 'Quality problem', 'مشكلة جودة', 'quality', 0),
          ('break', 'Planned break', 'استراحة مخططة', 'planned', 1),
          ('other', 'Other', 'أخرى', 'other', 0);
      `,
    },
  ],

  setup(ctx) {
    const stoppages = (q: { date?: string; line?: string; openOnly?: boolean }) => stoppagesOf(ctx.db, ctx.clock.now(), q);
    const service: OeeService = { stoppages, oee: (q) => oeeOf(ctx, ctx.db, stoppages, q) };
    ctx.services.provide('oee', service);
  },

  routes({ http, require }, ctx) {
    const service = () => ctx.services.get('oee');

    http.get('/api/stop-reasons', async (req) => {
      require(req, 'oee.stops.read');
      return ctx.db.all('SELECT * FROM oee_reason ORDER BY active DESC, loss, code');
    });

    http.put('/api/stop-reasons/:code', async (req) => {
      const caller = require(req, 'oee.reasons.write');
      const { code } = z.object({ code: z.string().regex(/^[a-z0-9_-]{2,24}$/, 'lower-case letters, digits, - and _ (2 to 24)') }).parse(req.params);
      const input = z.object({ commandId: z.string(), name_en: z.string().trim().min(1).max(60), name_ar: z.string().trim().min(1).max(60),
        loss: z.enum(LOSSES), active: z.boolean().default(true), version: z.number().int().optional() }).parse(req.body);
      const { result, replayed } = await runCommand(ctx, caller, { id: input.commandId, type: 'PutStopReason', request: { code, ...input } }, async (t) => {
        const old = await t.get<{ version: number }>('SELECT version FROM oee_reason WHERE code = ?', [code]);
        const planned = input.loss === 'planned' ? 1 : 0;
        if (!old) {
          await t.run('INSERT INTO oee_reason (code, name_en, name_ar, loss, planned, active) VALUES (?, ?, ?, ?, ?, ?)', [code, input.name_en, input.name_ar, input.loss, planned, input.active ? 1 : 0]);
          return { code, version: 1 };
        }
        if (input.version !== undefined && input.version !== old.version) conflict('stale', `stop reason ${code} was changed by someone else; reload it`);
        await t.run('UPDATE oee_reason SET name_en = ?, name_ar = ?, loss = ?, planned = ?, active = ?, version = version + 1 WHERE code = ?',
          [input.name_en, input.name_ar, input.loss, planned, input.active ? 1 : 0, code]);
        return { code, version: old.version + 1 };
      });
      return { ...result, replayed };
    });

    http.get('/api/oee', async (req) => {
      require(req, 'oee.stops.read');
      const q = z.object({ date: zDate.optional(), line: z.string().optional(), shift: z.string().optional() }).parse(req.query);
      const date = q.date ?? productionDate(ctx.clock.now(), ctx.config.timeZone, ctx.config.productionDayStart);
      const mdm = ctx.services.get('mdm');
      const lines = q.line ? [q.line] : (await mdm.plantNodes('line')).filter((l) => l.active).map((l) => l.code);
      if (q.line) { const l = await mdm.plantNode(q.line); if (!l || l.type !== 'line') fail('line.unknown', `${q.line} is not a line of the plant model`); }
      return Promise.all(lines.map((line) => service().oee({ line, date, shift: q.shift || undefined })));
    });

    // OEE of every day in a range (trend), at most 62 days
    http.get('/api/oee/trend', async (req) => {
      require(req, 'oee.stops.read');
      const q = z.object({ from: zDate, to: zDate, line: z.string().min(1) }).parse(req.query);
      const days: string[] = [];
      for (let d = new Date(`${q.from}T12:00:00Z`); d.toISOString().slice(0, 10) <= q.to; d.setUTCDate(d.getUTCDate() + 1)) {
        days.push(d.toISOString().slice(0, 10));
        if (days.length > 62) fail('range.too_long', 'at most 62 days at a time');
      }
      return Promise.all(days.map((date) => service().oee({ line: q.line, date })));
    });

    // downtime Pareto: minutes and count by reason over a range, optionally one line
    http.get('/api/oee/losses', async (req) => {
      require(req, 'oee.stops.read');
      const q = z.object({ from: zDate, to: zDate, line: z.string().optional() }).parse(req.query);
      const rows = await ctx.db.all<{ stoppage_id: string; kind: string; line_code: string; station_code: string | null; reason_code: string; at: string }>(
        `SELECT stoppage_id, kind, line_code, station_code, reason_code, at FROM oee_event WHERE stoppage_id IN
         (SELECT stoppage_id FROM oee_event WHERE kind = 'START' AND production_date BETWEEN ? AND ?) ${q.line ? 'AND line_code = ?' : ''} ORDER BY seq`,
        q.line ? [q.from, q.to, q.line] : [q.from, q.to]);
      const reasons = new Map((await ctx.db.all<{ code: string; name_en: string; name_ar: string; loss: string; planned: number }>('SELECT * FROM oee_reason')).map((r) => [r.code, r]));
      const start = new Map<string, (typeof rows)[number]>();
      const agg = new Map<string, { reason: string; name_en: string; name_ar: string; loss: string; planned: boolean; count: number; minutes: number; lines: Set<string> }>();
      const now = ctx.clock.now().getTime();
      const add = (s: (typeof rows)[number], endAt: number) => {
        const r = reasons.get(s.reason_code);
        const a = agg.get(s.reason_code) ?? { reason: s.reason_code, name_en: r?.name_en ?? s.reason_code, name_ar: r?.name_ar ?? s.reason_code, loss: r?.loss ?? 'other', planned: !!r?.planned, count: 0, minutes: 0, lines: new Set<string>() };
        a.count += 1; a.minutes += Math.max(0, (endAt - Date.parse(s.at)) / 60000); a.lines.add(s.line_code);
        agg.set(s.reason_code, a);
      };
      for (const r of rows) {
        if (r.kind === 'START') start.set(r.stoppage_id, r);
        else { const s = start.get(r.stoppage_id); if (s) { add(s, Date.parse(r.at)); start.delete(r.stoppage_id); } }
      }
      for (const s of start.values()) add(s, now);
      const out = [...agg.values()].map((a) => ({ ...a, minutes: Math.round(a.minutes), lines: [...a.lines].sort() })).sort((a, b) => b.minutes - a.minutes);
      const total = out.filter((a) => !a.planned).reduce((x, a) => x + a.minutes, 0);
      let run = 0;
      return { from: q.from, to: q.to, line: q.line ?? null, unplannedMinutes: total,
        reasons: out.map((a) => { if (!a.planned) run += a.minutes; return { ...a, cumulativePct: a.planned || !total ? null : Math.round((run / total) * 1000) / 10 }; }) };
    });

    http.get('/api/stoppages', async (req) => {
      require(req, 'oee.stops.read');
      const q = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), line: z.string().optional(), open: z.enum(['1', 'true']).optional() }).parse(req.query);
      return stoppagesOf(ctx.db, ctx.clock.now(), { date: q.date, line: q.line || undefined, openOnly: !!q.open });
    });

    http.post('/api/stoppages', async (req) => {
      const caller = require(req, 'oee.stops.write');
      const input = z.object({ commandId: z.string(), line: z.string().trim().min(1), station: z.string().trim().min(1).nullable().optional(), reason: z.string().trim().min(1) }).parse(req.body);
      const { result, replayed } = await runCommand(ctx, caller, { id: input.commandId, type: 'StartStoppage', request: req.body }, async (t) => {
        const mdm = ctx.services.get('mdm');
        const line = await mdm.plantNode(input.line, t);
        if (!line || line.type !== 'line') fail('line.unknown', `${input.line} is not a line of the plant model`);
        if (!line!.active) conflict('line.inactive', `line ${input.line} is inactive`);
        if (input.station) {
          const st = await mdm.plantNode(input.station, t);
          if (!st || st.type !== 'station' || st.parent_id !== line!.id) fail('station.unknown', `${input.station} is not a station of line ${input.line}`);
        }
        const reason = await t.get<{ active: number }>('SELECT active FROM oee_reason WHERE code = ?', [input.reason]);
        if (!reason) fail('stop.reason_unknown', `${input.reason} is not a stop reason of this plant`);
        if (!reason!.active) conflict('stop.reason_inactive', `stop reason ${input.reason} is no longer in use`);
        const open = await stoppagesOf(t, ctx.clock.now(), { line: input.line, openOnly: true });
        const same = open.find((s) => (s.station ?? null) === (input.station ?? null));
        if (same) conflict('stop.already_open', `${input.station ?? input.line} is already stopped (${same.reason}) since ${same.startedAt}`, { stoppageId: same.id });
        const id = ctx.clock.newId();
        const now = ctx.clock.now();
        await t.run(
          `INSERT INTO oee_event (kind, stoppage_id, line_code, station_code, reason_code, at, by_user, production_date, command_id) VALUES ('START', ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, input.line, input.station ?? null, input.reason, now.toISOString(), caller.name, productionDate(now, ctx.config.timeZone, ctx.config.productionDayStart), input.commandId],
        );
        return { id };
      });
      return { ...result, replayed };
    });

    http.post('/api/stoppages/:id/end', async (req) => {
      const caller = require(req, 'oee.stops.write');
      const { id } = req.params as { id: string };
      const input = z.object({ commandId: z.string() }).parse(req.body);
      const { result, replayed } = await runCommand(ctx, caller, { id: input.commandId, type: 'EndStoppage', request: { id } }, async (t) => {
        const [s] = await stoppagesOf(t, ctx.clock.now(), { id });
        if (!s) return notFound('stoppage', id);
        if (s.endedAt) conflict('stop.already_ended', `this stoppage ended at ${s.endedAt}`);
        await t.run(
          `INSERT INTO oee_event (kind, stoppage_id, line_code, station_code, reason_code, at, by_user, production_date, command_id) VALUES ('END', ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, s.line, s.station, s.reason, ctx.clock.now().toISOString(), caller.name, s.productionDate, input.commandId],
        );
        return { id };
      });
      return { ...result, replayed };
    });
  },

  async health(ctx) {
    // an END without its START would mean a fact was lost
    const orphan = await ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM oee_event e WHERE kind = 'END' AND NOT EXISTS (SELECT 1 FROM oee_event s WHERE s.stoppage_id = e.stoppage_id AND s.kind = 'START')`);
    return [{ id: 'stoppages_consistent', ok: orphan!.n === 0, details: { endsWithoutStart: orphan!.n } }];
  },
};
