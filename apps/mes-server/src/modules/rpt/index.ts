import { formatQty } from '@eco/contracts';
import { z } from 'zod';
import { productionDate, shiftWindow } from '../../kernel/clock.js';
import { runCommand } from '../../kernel/commands.js';
import { fail } from '../../kernel/errors.js';
import type { AppModule, Ctx } from '../../kernel/modules.js';

/**
 * Reports: read-only views over facts other modules own (the ledger, the unit history, the stoppages, the holds),
 * plus the one thing people write here — the notes of the shift handover (RPT4030), append-only like every fact:
 * a wrong note is followed by a correcting one, never edited. Receiving a handover is a signed fact too.
 * Nothing here stores a copy of a figure: every report is computed when asked, so it cannot drift from the ledger.
 */
const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const qty = (n: number) => Number(formatQty(n));
export const NOTE_KINDS = ['production', 'quality', 'safety', 'maintenance', 'material', 'people', 'other'] as const;

async function today(ctx: Ctx) { return productionDate(ctx.clock.now(), ctx.config.timeZone, ctx.config.productionDayStart); }

export const rptModule: AppModule = {
  id: 'rpt',
  dependsOn: ['system', 'mdm', 'exe'],
  scopes: ['rpt.read', 'rpt.notes.write'],
  migrations: [
    {
      id: '001_handover',
      up: `
        CREATE TABLE rpt_note (
          seq             INTEGER PRIMARY KEY,
          production_date TEXT NOT NULL,
          shift_code      TEXT NOT NULL,
          line_code       TEXT,
          kind            TEXT NOT NULL CHECK (kind IN ('production', 'quality', 'safety', 'maintenance', 'material', 'people', 'other')),
          text            TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
          corrects_seq    INTEGER REFERENCES rpt_note(seq),
          by_user         TEXT NOT NULL,
          at              TEXT NOT NULL,
          command_id      TEXT NOT NULL
        );
        CREATE INDEX rpt_note_day ON rpt_note(production_date, shift_code);
        CREATE TABLE rpt_handover_ack (
          production_date TEXT NOT NULL,
          shift_code      TEXT NOT NULL,
          line_code       TEXT NOT NULL DEFAULT '',
          by_user         TEXT NOT NULL,
          at              TEXT NOT NULL,
          PRIMARY KEY (production_date, shift_code, line_code)
        );
        CREATE TRIGGER rpt_note_immutable BEFORE UPDATE ON rpt_note BEGIN SELECT RAISE(ABORT, 'rpt: handover notes are append-only'); END;
        CREATE TRIGGER rpt_note_no_delete BEFORE DELETE ON rpt_note BEGIN SELECT RAISE(ABORT, 'rpt: handover notes are append-only'); END;
        CREATE TRIGGER rpt_ack_immutable BEFORE UPDATE ON rpt_handover_ack BEGIN SELECT RAISE(ABORT, 'rpt: a received handover stays received'); END;
        CREATE TRIGGER rpt_ack_no_delete BEFORE DELETE ON rpt_handover_ack BEGIN SELECT RAISE(ABORT, 'rpt: a received handover stays received'); END;
      `,
    },
  ],

  routes({ http, require }, ctx) {
    const oee = () => (ctx.services.has('oee') ? ctx.services.get('oee') : null);

    // ------------------------------------------------------------------ RPT4010 daily production
    http.get('/api/reports/daily', async (req) => {
      require(req, 'rpt.read');
      const date = zDate.optional().parse((req.query as { date?: string }).date) ?? (await today(ctx));
      const lines = (await ctx.services.get('mdm').plantNodes('line')).filter((l) => l.active);
      const orders = await ctx.db.all<{ id: string; code: string; line_code: string | null; shift_code: string | null; item_code: string; name_en: string; name_ar: string;
        status: string; planned_qty: number; completed_qty: number; scrapped_qty: number; production_date: string; good: number; scrap: number }>(
        `SELECT w.id, w.code, w.line_code, w.shift_code, i.code item_code, i.name_en, i.name_ar, w.status, w.planned_qty, w.completed_qty, w.scrapped_qty, w.production_date,
           COALESCE(SUM(CASE WHEN l.txn_type = 'COMPLETE' THEN l.qty END), 0) good, COALESCE(SUM(CASE WHEN l.txn_type = 'SCRAP' THEN l.qty END), 0) scrap
         FROM exe_work_order w JOIN mdm_item i ON i.id = w.item_id
         LEFT JOIN exe_ledger l ON l.work_order_id = w.id AND l.production_date = ? AND l.txn_type IN ('COMPLETE', 'SCRAP')
         WHERE w.production_date = ? OR EXISTS (SELECT 1 FROM exe_ledger x WHERE x.work_order_id = w.id AND x.production_date = ? AND x.txn_type IN ('COMPLETE', 'SCRAP'))
         GROUP BY w.id ORDER BY w.line_code, w.code`, [date, date, date]);
      // (the unit history exists only when serial tracking is installed)
      const fails = await ctx.db.all<{ line: string; n: number }>(
        `SELECT line_code line, COUNT(*) n FROM trk_event WHERE kind = 'FAIL' AND production_date = ? GROUP BY line_code`, [date]).catch(() => []);
      const out: { line: string; name_en: string; name_ar: string; planned: number; good: number; scrap: number; attainment: number | null; scrapPct: number | null;
        fails: number; downtimeMin: number | null; oee: number | null; availability: number | null; performance: number | null; quality: number | null }[] = [];
      for (const l of lines) {
        const own = orders.filter((o) => o.line_code === l.code);
        const planned = own.filter((o) => o.production_date === date).reduce((a, o) => a + o.planned_qty, 0);
        const good = own.reduce((a, o) => a + o.good, 0), scrap = own.reduce((a, o) => a + o.scrap, 0);
        const o = oee() ? await oee()!.oee({ line: l.code, date }) : null;
        out.push({ line: l.code, name_en: l.name_en, name_ar: l.name_ar, planned: qty(planned), good: qty(good), scrap: qty(scrap),
          attainment: planned ? Math.round((good / planned) * 1000) / 10 : null, scrapPct: good + scrap ? Math.round((scrap / (good + scrap)) * 1000) / 10 : null,
          fails: fails.find((f) => f.line === l.code)?.n ?? 0, downtimeMin: o ? o.downtimeMin : null, oee: o ? o.oee : null, availability: o?.availability ?? null,
          performance: o?.performance ?? null, quality: o?.quality ?? null });
      }
      const sum = (k: 'planned' | 'good' | 'scrap') => out.reduce((a, r) => a + r[k], 0);
      return { date, lines: out, totals: { planned: sum('planned'), good: sum('good'), scrap: sum('scrap'), fails: out.reduce((a, r) => a + r.fails, 0) },
        orders: orders.map((o) => ({ id: o.id, code: o.code, line: o.line_code, shift: o.shift_code, item: { code: o.item_code, name_en: o.name_en, name_ar: o.name_ar }, status: o.status,
          plannedToday: o.production_date === date, planned: qty(o.planned_qty), completed: qty(o.completed_qty), good: qty(o.good), scrap: qty(o.scrap) })) };
    });

    // ------------------------------------------------------------------ RPT4020 scrap and rework
    http.get('/api/reports/scrap', async (req) => {
      require(req, 'rpt.read');
      const q = z.object({ from: zDate, to: zDate, line: z.string().optional() }).parse(req.query);
      const lineSql = q.line ? 'AND w.line_code = ?' : '';
      const p = q.line ? [q.from, q.to, q.line] : [q.from, q.to];
      const byReason = await ctx.db.all<{ reason: string | null; item: string; line: string | null; q: number; n: number }>(
        `SELECT l.reason_code reason, i.code item, w.line_code line, SUM(l.qty) q, COUNT(*) n FROM exe_ledger l JOIN exe_work_order w ON w.id = l.work_order_id JOIN mdm_item i ON i.id = w.item_id
         WHERE l.txn_type = 'SCRAP' AND l.production_date BETWEEN ? AND ? ${lineSql} GROUP BY l.reason_code, i.code, w.line_code ORDER BY q DESC`, p);
      const made = await ctx.db.get<{ g: number | null; s: number | null }>(
        `SELECT SUM(CASE WHEN l.txn_type = 'COMPLETE' THEN l.qty END) g, SUM(CASE WHEN l.txn_type = 'SCRAP' THEN l.qty END) s FROM exe_ledger l JOIN exe_work_order w ON w.id = l.work_order_id
         WHERE l.production_date BETWEEN ? AND ? ${lineSql}`, p);
      const tp = q.line ? [q.from, q.to, q.line] : [q.from, q.to];
      const tl = q.line ? 'AND line_code = ?' : '';
      const rework = await ctx.db.all<{ kind: string; defect: string | null; cause: string | null; action: string | null; n: number }>(
        `SELECT kind, defect_code defect, json_extract(detail, '$.cause') cause, json_extract(detail, '$.action') action, COUNT(*) n FROM trk_event
         WHERE kind IN ('FAIL', 'REPAIR') AND production_date BETWEEN ? AND ? ${tl} GROUP BY kind, defect_code, cause, action`, tp).catch(() => []);
      const inRepair = await ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM trk_unit WHERE status = 'repair' ${q.line ? 'AND line_code = ?' : ''}`, q.line ? [q.line] : []).catch(() => ({ n: 0 }));
      const names = new Map<string, { name_en: string; name_ar: string }>();
      for (const table of ['qms_defect', 'qms_repair_code']) {
        const rows = await ctx.db.all<{ code: string; name_en: string; name_ar: string }>(`SELECT code, name_en, name_ar FROM ${table}`).catch(() => []);
        for (const r of rows) names.set(r.code, r);
      }
      const group = (rows: typeof rework, key: 'defect' | 'cause' | 'action', kind: string) => {
        const m = new Map<string, number>();
        for (const r of rows.filter((x) => x.kind === kind && x[key])) m.set(r[key]!, (m.get(r[key]!) ?? 0) + r.n);
        return [...m.entries()].map(([code, n]) => ({ code, n, ...(names.get(code) ?? {}) })).sort((a, b) => b.n - a.n);
      };
      const good = made?.g ?? 0, scrap = made?.s ?? 0;
      return {
        from: q.from, to: q.to, line: q.line ?? null,
        good: qty(good), scrap: qty(scrap), scrapPct: good + scrap ? Math.round((scrap / (good + scrap)) * 1000) / 10 : null,
        scrapByReason: byReason.map((r) => ({ reason: r.reason ?? '', item: r.item, line: r.line, qty: qty(r.q), bookings: r.n })),
        fails: rework.filter((r) => r.kind === 'FAIL').reduce((a, r) => a + r.n, 0), repairs: rework.filter((r) => r.kind === 'REPAIR').reduce((a, r) => a + r.n, 0), inRepair: inRepair!.n,
        byDefect: group(rework, 'defect', 'FAIL'), byCause: group(rework, 'cause', 'REPAIR'), byAction: group(rework, 'action', 'REPAIR'),
      };
    });

    // ------------------------------------------------------------------ RPT4030 shift handover
    http.get('/api/handover', async (req) => {
      require(req, 'rpt.read');
      const q = z.object({ date: zDate.optional(), shift: z.string().min(1), line: z.string().optional() }).parse(req.query);
      const date = q.date ?? (await today(ctx));
      const eng = ctx.services.has('eng') ? ctx.services.get('eng') : null;
      const shift = eng ? (await eng.shifts()).find((s) => s.code === q.shift) : undefined;
      const win = shift ? shiftWindow(date, shift, ctx.config.timeZone, ctx.config.productionDayStart) : null;
      const inWin = (iso: string, code: string | null) => (win ? (Date.parse(iso) >= win.from && Date.parse(iso) < win.to) : code === q.shift);
      const booked = await ctx.db.all<{ line: string | null; kind: string; qty: number; at: string; shift: string | null; wo: string }>(
        `SELECT w.line_code line, l.txn_type kind, l.qty, l.occurred_at at, l.shift_code shift, w.code wo FROM exe_ledger l JOIN exe_work_order w ON w.id = l.work_order_id
         WHERE l.production_date = ? AND l.txn_type IN ('COMPLETE', 'SCRAP') ${q.line ? 'AND w.line_code = ?' : ''}`, q.line ? [date, q.line] : [date]);
      const lines = new Map<string, { line: string; good: number; scrap: number; orders: Set<string> }>();
      for (const b of booked.filter((x) => inWin(x.at, x.shift))) {
        const k = b.line ?? '';
        const e = lines.get(k) ?? { line: k, good: 0, scrap: 0, orders: new Set<string>() };
        if (b.kind === 'COMPLETE') e.good += b.qty; else e.scrap += b.qty;
        e.orders.add(b.wo);
        lines.set(k, e);
      }
      const stops = oee() ? (await oee()!.stoppages({ date, line: q.line || undefined })).filter((s) => !win || (Date.parse(s.startedAt) < win.to && (!s.endedAt || Date.parse(s.endedAt) > win.from))) : [];
      const holds = await ctx.db.all<{ code: string; target_type: string; target: string; reason: string; units: number; held_at: string }>(
        `SELECT code, target_type, target, reason, units, held_at FROM qms_hold WHERE status = 'open' ORDER BY held_at DESC LIMIT 50`).catch(() => []);
      const repair = await ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM trk_unit WHERE status = 'repair' ${q.line ? 'AND line_code = ?' : ''}`, q.line ? [q.line] : []).catch(() => ({ n: 0 }));
      const notes = await ctx.db.all(`SELECT seq, line_code line, kind, text, corrects_seq, by_user, at FROM rpt_note WHERE production_date = ? AND shift_code = ? ${q.line ? "AND (line_code = ? OR line_code IS NULL)" : ''} ORDER BY seq`,
        q.line ? [date, q.shift, q.line] : [date, q.shift]);
      const ack = await ctx.db.get('SELECT by_user, at FROM rpt_handover_ack WHERE production_date = ? AND shift_code = ? AND line_code = ?', [date, q.shift, q.line ?? '']);
      return {
        date, shift: q.shift, line: q.line ?? null, window: win ? { from: new Date(win.from).toISOString(), to: new Date(win.to).toISOString() } : null,
        output: [...lines.values()].sort((a, b) => a.line.localeCompare(b.line)).map((e) => ({ line: e.line, good: qty(e.good), scrap: qty(e.scrap), orders: [...e.orders].sort() })),
        stoppages: stops, openStoppages: stops.filter((s) => !s.endedAt).length, openHolds: holds, inRepair: repair!.n, notes, received: ack ?? null,
      };
    });

    http.post('/api/handover/notes', async (req) => {
      const caller = require(req, 'rpt.notes.write');
      const input = z.object({ commandId: z.string(), date: zDate, shift: z.string().min(1).max(8), line: z.string().min(1).nullable().optional(),
        kind: z.enum(NOTE_KINDS), text: z.string().trim().min(1).max(2000), corrects: z.number().int().positive().optional() }).parse(req.body);
      const { result, replayed } = await runCommand(ctx, caller, { id: input.commandId, type: 'HandoverNote', request: req.body }, async (t) => {
        if (input.line) {
          const l = await ctx.services.get('mdm').plantNode(input.line, t);
          if (!l || l.type !== 'line') fail('line.unknown', `${input.line} is not a line of the plant model`);
        }
        if (input.corrects && !(await t.get('SELECT 1 FROM rpt_note WHERE seq = ?', [input.corrects]))) fail('note.unknown', `note ${input.corrects} does not exist`);
        const r = await t.run('INSERT INTO rpt_note (production_date, shift_code, line_code, kind, text, corrects_seq, by_user, at, command_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [input.date, input.shift, input.line ?? null, input.kind, input.text, input.corrects ?? null, caller.name, ctx.clock.now().toISOString(), input.commandId]);
        return { seq: r.lastId };
      });
      return { ...result, replayed };
    });

    http.post('/api/handover/receive', async (req) => {
      const caller = require(req, 'rpt.notes.write');
      const input = z.object({ commandId: z.string(), date: zDate, shift: z.string().min(1).max(8), line: z.string().min(1).nullable().optional() }).parse(req.body);
      const { result, replayed } = await runCommand(ctx, caller, { id: input.commandId, type: 'HandoverReceive', request: req.body }, async (t) => {
        const old = await t.get<{ by_user: string; at: string }>('SELECT by_user, at FROM rpt_handover_ack WHERE production_date = ? AND shift_code = ? AND line_code = ?', [input.date, input.shift, input.line ?? '']);
        if (old) return { received: old };
        const at = ctx.clock.now().toISOString();
        await t.run('INSERT INTO rpt_handover_ack (production_date, shift_code, line_code, by_user, at) VALUES (?, ?, ?, ?, ?)', [input.date, input.shift, input.line ?? '', caller.name, at]);
        return { received: { by_user: caller.name, at } };
      });
      return { ...result, replayed };
    });
  },
};
