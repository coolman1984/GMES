import { z } from 'zod';
import { sourceOf, validateEvent, zAckV1, type AttendanceDayV1, type EmployeeV1, type Envelope, type ItemV1, type QualificationV1, type ScheduleDayV1, type WarehouseV1, companyOfSource } from '@eco/contracts';
import type { EcoService } from '../../contracts/services.js';
import { existsSync, readFileSync } from 'node:fs';
import { AppError } from '../../kernel/errors.js';
import type { AppModule, Ctx, HealthCheck } from '../../kernel/modules.js';
import { linkMizanCheck } from './link-health.js';

/**
 * The integration layer on manufacturing's side (ADR-016).
 *
 * - Outbox/feed: facts are appended to eco_outbox in the SAME transaction as the ledger line that
 *   records them; consumers read GET /eco/v1/feed?after=<seq> with their own cursor.
 * - Inbox: master-data snapshots from their owners; (source, id) is remembered, so a snapshot
 *   delivered twice is applied once.
 * - Acks: consumers report what became of each event (applied / parked + why + where), so an
 *   event that did not land is visible here instead of failing silently.
 */
const APP = 'gmes';

/**
 * The event types manufacturing's inbox applies. Everything else is refused with eco.not_accepted, whatever the contract:
 * above all `hr.payroll_period.v1`, which carries money (a test checks that no accepted type does).
 */
export const ACCEPTED_TYPES = [
  'eco.item.v1', 'eco.warehouse.v1', 'eco.employee.v1', 'eco.attendance_day.v1', 'eco.schedule_day.v1', 'eco.qualification.v1',
] as const;

export const ecoModule: AppModule = {
  id: 'eco',
  dependsOn: ['system', 'mdm'],
  scopes: ['eco.feed.read', 'eco.inbox.write', 'eco.acks.write', 'eco.events.read'],
  migrations: [
    {
      id: '001_outbox_inbox_acks',
      up: `
        CREATE TABLE eco_outbox (
          seq          INTEGER PRIMARY KEY,          -- gap-free feed position (single writer)
          id           TEXT NOT NULL UNIQUE,
          type         TEXT NOT NULL,
          subject      TEXT NOT NULL,
          correlation  TEXT NOT NULL,
          causation    TEXT,
          time         TEXT NOT NULL,
          data         TEXT NOT NULL
        );
        CREATE INDEX eco_outbox_corr ON eco_outbox(correlation, seq);
        CREATE TRIGGER eco_outbox_immutable BEFORE UPDATE ON eco_outbox
        BEGIN SELECT RAISE(ABORT, 'eco: published events are immutable'); END;
        CREATE TRIGGER eco_outbox_no_delete BEFORE DELETE ON eco_outbox
        BEGIN SELECT RAISE(ABORT, 'eco: published events are immutable'); END;

        CREATE TABLE eco_inbox (
          source      TEXT NOT NULL,
          event_id    TEXT NOT NULL,
          type        TEXT NOT NULL,
          result      TEXT NOT NULL,                -- applied | unchanged | stale
          received_at TEXT NOT NULL,
          PRIMARY KEY (source, event_id)
        );

        CREATE TABLE eco_ack (
          event_id   TEXT NOT NULL REFERENCES eco_outbox(id),
          consumer   TEXT NOT NULL,
          status     TEXT NOT NULL CHECK (status IN ('applied', 'parked', 'skipped')),
          code       TEXT,
          message    TEXT,
          target_ref TEXT,
          figures    TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (event_id, consumer)
        );
      `,
    },
  ],

  setup(ctx) {
    const source = sourceOf(ctx.config.companyId, APP, ctx.config.node);
    const service: EcoService = {
      async publish(t, e) {
        const id = ctx.clock.newId();
        const time = ctx.clock.now().toISOString();
        const last = await t.get<{ seq: number | null }>('SELECT MAX(seq) seq FROM eco_outbox');
        const seq = (last?.seq ?? 0) + 1;
        const envelope = { specversion: '1.0', id, source, type: e.type, subject: e.subject, time, datacontenttype: 'application/json',
          ecoseq: seq, ecocorrelation: e.correlation, ...(e.causation ? { ecocausation: e.causation } : {}), data: e.data };
        // Never publish something the contract would refuse: a bad event would park every consumer.
        const check = validateEvent(envelope);
        if (!check.ok) throw new AppError(500, 'eco.contract_violation', `refusing to publish ${e.type}: ${check.message}`);
        await t.run('INSERT INTO eco_outbox (seq, id, type, subject, correlation, causation, time, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
          seq, id, e.type, e.subject, e.correlation, e.causation ?? null, time, JSON.stringify(e.data),
        ]);
        return { id, seq };
      },
    };
    ctx.services.provide('eco', service);
  },

  routes({ http, require }, ctx) {
    const source = sourceOf(ctx.config.companyId, APP, ctx.config.node);

    http.get('/eco/v1/feed', async (req) => {
      require(req, 'eco.feed.read');
      const q = z.object({ after: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
      const rows = await ctx.db.all<Row>('SELECT * FROM eco_outbox WHERE seq > ? ORDER BY seq LIMIT ?', [q.after, q.limit]);
      const head = (await ctx.db.get<{ s: number | null }>('SELECT MAX(seq) s FROM eco_outbox'))!.s ?? 0;
      return { source, head, events: rows.map((r) => toEnvelope(source, r)) };
    });

    http.post('/eco/v1/acks', async (req) => {
      const caller = require(req, 'eco.acks.write');
      const body = z.object({ acks: z.array(zAckV1).min(1).max(500) }).parse(req.body);
      const now = ctx.clock.now().toISOString();
      return ctx.db.tx(async (t) => {
        let unknown = 0;
        for (const a of body.acks) {
          if (a.consumer !== caller.name) throw new AppError(403, 'eco.ack_consumer', `key ${caller.name} cannot acknowledge for ${a.consumer}`);
          if (!(await t.get('SELECT 1 FROM eco_outbox WHERE id = ?', [a.event_id]))) {
            unknown++;
            continue;
          }
          await t.run(
            `INSERT INTO eco_ack (event_id, consumer, status, code, message, target_ref, figures, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(event_id, consumer) DO UPDATE SET status = excluded.status, code = excluded.code, message = excluded.message,
               target_ref = excluded.target_ref, figures = excluded.figures, updated_at = excluded.updated_at`,
            [a.event_id, a.consumer, a.status, a.detail.code ?? null, a.detail.message ?? null, a.detail.target_ref ?? null,
             a.detail.figures ? JSON.stringify(a.detail.figures) : null, now],
          );
        }
        return { recorded: body.acks.length - unknown, unknown };
      });
    });

    http.post('/eco/v1/inbox', async (req) => {
      require(req, 'eco.inbox.write');
      const body = z.object({ events: z.array(z.unknown()).min(1).max(500) }).parse(req.body);
      const mdm = ctx.services.get('mdm');
      const results: { id: string | null; result: string; code?: string; message?: string }[] = [];
      for (const raw of body.events) {
        const v = validateEvent(raw);
        const id = (raw as { id?: string })?.id ?? null;
        if (!v.ok) {
          results.push({ id, result: 'rejected', code: v.code, message: v.message });
          continue;
        }
        const env = v.data as Envelope;
        if (companyOfSource(env.source) !== ctx.config.companyId) {
          results.push({ id, result: 'rejected', code: 'eco.foreign_company', message: `event from another company: ${env.source}` });
          continue;
        }
        if (!(ACCEPTED_TYPES as readonly string[]).includes(env.type)) {
          results.push({ id, result: 'rejected', code: 'eco.not_accepted', message: `manufacturing does not consume ${env.type}` });
          continue;
        }
        try {
          const result = await ctx.db.tx(async (t) => {
            if (await t.get('SELECT 1 FROM eco_inbox WHERE source = ? AND event_id = ?', [env.source, env.id])) return 'duplicate';
            let r: string;
            if (env.type === 'eco.item.v1') r = await mdm.applyItem(t, env.data as ItemV1);
            else if (env.type === 'eco.warehouse.v1') r = await mdm.applyWarehouse(t, env.data as WarehouseV1);
            else if (env.type === 'eco.employee.v1') r = await mdm.applyEmployee(t, env.data as EmployeeV1);
            else if (env.type === 'eco.attendance_day.v1') r = await mdm.applyAttendanceDay(t, env.data as AttendanceDayV1);
            else if (env.type === 'eco.schedule_day.v1') r = await mdm.applyScheduleDay(t, env.data as ScheduleDayV1);
            else if (env.type === 'eco.qualification.v1') r = await mdm.applyQualification(t, env.data as QualificationV1);
            else throw new AppError(400, 'eco.not_accepted', `manufacturing does not consume ${env.type}`);
            await t.run('INSERT INTO eco_inbox (source, event_id, type, result, received_at) VALUES (?, ?, ?, ?, ?)', [
              env.source, env.id, env.type, r, ctx.clock.now().toISOString(),
            ]);
            return r;
          });
          results.push({ id, result });
        } catch (err) {
          if (!(err instanceof AppError)) throw err;
          results.push({ id, result: 'rejected', code: err.code, message: err.message });
        }
      }
      return { results };
    });

    // Every published event with what each consumer made of it; ?status=parked lists the exceptions.
    http.get('/api/integration/events', async (req) => {
      require(req, 'eco.events.read');
      const q = z.object({ status: z.enum(['parked', 'applied', 'skipped', 'pending']).optional(), correlation: z.string().optional() }).parse(req.query);
      const where: string[] = [];
      const p: Record<string, string> = {};
      if (q.status === 'pending') where.push('a.event_id IS NULL');
      else if (q.status) (where.push('a.status = :status'), (p.status = q.status));
      if (q.correlation) (where.push('o.correlation = :corr'), (p.corr = q.correlation));
      return ctx.db.all(
        `SELECT o.seq, o.id, o.type, o.subject, o.correlation, o.time, a.consumer, a.status, a.code, a.message, a.target_ref, a.figures, a.updated_at
         FROM eco_outbox o LEFT JOIN eco_ack a ON a.event_id = o.id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.seq`,
        p,
      );
    });
  },

  async health(ctx) {
    const r = await ctx.db.get<{ n: number; mx: number | null }>('SELECT COUNT(*) n, MAX(seq) mx FROM eco_outbox');
    const parked = await ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM eco_ack WHERE status = 'parked'");
    const checks: HealthCheck[] = [
      { id: 'feed_gap_free', ok: r!.n === (r!.mx ?? 0), details: { events: r!.n, lastSeq: r!.mx ?? 0 } },
      { id: 'no_parked_events', ok: parked!.n === 0, details: { parked: parked!.n } },
    ];
    // the link to Mizan is judged only where the plant runs it (start.ps1 sets the pulse file's path from data/config.json)
    const pulse = process.env.GMES_LINK_MIZAN_HEARTBEAT;
    if (pulse) {
      const maxAgeMs = Number(process.env.GMES_LINK_MIZAN_MAX_AGE_SECONDS ?? '120') * 1000;
      checks.push(linkMizanCheck(existsSync(pulse) ? readFileSync(pulse, 'utf8') : null, ctx.clock.now(), maxAgeMs));
    }
    return checks;
  },
};

interface Row {
  seq: number;
  id: string;
  type: string;
  subject: string;
  correlation: string;
  causation: string | null;
  time: string;
  data: string;
}

function toEnvelope(source: string, r: Row) {
  return {
    specversion: '1.0', id: r.id, source, type: r.type, subject: r.subject, time: r.time, datacontenttype: 'application/json',
    ecoseq: r.seq, ecocorrelation: r.correlation, ...(r.causation ? { ecocausation: r.causation } : {}), data: JSON.parse(r.data),
  };
}

export type { Ctx };
