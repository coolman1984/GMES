import { z } from 'zod';
import type { OeeService, Stoppage } from '../../contracts/services.js';
import { productionDate } from '../../kernel/clock.js';
import { runCommand } from '../../kernel/commands.js';
import type { Db } from '../../kernel/db.js';
import { conflict, fail, notFound } from '../../kernel/errors.js';
import type { AppModule, Ctx } from '../../kernel/modules.js';

/**
 * Downtime: a line (or one of its stations) stops for a reason and later runs again.
 *
 * Stored as append-only FACTS (START, END), never as a row that is updated: a stoppage is what those facts say.
 * One open stoppage per line/station at a time. The reasons are a fixed list for now (a reasons screen, SYS9040,
 * comes with the full OEE module). OEE itself needs cycle times, which do not exist yet: the boards show "—"
 * rather than an invented figure.
 */
export const STOP_REASONS = ['material', 'breakdown', 'changeover', 'quality', 'break', 'other'] as const;

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
  scopes: ['oee.stops.read', 'oee.stops.write'],
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
  ],

  setup(ctx) {
    const service: OeeService = { stoppages: (q) => stoppagesOf(ctx.db, ctx.clock.now(), q) };
    ctx.services.provide('oee', service);
  },

  routes({ http, require }, ctx) {
    http.get('/api/stoppages', async (req) => {
      require(req, 'oee.stops.read');
      const q = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), line: z.string().optional(), open: z.enum(['1', 'true']).optional() }).parse(req.query);
      return stoppagesOf(ctx.db, ctx.clock.now(), { date: q.date, line: q.line || undefined, openOnly: !!q.open });
    });

    http.post('/api/stoppages', async (req) => {
      const caller = require(req, 'oee.stops.write');
      const input = z.object({ commandId: z.string(), line: z.string().trim().min(1), station: z.string().trim().min(1).nullable().optional(), reason: z.enum(STOP_REASONS) }).parse(req.body);
      const { result, replayed } = await runCommand(ctx, caller, { id: input.commandId, type: 'StartStoppage', request: req.body }, async (t) => {
        const mdm = ctx.services.get('mdm');
        const line = await mdm.plantNode(input.line, t);
        if (!line || line.type !== 'line') fail('line.unknown', `${input.line} is not a line of the plant model`);
        if (!line!.active) conflict('line.inactive', `line ${input.line} is inactive`);
        if (input.station) {
          const st = await mdm.plantNode(input.station, t);
          if (!st || st.type !== 'station' || st.parent_id !== line!.id) fail('station.unknown', `${input.station} is not a station of line ${input.line}`);
        }
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
