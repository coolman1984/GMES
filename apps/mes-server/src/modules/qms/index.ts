import { z } from 'zod';
import { formatQty, parseQty, QuantityError } from '@eco/contracts';
import type { QmsService, UnitRow } from '../../contracts/services.js';
import { chainAppend, verifyChain } from '../../kernel/chain.js';
import { productionDate } from '../../kernel/clock.js';
import { runCommand } from '../../kernel/commands.js';
import type { Db } from '../../kernel/db.js';
import { conflict, fail, notFound } from '../../kernel/errors.js';
import type { AppModule, Caller, Ctx } from '../../kernel/modules.js';
import { AQLS, samplingPlan } from './aql.js';

/**
 * Quality (QMS1010 plans, QMS1020 codes, QMS2010 inspections, QMS2020 holds, QMS2030 repair, QMS4010 yield and Pareto).
 *
 * * Defect codes and repair cause / action codes are the plant's lists; with an empty list any code is accepted (a plant
 *   starts before it writes its lists), with a list only its active codes.
 * * An inspection is a signed-off fact (append-only, hash-chained): measurements against their limits, findings by defect
 *   code, and for sampling inspections (IQC / OQC) the ISO 2859-1 plan: the lot passes when the defects found do not exceed
 *   the acceptance number. A failed outgoing inspection HOLDS the whole lot at once.
 * * A hold stops units wherever they are (a unit, a work order, every unit containing a material lot, a list, a pallet);
 *   units already shipped are counted, not held (they are the recall list). A hold is released by a person's electronic
 *   signature with a disposition: release (use as is), rework (back to repair) or scrap — the last two only for units
 *   still in production: a finished unit is never silently taken back out of the production ledger.
 */
const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const zCode = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{0,39}$/, 'code: letters, digits, dash or underscore');
const zMeasure = z.string().transform((v, c) => {
  try { return parseQty(v); } catch (e) { if (!(e instanceof QuantityError)) throw e; c.addIssue({ code: 'custom', message: `${e.code}: ${e.message}` }); return z.NEVER; }
});
const INSPECTION_FIELDS = ['seq', 'id', 'plan_id', 'stage', 'target_type', 'target', 'item_id', 'line_code', 'lot_size', 'sample_size', 'accept', 'defects',
  'result', 'measures', 'findings', 'note', 'inspector', 'production_date', 'at', 'command_id'] as const;
const STAGES = ['iqc', 'ipqc', 'fqc', 'oqc'] as const;

export const qmsModule: AppModule = {
  id: 'qms',
  dependsOn: ['system', 'mdm', 'exe', 'trk'],
  scopes: ['qms.read', 'qms.write', 'qms.inspect', 'qms.hold', 'qms.release'],
  migrations: [
    {
      id: '001_quality',
      up: `
        CREATE TABLE qms_defect (
          code      TEXT PRIMARY KEY,
          name_en   TEXT NOT NULL,
          name_ar   TEXT NOT NULL,
          category  TEXT NOT NULL,
          severity  TEXT NOT NULL CHECK (severity IN ('critical', 'major', 'minor')),
          area      TEXT,
          active    INTEGER NOT NULL DEFAULT 1,
          version   INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE qms_repair_code (
          kind      TEXT NOT NULL CHECK (kind IN ('cause', 'action')),
          code      TEXT NOT NULL,
          name_en   TEXT NOT NULL,
          name_ar   TEXT NOT NULL,
          active    INTEGER NOT NULL DEFAULT 1,
          version   INTEGER NOT NULL DEFAULT 1,
          PRIMARY KEY (kind, code)
        );
        CREATE TABLE qms_plan (
          id        TEXT PRIMARY KEY,
          code      TEXT NOT NULL UNIQUE,
          name_en   TEXT NOT NULL,
          name_ar   TEXT NOT NULL,
          stage     TEXT NOT NULL CHECK (stage IN ('iqc', 'ipqc', 'fqc', 'oqc')),
          item_id   TEXT,
          op_code   TEXT,
          aql_level TEXT CHECK (aql_level IS NULL OR aql_level IN ('I', 'II', 'III')),
          aql       TEXT,
          active    INTEGER NOT NULL DEFAULT 1,
          version   INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE qms_characteristic (
          plan_id   TEXT NOT NULL REFERENCES qms_plan(id),
          seq       INTEGER NOT NULL,
          code      TEXT NOT NULL,
          name_en   TEXT NOT NULL,
          name_ar   TEXT NOT NULL,
          kind      TEXT NOT NULL CHECK (kind IN ('measure', 'check')),
          unit      TEXT,
          nominal   INTEGER,                 -- thousandths (ADR-018)
          lsl       INTEGER,
          usl       INTEGER,
          PRIMARY KEY (plan_id, seq)
        );
        -- an inspection is a signed-off record: append-only and hash-chained
        CREATE TABLE qms_inspection (
          seq             INTEGER PRIMARY KEY,
          id              TEXT NOT NULL UNIQUE,
          plan_id         TEXT,
          stage           TEXT NOT NULL,
          target_type     TEXT NOT NULL CHECK (target_type IN ('unit', 'lot', 'work_order', 'pallet')),
          target          TEXT NOT NULL,
          item_id         TEXT,
          line_code       TEXT,
          lot_size        INTEGER,
          sample_size     INTEGER,
          accept          INTEGER,
          defects         INTEGER NOT NULL,
          result          TEXT NOT NULL CHECK (result IN ('pass', 'fail')),
          measures        TEXT,
          findings        TEXT,
          note            TEXT,
          inspector       TEXT NOT NULL,
          production_date TEXT NOT NULL,
          at              TEXT NOT NULL,
          command_id      TEXT NOT NULL,
          prev_hash       TEXT NOT NULL,
          hash            TEXT NOT NULL
        );
        CREATE INDEX qms_inspection_target ON qms_inspection(target_type, target, seq);
        CREATE INDEX qms_inspection_day ON qms_inspection(production_date, stage);
        CREATE TRIGGER qms_inspection_immutable BEFORE UPDATE ON qms_inspection BEGIN SELECT RAISE(ABORT, 'qms: inspection records are append-only'); END;
        CREATE TRIGGER qms_inspection_no_delete BEFORE DELETE ON qms_inspection BEGIN SELECT RAISE(ABORT, 'qms: inspection records are append-only'); END;

        CREATE TABLE qms_hold (
          id          TEXT PRIMARY KEY,
          code        TEXT NOT NULL UNIQUE,
          target_type TEXT NOT NULL CHECK (target_type IN ('unit', 'serials', 'work_order', 'material_lot', 'pallet')),
          target      TEXT NOT NULL,
          reason      TEXT NOT NULL,
          units       INTEGER NOT NULL,
          shipped     INTEGER NOT NULL DEFAULT 0,
          status      TEXT NOT NULL CHECK (status IN ('open', 'released')),
          disposition TEXT CHECK (disposition IS NULL OR disposition IN ('release', 'rework', 'scrap')),
          decision    TEXT,
          source      TEXT,
          held_at     TEXT NOT NULL,
          held_by     TEXT NOT NULL,
          released_at TEXT,
          released_by TEXT,
          signed_by   TEXT
        );
        CREATE TABLE qms_hold_unit (
          hold_id TEXT NOT NULL REFERENCES qms_hold(id),
          unit_id TEXT NOT NULL,
          PRIMARY KEY (hold_id, unit_id)
        );
      `,
    },
  ],

  setup(ctx) {
    const service: QmsService = {
      async checkDefect(t, code) {
        const any = await t.get('SELECT 1 FROM qms_defect LIMIT 1');
        if (!any) return;
        const d = await t.get<{ active: number }>('SELECT active FROM qms_defect WHERE code = ?', [code.toUpperCase()]);
        if (!d) fail('defect.unknown', `${code} is not a defect code of this plant (QMS1020)`);
        if (!d!.active) conflict('defect.inactive', `defect code ${code} is no longer used`);
      },
      async checkRepairCode(t, kind, code) {
        const any = await t.get('SELECT 1 FROM qms_repair_code WHERE kind = ? LIMIT 1', [kind]);
        if (!any) return;
        const d = await t.get<{ active: number }>('SELECT active FROM qms_repair_code WHERE kind = ? AND code = ?', [kind, code.toUpperCase()]);
        if (!d || !d.active) fail(`repair.unknown_${kind}`, `${code} is not a repair ${kind} code of this plant (QMS1020)`);
      },
      async oqcResult(t, lot) {
        const r = await t.get<{ result: 'pass' | 'fail' }>(`SELECT result FROM qms_inspection WHERE stage = 'oqc' AND target = ? ORDER BY seq DESC LIMIT 1`, [lot]);
        return r ? (r.result === 'pass' ? 'passed' : 'failed') : 'none';
      },
    };
    ctx.services.provide('qms', service);
  },

  routes({ http, require }, ctx) {
    const sys = () => ctx.services.get('sys');
    const today = () => productionDate(ctx.clock.now(), ctx.config.timeZone, ctx.config.productionDayStart);

    // ------------------------------------------------------------------ codes (QMS1020)
    http.get('/api/defect-codes', async (req) => {
      require(req, 'qms.read');
      const q = z.object({ active: z.enum(['1']).optional(), area: z.string().optional() }).parse(req.query);
      const rows = await ctx.db.all<{ area: string | null; active: number }>('SELECT * FROM qms_defect ORDER BY category, code');
      return rows.filter((r) => (!q.active || r.active) && (!q.area || !r.area || r.area === q.area));
    });
    http.put('/api/defect-codes/:code', async (req) => {
      const caller = require(req, 'qms.write');
      const code = zCode.parse((req.params as { code: string }).code);
      const input = z.object({ nameEn: z.string().trim().min(1).max(120), nameAr: z.string().trim().max(120).optional(), category: z.string().trim().min(1).max(40),
        severity: z.enum(['critical', 'major', 'minor']).default('major'), area: z.string().trim().max(20).nullable().optional(), active: z.boolean().default(true), version: z.number().int().optional() }).parse(req.body);
      return ctx.db.tx(async (t) => {
        const cur = await t.get<{ version: number }>('SELECT version FROM qms_defect WHERE code = ?', [code]);
        if (cur && input.version !== cur.version) conflict('defect.changed', `defect code ${code} was changed meanwhile: reload it`);
        await t.run(`INSERT INTO qms_defect (code, name_en, name_ar, category, severity, area, active) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(code) DO UPDATE SET name_en = excluded.name_en, name_ar = excluded.name_ar, category = excluded.category, severity = excluded.severity,
          area = excluded.area, active = excluded.active, version = version + 1`,
        [code, input.nameEn, input.nameAr || input.nameEn, input.category, input.severity, input.area ?? null, input.active ? 1 : 0]);
        await sys().audit(t, caller.name, cur ? 'defect.change' : 'defect.create', code, input);
        return { code };
      });
    });
    http.get('/api/repair-codes', async (req) => {
      require(req, 'qms.read');
      return ctx.db.all('SELECT * FROM qms_repair_code ORDER BY kind, code');
    });
    http.put('/api/repair-codes/:kind/:code', async (req) => {
      const caller = require(req, 'qms.write');
      const { kind, code: raw } = req.params as { kind: string; code: string };
      const k = z.enum(['cause', 'action']).parse(kind), code = zCode.parse(raw);
      const input = z.object({ nameEn: z.string().trim().min(1).max(120), nameAr: z.string().trim().max(120).optional(), active: z.boolean().default(true) }).parse(req.body);
      return ctx.db.tx(async (t) => {
        await t.run(`INSERT INTO qms_repair_code (kind, code, name_en, name_ar, active) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(kind, code) DO UPDATE SET name_en = excluded.name_en, name_ar = excluded.name_ar, active = excluded.active, version = version + 1`,
        [k, code, input.nameEn, input.nameAr || input.nameEn, input.active ? 1 : 0]);
        await sys().audit(t, caller.name, 'repair_code.save', `${k}:${code}`, input);
        return { kind: k, code };
      });
    });

    // ------------------------------------------------------------------ inspection plans (QMS1010)
    const zChar = z.object({ seq: z.number().int().min(1), code: zCode, nameEn: z.string().trim().min(1).max(120), nameAr: z.string().trim().max(120).optional(),
      kind: z.enum(['measure', 'check']), unit: z.string().trim().max(12).optional(), nominal: zMeasure.optional(), lsl: zMeasure.optional(), usl: zMeasure.optional() });
    const zPlan = z.object({ code: zCode, nameEn: z.string().trim().min(1).max(120), nameAr: z.string().trim().max(120).optional(), stage: z.enum(STAGES),
      itemId: z.string().nullable().optional(), opCode: z.string().trim().toUpperCase().max(20).nullable().optional(),
      aqlLevel: z.enum(['I', 'II', 'III']).nullable().optional(), aql: z.enum(AQLS).nullable().optional(), active: z.boolean().default(true),
      characteristics: z.array(zChar).max(80).default([]) });
    http.get('/api/qms/plans', async (req) => {
      require(req, 'qms.read');
      return ctx.db.all(`SELECT p.*, i.code item_code, (SELECT COUNT(*) FROM qms_characteristic c WHERE c.plan_id = p.id) chars
        FROM qms_plan p LEFT JOIN mdm_item i ON i.id = p.item_id ORDER BY p.stage, p.code`);
    });
    http.get('/api/qms/plans/:id', async (req) => {
      require(req, 'qms.read');
      return planOf(ctx.db, (req.params as { id: string }).id);
    });
    http.post('/api/qms/plans', async (req) => {
      const caller = require(req, 'qms.write');
      const input = zPlan.parse(req.body);
      return ctx.db.tx(async (t) => {
        if (await t.get('SELECT 1 FROM qms_plan WHERE code = ?', [input.code])) conflict('plan.code_taken', `plan ${input.code} exists`);
        const id = ctx.clock.newId();
        await savePlan(ctx, t, id, input, true);
        await sys().audit(t, caller.name, 'plan.create', input.code, { stage: input.stage });
        return { id, code: input.code };
      });
    });
    http.put('/api/qms/plans/:id', async (req) => {
      const caller = require(req, 'qms.write');
      const { id } = req.params as { id: string };
      const input = zPlan.extend({ version: z.number().int() }).parse(req.body);
      return ctx.db.tx(async (t) => {
        const cur = (await t.get<{ version: number; code: string }>('SELECT version, code FROM qms_plan WHERE id = ?', [id])) ?? notFound('plan', id);
        if (cur.version !== input.version) conflict('plan.changed', `plan ${cur.code} was changed meanwhile: reload it`);
        if (cur.code !== input.code) fail('plan.code_fixed', 'the code of a plan never changes');
        await savePlan(ctx, t, id, input, false);
        await sys().audit(t, caller.name, 'plan.change', input.code, { version: cur.version + 1 });
        return { id, version: cur.version + 1 };
      });
    });
    http.get('/api/qms/aql', async (req) => {
      require(req, 'qms.read');
      const q = z.object({ lotSize: z.coerce.number().int().min(2), level: z.enum(['I', 'II', 'III']).default('II'), aql: z.enum(AQLS) }).parse(req.query);
      return samplingPlan(q.lotSize, q.level, q.aql);
    });

    // ------------------------------------------------------------------ inspections (QMS2010)
    http.post('/api/qms/inspections', async (req) => {
      const caller = require(req, 'qms.inspect');
      const input = z.object({ commandId: z.string(), planId: z.string().optional(), stage: z.enum(STAGES).optional(),
        targetType: z.enum(['unit', 'lot', 'work_order', 'pallet']), target: z.string().trim().min(1).max(64), lotSize: z.number().int().min(1).max(10_000_000).optional(),
        sampleSize: z.number().int().min(1).optional(), measurements: z.array(z.object({ code: z.string(), value: z.string() })).max(200).default([]),
        findings: z.array(z.object({ defectCode: z.string().trim().min(1).max(40), qty: z.number().int().min(1).max(100000).default(1), serial: z.string().trim().max(40).optional(),
          location: z.string().trim().max(40).optional() })).max(500).default([]), note: z.string().trim().max(500).optional() }).parse(req.body);
      const { result, replayed } = await runCommand(ctx, caller, { id: input.commandId, type: 'RecordInspection', request: req.body }, (t) => inspect(ctx, t, caller, input, today()));
      return { ...result, replayed };
    });
    http.get('/api/qms/inspections', async (req) => {
      require(req, 'qms.read');
      const q = z.object({ from: zDate, to: zDate, stage: z.enum(STAGES).optional().or(z.literal('')), result: z.enum(['pass', 'fail']).optional().or(z.literal('')), target: z.string().optional() }).parse(req.query);
      const where = ['production_date >= ?', 'production_date <= ?'], p: string[] = [q.from, q.to];
      if (q.stage) { where.push('stage = ?'); p.push(q.stage); }
      if (q.result) { where.push('result = ?'); p.push(q.result); }
      if (q.target) { where.push('target LIKE ?'); p.push('%' + q.target.trim().toUpperCase() + '%'); }
      const rows = await ctx.db.all<any>(`SELECT q.*, p.code plan_code, i.code item_code FROM qms_inspection q LEFT JOIN qms_plan p ON p.id = q.plan_id LEFT JOIN mdm_item i ON i.id = q.item_id
        WHERE ${where.join(' AND ')} ORDER BY q.seq DESC LIMIT 5000`, p);
      return rows.map((r) => ({ ...r, measures: r.measures ? JSON.parse(r.measures) : [], findings: r.findings ? JSON.parse(r.findings) : [] }));
    });
    http.get('/api/qms/verify', async (req) => {
      require(req, 'qms.read');
      return verifyChain(ctx.db, 'qms_inspection', INSPECTION_FIELDS);
    });

    // ------------------------------------------------------------------ holds (QMS2020)
    http.get('/api/qms/holds', async (req) => {
      require(req, 'qms.read');
      const q = z.object({ status: z.enum(['open', 'released']).optional().or(z.literal('')) }).parse(req.query);
      return ctx.db.all(`SELECT * FROM qms_hold ${q.status ? 'WHERE status = ?' : ''} ORDER BY held_at DESC LIMIT 2000`, q.status ? [q.status] : []);
    });
    http.get('/api/qms/holds/:id', async (req) => {
      require(req, 'qms.read');
      const { id } = req.params as { id: string };
      const h = (await ctx.db.get('SELECT * FROM qms_hold WHERE id = ? OR code = ?', [id, id])) ?? notFound('hold', id);
      const units = await ctx.db.all(`SELECT u.serial, u.status, u.held, u.line_code, u.op_code, u.completed_at, i.code item_code, i.name_en, i.name_ar, w.code wo_code
        FROM qms_hold_unit x JOIN trk_unit u ON u.id = x.unit_id JOIN mdm_item i ON i.id = u.item_id JOIN exe_work_order w ON w.id = u.work_order_id WHERE x.hold_id = ? ORDER BY u.serial`, [(h as { id: string }).id]);
      return { ...h, list: units };
    });
    http.post('/api/qms/holds', async (req) => {
      const caller = require(req, 'qms.hold');
      const input = z.object({ commandId: z.string(), targetType: z.enum(['unit', 'serials', 'work_order', 'material_lot', 'pallet']), target: z.string().trim().min(1).max(4000),
        item: z.string().trim().max(64).optional(), reason: z.string().trim().min(3).max(300) }).parse(req.body);
      const { result, replayed } = await runCommand(ctx, caller, { id: input.commandId, type: 'PlaceHold', request: req.body }, (t) => placeHold(ctx, t, caller, input));
      return { ...result, replayed };
    });
    http.post('/api/qms/holds/:id/release', async (req) => {
      const caller = require(req, 'qms.release');
      const { id } = req.params as { id: string };
      const input = z.object({ commandId: z.string(), disposition: z.enum(['release', 'rework', 'scrap']), decision: z.string().trim().min(3).max(500),
        defectCode: z.string().trim().max(40).optional(), password: z.string().min(1) }).parse(req.body);
      const signer = await sys().sign(caller, input.password);   // the signature is checked before anything changes
      const { result, replayed } = await runCommand(ctx, caller, { id: input.commandId, type: 'ReleaseHold', request: { id, ...input, password: undefined } },
        (t) => releaseHold(ctx, t, caller, id, input, signer));
      return { ...result, replayed };
    });

    // ------------------------------------------------------------------ yield and Pareto (QMS4010)
    http.get('/api/qms/yield', async (req) => {
      require(req, 'qms.read');
      const q = z.object({ from: zDate, to: zDate, line: z.string().optional() }).parse(req.query);
      // first-pass yield per operation: of the units that were tested there in the period, how many passed at their FIRST try
      const rows = await ctx.db.all<{ line_code: string; op_code: string; units: number; first_pass: number; fails: number }>(`
        WITH tries AS (
          SELECT unit_id, line_code, op_code, kind, ROW_NUMBER() OVER (PARTITION BY unit_id, op_code ORDER BY seq) n
          FROM trk_event WHERE kind IN ('PASS', 'FAIL') AND production_date >= ? AND production_date <= ? ${q.line ? 'AND line_code = ?' : ''})
        SELECT line_code, op_code, COUNT(DISTINCT unit_id) units, SUM(CASE WHEN n = 1 AND kind = 'PASS' THEN 1 ELSE 0 END) first_pass,
          SUM(CASE WHEN kind = 'FAIL' THEN 1 ELSE 0 END) fails
        FROM tries GROUP BY line_code, op_code ORDER BY line_code, op_code`, q.line ? [q.from, q.to, q.line] : [q.from, q.to]);
      const lines = new Map<string, { line: string; ops: typeof rows; rty: number }>();
      for (const r of rows) {
        const l = lines.get(r.line_code) ?? { line: r.line_code, ops: [], rty: 1 };
        l.ops.push(r);
        l.rty *= r.units ? r.first_pass / r.units : 1;
        lines.set(r.line_code, l);
      }
      return [...lines.values()].map((l) => ({ line: l.line, rty: Math.round(l.rty * 10000) / 100,
        ops: l.ops.map((o) => ({ op: o.op_code, units: o.units, firstPass: o.first_pass, fails: o.fails, fpy: o.units ? Math.round((o.first_pass / o.units) * 10000) / 100 : null })) }));
    });
    http.get('/api/qms/pareto', async (req) => {
      require(req, 'qms.read');
      const q = z.object({ from: zDate, to: zDate, line: z.string().optional(), by: z.enum(['defect', 'cause', 'op', 'station']).default('defect') }).parse(req.query);
      const args = q.line ? [q.from, q.to, q.line] : [q.from, q.to];
      const cond = `production_date >= ? AND production_date <= ? ${q.line ? 'AND line_code = ?' : ''}`;
      let rows: { key: string; n: number }[];
      if (q.by === 'cause') {
        rows = await ctx.db.all(`SELECT json_extract(detail, '$.cause') key, COUNT(*) n FROM trk_event WHERE kind = 'REPAIR' AND ${cond} GROUP BY key ORDER BY n DESC`, args);
      } else {
        const col = q.by === 'defect' ? 'defect_code' : q.by === 'op' ? 'op_code' : 'station';
        rows = await ctx.db.all(`SELECT ${col} key, COUNT(*) n FROM trk_event WHERE kind = 'FAIL' AND ${cond} GROUP BY key ORDER BY n DESC`, args);
      }
      const names = q.by === 'defect' ? new Map((await ctx.db.all<{ code: string; name_en: string; name_ar: string; category: string }>('SELECT code, name_en, name_ar, category FROM qms_defect')).map((d) => [d.code, d]))
        : q.by === 'cause' ? new Map((await ctx.db.all<{ code: string; name_en: string; name_ar: string }>(`SELECT code, name_en, name_ar FROM qms_repair_code WHERE kind = 'cause'`)).map((d) => [d.code, d])) : new Map();
      const total = rows.reduce((a, r) => a + r.n, 0);
      let run = 0;
      return { total, rows: rows.map((r) => { run += r.n; const nm = names.get(r.key) as any; return { key: r.key ?? '—', n: r.n, name_en: nm?.name_en ?? null, name_ar: nm?.name_ar ?? null, category: nm?.category ?? null, pct: Math.round((r.n / total) * 1000) / 10, cum: Math.round((run / total) * 1000) / 10 }; }) };
    });
    // units waiting for repair (QMS2030)
    http.get('/api/qms/repair-queue', async (req) => {
      require(req, 'qms.read');
      const q = z.object({ line: z.string().optional() }).parse(req.query);
      return ctx.db.all(`SELECT u.serial, u.line_code, u.op_code, u.held, u.updated_at, i.code item_code, i.name_en, i.name_ar, w.code wo_code,
          (SELECT defect_code FROM trk_event e WHERE e.unit_id = u.id AND e.kind = 'FAIL' ORDER BY seq DESC LIMIT 1) defect_code,
          (SELECT station FROM trk_event e WHERE e.unit_id = u.id AND e.kind = 'FAIL' ORDER BY seq DESC LIMIT 1) failed_at,
          (SELECT COUNT(*) FROM trk_event e WHERE e.unit_id = u.id AND e.kind = 'FAIL') fails
        FROM trk_unit u JOIN mdm_item i ON i.id = u.item_id JOIN exe_work_order w ON w.id = u.work_order_id
        WHERE u.status = 'repair' ${q.line ? 'AND u.line_code = ?' : ''} ORDER BY u.updated_at`, q.line ? [q.line] : []);
    });
  },

  async health(ctx) {
    const v = await verifyChain(ctx.db, 'qms_inspection', INSPECTION_FIELDS);
    // an open hold whose units are no longer held would let suspect units move
    const loose = await ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM qms_hold_unit x JOIN qms_hold h ON h.id = x.hold_id JOIN trk_unit u ON u.id = x.unit_id
      WHERE h.status = 'open' AND u.held = 0`);
    return [
      { id: 'inspection_chain', ok: v.ok, details: { rows: v.rows, firstBadSeq: v.firstBadSeq } },
      { id: 'holds_hold', ok: loose!.n === 0, details: { unitsOfOpenHoldsNotHeld: loose!.n } },
    ];
  },
};

// ------------------------------------------------------------------ plans
async function planOf(db: Db, id: string) {
  const p = (await db.get<any>('SELECT p.*, i.code item_code FROM qms_plan p LEFT JOIN mdm_item i ON i.id = p.item_id WHERE p.id = ? OR p.code = ?', [id, id])) ?? notFound('plan', id);
  const chars = await db.all<any>('SELECT * FROM qms_characteristic WHERE plan_id = ? ORDER BY seq', [p.id]);
  const q = (n: number | null) => (n === null ? null : formatQty(n));
  return { ...p, characteristics: chars.map((c) => ({ ...c, nominal: q(c.nominal), lsl: q(c.lsl), usl: q(c.usl) })) };
}

async function savePlan(ctx: Ctx, t: Db, id: string, p: any, create: boolean) {
  if (p.stage === 'oqc' || p.stage === 'iqc') { if (!p.aql) fail('plan.aql_required', 'a sampling inspection (IQC / OQC) needs an AQL'); }
  if (p.itemId) await ctx.services.get('mdm').item(p.itemId, t);
  for (const c of p.characteristics) {
    if (c.kind === 'measure' && c.lsl === undefined && c.usl === undefined) fail('plan.limits', `${c.code} is measured but has no limit`);
    if (c.lsl !== undefined && c.usl !== undefined && c.lsl > c.usl) fail('plan.limits', `${c.code}: the lower limit is above the upper one`);
  }
  if (create) {
    await t.run(`INSERT INTO qms_plan (id, code, name_en, name_ar, stage, item_id, op_code, aql_level, aql, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, p.code, p.nameEn, p.nameAr || p.nameEn, p.stage, p.itemId ?? null, p.opCode ?? null, p.aqlLevel ?? (p.aql ? 'II' : null), p.aql ?? null, p.active ? 1 : 0]);
  } else {
    await t.run(`UPDATE qms_plan SET name_en = ?, name_ar = ?, stage = ?, item_id = ?, op_code = ?, aql_level = ?, aql = ?, active = ?, version = version + 1 WHERE id = ?`,
      [p.nameEn, p.nameAr || p.nameEn, p.stage, p.itemId ?? null, p.opCode ?? null, p.aqlLevel ?? (p.aql ? 'II' : null), p.aql ?? null, p.active ? 1 : 0, id]);
    await t.run('DELETE FROM qms_characteristic WHERE plan_id = ?', [id]);   // the plan's current definition; past inspections keep their own copy
  }
  const seen = new Set<string>();
  for (const c of p.characteristics) {
    if (seen.has(c.code)) fail('plan.duplicate', `${c.code} is listed twice`);
    seen.add(c.code);
    await t.run(`INSERT INTO qms_characteristic (plan_id, seq, code, name_en, name_ar, kind, unit, nominal, lsl, usl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, c.seq, c.code, c.nameEn, c.nameAr || c.nameEn, c.kind, c.unit ?? null, c.nominal ?? null, c.lsl ?? null, c.usl ?? null]);
  }
}

// ------------------------------------------------------------------ inspections
async function inspect(ctx: Ctx, t: Db, caller: Caller, input: any, today: string) {
  const plan = input.planId ? await planOf(t, input.planId) : null;
  const stage = plan?.stage ?? input.stage ?? fail('inspection.stage', 'say which inspection this is (a plan, or a stage)');
  // the target must exist: a unit, a work order, a pallet (shipping), a lot is free text (a supplier lot)
  let itemId: string | null = plan?.item_id ?? null, line: string | null = null, lotSize = input.lotSize ?? null;
  if (input.targetType === 'unit') {
    const u = (await ctx.services.get('trk').unit(input.target.toUpperCase(), t)) ?? notFound('unit', input.target);
    itemId = u.item_id; line = u.line_code; lotSize = 1;
  } else if (input.targetType === 'work_order') {
    const w = (await ctx.services.get('exe').workOrderByCode(input.target, t)) ?? notFound('work_order', input.target);
    itemId = w.item_id; line = w.line_code; lotSize ??= w.completed_qty / 1000;
  } else if (input.targetType === 'pallet') {
    if (!ctx.services.has('shp')) fail('inspection.no_shipping', 'pallets belong to the shipping module, which is not installed');
    const units = await ctx.services.get('shp').unitsIn(t, input.target);
    if (!units.length) fail('pallet.empty', `pallet ${input.target} holds no unit`);
    lotSize = units.length;
    const u = await ctx.services.get('trk').unitById(units[0]!, t);
    itemId = u?.item_id ?? itemId; line = u?.line_code ?? null;
  }
  const qms = ctx.services.get('qms');
  for (const f of input.findings) await qms.checkDefect(t, f.defectCode);
  const defects = input.findings.reduce((a: number, f: { qty: number }) => a + f.qty, 0);
  // measurements against the plan's limits (thousandths); a characteristic of the plan that was not measured fails
  const measures: { code: string; value: string; ok: boolean }[] = [];
  if (plan) {
    for (const c of plan.characteristics) {
      const m = input.measurements.find((x: { code: string }) => x.code.toUpperCase() === c.code);
      if (!m) fail('inspection.missing', `${c.code} (${c.name_en}) was not recorded`);
      if (c.kind === 'check') { const ok = m.value === '1' || m.value.toLowerCase() === 'ok'; measures.push({ code: c.code, value: ok ? 'OK' : 'NG', ok }); continue; }
      let v: number;
      try { v = parseQty(m.value); } catch { return fail('inspection.value', `${c.code}: ${m.value} is not a number (up to 3 decimals)`); }
      const lo = c.lsl === null ? null : parseQty(c.lsl), hi = c.usl === null ? null : parseQty(c.usl);
      measures.push({ code: c.code, value: formatQty(v), ok: (lo === null || v >= lo) && (hi === null || v <= hi) });
    }
  }
  let sample = input.sampleSize ?? null, accept: number | null = null;
  if (plan?.aql && lotSize && lotSize >= 2) {
    const sp = samplingPlan(lotSize, plan.aql_level ?? 'II', plan.aql);
    sample = sp.sample; accept = sp.accept;
    if (input.sampleSize !== undefined && input.sampleSize < sp.sample) fail('inspection.sample_short', `the plan needs a sample of ${sp.sample} (${sp.letter}, AQL ${plan.aql}); ${input.sampleSize} were inspected`);
  }
  const result: 'pass' | 'fail' = measures.some((m) => !m.ok) || (accept !== null ? defects > accept : defects > 0) ? 'fail' : 'pass';
  const id = ctx.clock.newId();
  const seq = await chainAppend(t, 'qms_inspection', INSPECTION_FIELDS, {
    id, plan_id: plan?.id ?? null, stage, target_type: input.targetType, target: input.target.toUpperCase(), item_id: itemId, line_code: line, lot_size: lotSize, sample_size: sample,
    accept, defects, result, measures: JSON.stringify(measures), findings: JSON.stringify(input.findings), note: input.note ?? null, inspector: caller.name,
    production_date: today, at: ctx.clock.now().toISOString(), command_id: input.commandId,
  });
  // a failed outgoing inspection holds the whole lot at once
  let hold = null;
  if (result === 'fail' && stage === 'oqc' && (input.targetType === 'pallet' || input.targetType === 'work_order')) {
    hold = await placeHold(ctx, t, caller, { commandId: input.commandId, targetType: input.targetType, target: input.target, reason: `OQC failed: ${defects} defects (accept ${accept ?? 0})` }, `inspection:${seq}`);
  }
  return { id, seq, result, defects, sample, accept, measures, hold };
}

// ------------------------------------------------------------------ holds
async function unitsForHold(ctx: Ctx, t: Db, type: string, target: string, item?: string): Promise<{ units: UnitRow[]; shipped: number }> {
  const trk = ctx.services.get('trk');
  if (type === 'unit' || type === 'serials') {
    const serials = target.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
    const units: UnitRow[] = [];
    for (const s of serials) units.push((await trk.unit(s, t)) ?? notFound('unit', s));
    return split(units);
  }
  if (type === 'work_order') {
    const w = (await ctx.services.get('exe').workOrderByCode(target, t)) ?? (await t.get<{ id: string }>('SELECT id FROM exe_work_order WHERE id = ?', [target])) ?? notFound('work_order', target);
    return split(await t.all<UnitRow>(`SELECT * FROM trk_unit WHERE work_order_id = ? AND status NOT IN ('scrapped', 'consumed')`, [w.id]));
  }
  if (type === 'pallet') {
    if (!ctx.services.has('shp')) fail('hold.no_shipping', 'pallets belong to the shipping module, which is not installed');
    const ids = await ctx.services.get('shp').unitsIn(t, target);
    const units: UnitRow[] = [];
    for (const id of ids) { const u = await trk.unitById(id, t); if (u) units.push(u); }
    return split(units);
  }
  // a material lot (or a part serial): every unit containing it, climbed to the finished product
  const lot = target.toUpperCase();
  let itemId: string | null = null;
  if (item) itemId = (await t.get<{ id: string }>('SELECT id FROM mdm_item WHERE id = ? OR code = ?', [item, item]))?.id ?? null;
  let frontier = (await t.all<{ id: string }>(`SELECT DISTINCT parent_id id FROM trk_genealogy WHERE lot_no = ? AND removed_seq IS NULL ${itemId ? 'AND item_id = ?' : ''}`, itemId ? [lot, itemId] : [lot])).map((r) => r.id);
  const seen = new Set<string>(); const all: UnitRow[] = [];
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      if (seen.has(id)) continue;
      seen.add(id);
      const u = await trk.unitById(id, t);
      if (!u) continue;
      if (u.parent_id) next.push(u.parent_id); else all.push(u);   // the finished product is what is held (its parts are inside it)
    }
    frontier = next;
  }
  return split(all);
}
function split(units: UnitRow[]) {
  const shipped = units.filter((u) => u.status === 'shipped').length;
  return { units: units.filter((u) => u.status !== 'shipped' && u.status !== 'scrapped' && u.status !== 'consumed'), shipped };
}

async function placeHold(ctx: Ctx, t: Db, caller: Caller, input: { commandId: string; targetType: string; target: string; item?: string; reason: string }, source?: string) {
  const { units, shipped } = await unitsForHold(ctx, t, input.targetType, input.target, input.item);
  if (!units.length) conflict('hold.nothing', shipped ? `every unit concerned (${shipped}) has already been shipped: this is a recall, not a hold` : 'no unit in the plant is concerned');
  const n = (await t.get<{ n: number }>('SELECT COUNT(*) n FROM qms_hold'))!.n + 1;
  const id = ctx.clock.newId(), code = 'QH-' + String(n).padStart(6, '0');
  await t.run(`INSERT INTO qms_hold (id, code, target_type, target, reason, units, shipped, status, source, held_at, held_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    [id, code, input.targetType, input.target.toUpperCase().slice(0, 4000), input.reason, units.length, shipped, source ?? null, ctx.clock.now().toISOString(), caller.name]);
  for (const u of units) await t.run('INSERT INTO qms_hold_unit (hold_id, unit_id) VALUES (?, ?)', [id, u.id]);
  await ctx.services.get('trk').hold(t, caller, units.map((u) => u.id), { commandId: input.commandId, holdId: code, reason: input.reason });
  await ctx.services.get('sys').audit(t, caller.name, 'hold.place', code, { target: input.target, type: input.targetType, units: units.length, shipped });
  return { id, code, units: units.length, shipped };
}

async function releaseHold(ctx: Ctx, t: Db, caller: Caller, id: string, input: { commandId: string; disposition: 'release' | 'rework' | 'scrap'; decision: string; defectCode?: string }, signer: { login: string; name: string }) {
  const h = (await t.get<{ id: string; code: string; status: string }>('SELECT * FROM qms_hold WHERE id = ? OR code = ?', [id, id])) ?? notFound('hold', id);
  if (h.status !== 'open') conflict('hold.released', `hold ${h.code} was already released`);
  const units = await t.all<UnitRow>('SELECT u.* FROM qms_hold_unit x JOIN trk_unit u ON u.id = x.unit_id WHERE x.hold_id = ?', [h.id]);
  const trk = ctx.services.get('trk');
  if (input.disposition !== 'release') {
    const finished = units.filter((u) => u.status !== 'wip' && u.status !== 'repair' && u.status !== 'scrapped');
    if (finished.length) conflict('hold.finished_units', `${finished.length} units of ${h.code} are finished (${finished[0]!.serial}…): they can only be released; a finished unit is taken back through a reversal, not by a hold`);
  }
  await trk.release(t, caller, units.map((u) => u.id), { commandId: input.commandId, holdId: h.code });
  let moved = 0;
  if (input.disposition === 'rework' || input.disposition === 'scrap') {
    for (const u of units) {
      const cur = (await trk.unitById(u.id, t))!;
      if (cur.held > 0 || cur.status === 'scrapped') continue;   // still held by another hold, or already gone
      if (input.disposition === 'scrap') await trk.scrapUnit(t, caller, cur.serial, { commandId: input.commandId, reasonCode: 'quality' });
      else if (cur.status === 'wip') await trk.toRepair(t, caller, cur.id, { commandId: input.commandId, defectCode: input.defectCode ?? 'HOLD-' + h.code });
      moved++;
    }
  }
  await t.run(`UPDATE qms_hold SET status = 'released', disposition = ?, decision = ?, released_at = ?, released_by = ?, signed_by = ? WHERE id = ?`,
    [input.disposition, input.decision, ctx.clock.now().toISOString(), caller.name, `${signer.name} (${signer.login})`, h.id]);
  await ctx.services.get('sys').audit(t, caller.name, 'hold.release', h.code, { disposition: input.disposition, decision: input.decision, signed: signer.login, units: units.length, moved });
  return { code: h.code, disposition: input.disposition, units: units.length, moved };
}
