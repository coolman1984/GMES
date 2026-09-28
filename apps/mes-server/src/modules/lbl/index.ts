import { Socket } from 'node:net';
import { z } from 'zod';
import { productionDate } from '../../kernel/clock.js';
import { runCommand } from '../../kernel/commands.js';
import type { Db } from '../../kernel/db.js';
import { conflict, fail, forbidden, notFound } from '../../kernel/errors.js';
import type { AppModule, Caller, Ctx } from '../../kernel/modules.js';

/**
 * Labels: templates written in ZPL (the language of the thermal printers every plant already has) with {variables},
 * printers reached by raw TCP on port 9100, and a log of every print.
 *
 * - A template belongs to a KIND of thing (a serial unit, a pallet, or nothing): its variables are checked against
 *   that kind when it is saved, and every value is looked up from the facts when it prints — never typed in.
 * - A value that carries a ZPL control character (^ or ~) is refused: it could rewrite the label or the printer.
 * - The first print of a label for a thing is a print; any later one is a REPRINT: it needs its own permission and a
 *   reason, because a second label for the same serial is how a unit gets shipped twice.
 * - The log is append-only. The print is recorded first (inside the command, so a retry never prints twice), then
 *   sent; whether the printer took it is a second fact.
 */
export const LABEL_KINDS = ['unit', 'pallet', 'free'] as const;
type Kind = (typeof LABEL_KINDS)[number];
const COMMON = ['date', 'time', 'printed_by', 'plant'];
export const VARIABLES: Record<Kind, string[]> = {
  unit: [...COMMON, 'serial', 'item_code', 'item_name', 'wo', 'line', 'made_on'],
  pallet: [...COMMON, 'pallet', 'item_code', 'item_name', 'units', 'capacity', 'line', 'closed_on'],
  free: COMMON,
};
const variablesOf = (zpl: string) => [...new Set([...zpl.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]!))];

const UNIT_ZPL = `^XA^PW812^LL406
^FO30,25^A0N,34,34^FD{item_name}^FS
^FO30,70^A0N,26,26^FDMODEL {item_code}^FS
^FO30,110^BY2^BCN,90,Y,N,N^FD{serial}^FS
^FO30,250^A0N,24,24^FDMADE IN EGYPT  {made_on}  LINE {line}^FS
^FO30,285^A0N,22,22^FDWO {wo}^FS
^FO600,280^GB180,90,3^FS^FO620,305^A0N,40,40^FDQC OK^FS
^XZ`;
const PALLET_ZPL = `^XA^PW812^LL1218
^FO40,40^A0N,60,60^FDPALLET {pallet}^FS
^FO40,120^A0N,40,40^FD{item_name}^FS
^FO40,175^A0N,34,34^FDMODEL {item_code}^FS
^FO40,240^A0N,90,90^FD{units} / {capacity} PCS^FS
^FO40,370^BY3^BCN,160,Y,N,N^FD{pallet}^FS
^FO40,600^A0N,30,30^FDLINE {line}  CLOSED {closed_on}^FS
^XZ`;

async function valuesFor(ctx: Ctx, t: Db, kind: Kind, target: string | null, caller: Caller): Promise<Record<string, string>> {
  const now = ctx.clock.now();
  const v: Record<string, string> = {
    date: productionDate(now, ctx.config.timeZone, ctx.config.productionDayStart),
    time: new Intl.DateTimeFormat('en-GB', { timeZone: ctx.config.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now),
    printed_by: caller.name, plant: ctx.config.companyId,
  };
  const mdm = ctx.services.get('mdm');
  const day = (iso: string | null) => (iso ? productionDate(new Date(iso), ctx.config.timeZone, ctx.config.productionDayStart) : '');
  if (kind === 'unit') {
    if (!ctx.services.has('trk')) fail('label.no_tracking', 'serial labels need serial tracking');
    const u = await ctx.services.get('trk').unit((target ?? '').trim().toUpperCase(), t);
    if (!u) return notFound('unit', target ?? '');
    if (u.status === 'scrapped') conflict('label.unit_scrapped', `${u.serial} is scrapped: it gets no label`);
    const item = await mdm.item(u.item_id, t);
    const wo = ctx.services.has('exe') ? await ctx.services.get('exe').workOrder(u.work_order_id, t) : null;
    Object.assign(v, { serial: u.serial, item_code: item.code, item_name: item.name_en, wo: wo?.code ?? '', line: u.line_code, made_on: day(u.completed_at ?? u.created_at) });
  } else if (kind === 'pallet') {
    const p = await t.get<{ code: string; item_id: string; units: number; capacity: number; line_code: string; closed_at: string | null; status: string }>(
      'SELECT code, item_id, units, capacity, line_code, closed_at, status FROM shp_pallet WHERE code = ?', [(target ?? '').trim().toUpperCase()]).catch(() => undefined);
    if (!p) return notFound('pallet', target ?? '');
    if (p.status === 'open') conflict('label.pallet_open', `${p.code} is still open: close it first, so its label carries its final quantity`);
    const item = await mdm.item(p.item_id, t);
    Object.assign(v, { pallet: p.code, item_code: item.code, item_name: item.name_en, units: String(p.units), capacity: String(p.capacity), line: p.line_code, closed_on: day(p.closed_at) });
  }
  for (const [k, x] of Object.entries(v)) if (/[\^~]/.test(x)) fail('label.unsafe_value', `the value of {${k}} carries a ZPL control character (^ or ~) and is refused`);
  return v;
}

export function fill(zpl: string, values: Record<string, string>): string {
  return zpl.replace(/\{([a-z_]+)\}/g, (_, k: string) => {
    if (!(k in values)) fail('label.variable_unknown', `{${k}} has no value`);
    return values[k]!;
  });
}

/** Raw TCP to the printer (port 9100). Resolves with null when the printer took every byte, else the error. */
export function sendRaw(host: string, port: number, data: string, timeoutMs = 5000): Promise<string | null> {
  return new Promise((resolve) => {
    const s = new Socket();
    const done = (err: string | null) => { s.destroy(); resolve(err); };
    s.setTimeout(timeoutMs, () => done('timeout'));
    s.once('error', (e) => done(e.message));
    s.connect(port, host, () => s.end(data, 'utf8', () => done(null)));
  });
}

export const lblModule: AppModule = {
  id: 'lbl',
  dependsOn: ['system', 'mdm'],
  scopes: ['lbl.read', 'lbl.write', 'lbl.print', 'lbl.reprint'],
  migrations: [
    {
      id: '001_labels',
      up: `
        CREATE TABLE lbl_template (
          code       TEXT PRIMARY KEY CHECK (length(code) BETWEEN 2 AND 24),
          name_en    TEXT NOT NULL,
          name_ar    TEXT NOT NULL,
          kind       TEXT NOT NULL CHECK (kind IN ('unit', 'pallet', 'free')),
          zpl        TEXT NOT NULL,
          active     INTEGER NOT NULL DEFAULT 1,
          version    INTEGER NOT NULL DEFAULT 1,
          updated_at TEXT NOT NULL,
          updated_by TEXT NOT NULL
        );
        CREATE TABLE lbl_printer (
          code     TEXT PRIMARY KEY CHECK (length(code) BETWEEN 2 AND 24),
          name     TEXT NOT NULL,
          host     TEXT NOT NULL,
          port     INTEGER NOT NULL DEFAULT 9100 CHECK (port BETWEEN 1 AND 65535),
          dpi      INTEGER NOT NULL DEFAULT 203 CHECK (dpi IN (203, 300, 600)),
          line_code TEXT,
          active   INTEGER NOT NULL DEFAULT 1,
          version  INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE lbl_print (
          seq              INTEGER PRIMARY KEY,
          template_code    TEXT NOT NULL,
          template_version INTEGER NOT NULL,
          kind             TEXT NOT NULL,
          target           TEXT,
          printer_code     TEXT NOT NULL,
          copies           INTEGER NOT NULL CHECK (copies BETWEEN 1 AND 20),
          reprint          INTEGER NOT NULL CHECK (reprint IN (0, 1)),
          reason           TEXT,
          zpl              TEXT NOT NULL,
          by_user          TEXT NOT NULL,
          at               TEXT NOT NULL,
          command_id       TEXT NOT NULL,
          CHECK (reprint = 0 OR length(reason) > 0)
        );
        CREATE INDEX lbl_print_target ON lbl_print(template_code, target);
        CREATE TABLE lbl_print_result (
          print_seq INTEGER PRIMARY KEY REFERENCES lbl_print(seq),
          ok        INTEGER NOT NULL,
          error     TEXT,
          at        TEXT NOT NULL
        );
        CREATE TRIGGER lbl_print_immutable BEFORE UPDATE ON lbl_print BEGIN SELECT RAISE(ABORT, 'lbl: the print log is append-only'); END;
        CREATE TRIGGER lbl_print_no_delete BEFORE DELETE ON lbl_print BEGIN SELECT RAISE(ABORT, 'lbl: the print log is append-only'); END;
        CREATE TRIGGER lbl_result_immutable BEFORE UPDATE ON lbl_print_result BEGIN SELECT RAISE(ABORT, 'lbl: the print log is append-only'); END;
        CREATE TRIGGER lbl_result_no_delete BEFORE DELETE ON lbl_print_result BEGIN SELECT RAISE(ABORT, 'lbl: the print log is append-only'); END;
      `,
    },
    {
      // the two labels a TV plant starts with; the plant edits them (a new version each time)
      id: '002_default_labels',
      up: `
        INSERT INTO lbl_template (code, name_en, name_ar, kind, zpl, updated_at, updated_by) VALUES
          ('UNIT', 'Unit serial label', 'ملصق سيريال المنتج', 'unit', '${UNIT_ZPL}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system'),
          ('PALLET', 'Pallet label', 'ملصق البالتة', 'pallet', '${PALLET_ZPL}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system');
      `,
    },
  ],

  routes({ http, require }, ctx) {
    http.get('/api/label-templates', async (req) => {
      require(req, 'lbl.read');
      return (await ctx.db.all<Record<string, unknown> & { kind: Kind }>('SELECT * FROM lbl_template ORDER BY code')).map((r) => ({ ...r, variables: VARIABLES[r.kind] }));
    });

    http.put('/api/label-templates/:code', async (req) => {
      const caller = require(req, 'lbl.write');
      const { code } = z.object({ code: z.string().regex(/^[A-Z0-9_-]{2,24}$/, 'capital letters, digits, - and _ (2 to 24)') }).parse(req.params);
      const input = z.object({ commandId: z.string(), name_en: z.string().trim().min(1).max(60), name_ar: z.string().trim().min(1).max(60), kind: z.enum(LABEL_KINDS),
        zpl: z.string().min(6).max(20000), active: z.boolean().default(true), version: z.number().int().optional() }).parse(req.body);
      if (!/^\s*\^XA/.test(input.zpl) || !/\^XZ\s*$/.test(input.zpl)) fail('label.not_zpl', 'a ZPL label starts with ^XA and ends with ^XZ');
      const unknown = variablesOf(input.zpl).filter((v) => !VARIABLES[input.kind].includes(v));
      if (unknown.length) fail('label.variable_unknown', `a ${input.kind} label has no ${unknown.map((u) => `{${u}}`).join(', ')}; it can use ${VARIABLES[input.kind].map((u) => `{${u}}`).join(', ')}`);
      const { result, replayed } = await runCommand(ctx, caller, { id: input.commandId, type: 'PutLabelTemplate', request: { code, ...input } }, async (t) => {
        const old = await t.get<{ version: number }>('SELECT version FROM lbl_template WHERE code = ?', [code]);
        const at = ctx.clock.now().toISOString();
        if (!old) {
          await t.run('INSERT INTO lbl_template (code, name_en, name_ar, kind, zpl, active, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [code, input.name_en, input.name_ar, input.kind, input.zpl, input.active ? 1 : 0, at, caller.name]);
          return { code, version: 1 };
        }
        if (input.version !== undefined && input.version !== old.version) conflict('stale', `label ${code} was changed by someone else; reload it`);
        await t.run('UPDATE lbl_template SET name_en = ?, name_ar = ?, kind = ?, zpl = ?, active = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE code = ?',
          [input.name_en, input.name_ar, input.kind, input.zpl, input.active ? 1 : 0, at, caller.name, code]);
        await ctx.services.get('sys').audit(t, caller.name, 'label.template', code, { version: old.version + 1 });
        return { code, version: old.version + 1 };
      });
      return { ...result, replayed };
    });

    http.get('/api/printers', async (req) => {
      require(req, 'lbl.read');
      return ctx.db.all('SELECT * FROM lbl_printer ORDER BY code');
    });

    http.put('/api/printers/:code', async (req) => {
      const caller = require(req, 'lbl.write');
      const { code } = z.object({ code: z.string().regex(/^[A-Z0-9_-]{2,24}$/, 'capital letters, digits, - and _ (2 to 24)') }).parse(req.params);
      const input = z.object({ commandId: z.string(), name: z.string().trim().min(1).max(60), host: z.string().trim().regex(/^[A-Za-z0-9.-]{1,253}$/, 'a host name or IPv4 address'),
        port: z.number().int().min(1).max(65535).default(9100), dpi: z.union([z.literal(203), z.literal(300), z.literal(600)]).default(203),
        line: z.string().min(1).nullable().optional(), active: z.boolean().default(true) }).parse(req.body);
      const { result, replayed } = await runCommand(ctx, caller, { id: input.commandId, type: 'PutPrinter', request: { code, ...input } }, async (t) => {
        const old = await t.get('SELECT 1 FROM lbl_printer WHERE code = ?', [code]);
        if (old) await t.run('UPDATE lbl_printer SET name = ?, host = ?, port = ?, dpi = ?, line_code = ?, active = ?, version = version + 1 WHERE code = ?',
          [input.name, input.host, input.port, input.dpi, input.line ?? null, input.active ? 1 : 0, code]);
        else await t.run('INSERT INTO lbl_printer (code, name, host, port, dpi, line_code, active) VALUES (?, ?, ?, ?, ?, ?, ?)', [code, input.name, input.host, input.port, input.dpi, input.line ?? null, input.active ? 1 : 0]);
        return { code };
      });
      return { ...result, replayed };
    });

    // the label as it would print, with the values it would carry (for the preview), and whether it would be a reprint
    http.post('/api/labels/render', async (req) => {
      const caller = require(req, 'lbl.read');
      const input = z.object({ template: z.string(), target: z.string().nullable().optional() }).parse(req.body);
      const tpl = await ctx.db.get<{ code: string; kind: Kind; zpl: string; version: number }>('SELECT code, kind, zpl, version FROM lbl_template WHERE code = ?', [input.template]);
      if (!tpl) return notFound('label template', input.template);
      const values = await valuesFor(ctx, ctx.db, tpl.kind, input.target ?? null, caller);
      const target = tpl.kind === 'unit' ? values.serial! : tpl.kind === 'pallet' ? values.pallet! : null;
      const printed = target ? await ctx.db.all('SELECT seq, reprint, reason, by_user, at FROM lbl_print WHERE template_code = ? AND target = ? ORDER BY seq', [tpl.code, target]) : [];
      return { template: tpl.code, version: tpl.version, kind: tpl.kind, target, values, zpl: fill(tpl.zpl, values), printed, reprint: printed.length > 0 };
    });

    http.post('/api/labels/print', async (req) => {
      const caller = require(req, 'lbl.print');
      const input = z.object({ commandId: z.string(), template: z.string(), target: z.string().nullable().optional(), printer: z.string(),
        copies: z.number().int().min(1).max(20).default(1), reason: z.string().trim().min(3).max(200).optional() }).parse(req.body);
      const { result, replayed } = await runCommand(ctx, caller, { id: input.commandId, type: 'PrintLabel', request: req.body }, async (t) => {
        const tpl = await t.get<{ code: string; kind: Kind; zpl: string; version: number; active: number }>('SELECT code, kind, zpl, version, active FROM lbl_template WHERE code = ?', [input.template]);
        if (!tpl) return notFound('label template', input.template);
        if (!tpl.active) conflict('label.inactive', `label ${tpl.code} is no longer in use`);
        const printer = await t.get<{ code: string; host: string; port: number; active: number }>('SELECT code, host, port, active FROM lbl_printer WHERE code = ?', [input.printer]);
        if (!printer) return notFound('printer', input.printer);
        if (!printer.active) conflict('printer.inactive', `printer ${printer.code} is not in use`);
        const values = await valuesFor(ctx, t, tpl.kind, input.target ?? null, caller);
        const target = tpl.kind === 'unit' ? values.serial! : tpl.kind === 'pallet' ? values.pallet! : null;
        const before = target ? await t.get<{ n: number }>('SELECT COUNT(*) n FROM lbl_print WHERE template_code = ? AND target = ?', [tpl.code, target]) : { n: 0 };
        const reprint = before!.n > 0;
        if (reprint) {
          if (!caller.scopes.has('lbl.reprint') && !caller.scopes.has('lbl.*') && !caller.scopes.has('*')) forbidden('label.reprint_forbidden', `${target} already has its label; a reprint needs the lbl.reprint permission`);
          if (!input.reason) fail('label.reason_required', `${target} already has its label: say why it is printed again`);
        }
        const zpl = fill(tpl.zpl, values).replace(/\^XZ\s*$/, `^PQ${input.copies}^XZ`);
        const r = await t.run(`INSERT INTO lbl_print (template_code, template_version, kind, target, printer_code, copies, reprint, reason, zpl, by_user, at, command_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [tpl.code, tpl.version, tpl.kind, target, printer.code, input.copies, reprint ? 1 : 0, reprint ? input.reason! : null,
          zpl, caller.name, ctx.clock.now().toISOString(), input.commandId]);
        return { seq: r.lastId, target, reprint, host: printer.host, port: printer.port, zpl };
      });
      // sent after the commit, once: a retried command finds its print already recorded and does not print again
      let sent: string | null = 'already sent';
      if (!replayed) {
        sent = await sendRaw(result.host, result.port, result.zpl);
        await ctx.db.run('INSERT INTO lbl_print_result (print_seq, ok, error, at) VALUES (?, ?, ?, ?)', [result.seq, sent === null ? 1 : 0, sent, ctx.clock.now().toISOString()]);
      }
      return { seq: result.seq, target: result.target, reprint: result.reprint, sent: sent === null, error: replayed ? null : sent, replayed };
    });

    http.get('/api/labels/prints', async (req) => {
      require(req, 'lbl.read');
      const q = z.object({ target: z.string().optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), limit: z.coerce.number().int().min(1).max(2000).default(300) }).parse(req.query);
      const where: string[] = [], p: (string | number)[] = [];
      if (q.target) { where.push('p.target = ?'); p.push(q.target.trim().toUpperCase()); }
      if (q.date) { where.push('substr(p.at, 1, 10) = ?'); p.push(q.date); }
      p.push(q.limit);
      return ctx.db.all(`SELECT p.seq, p.template_code, p.template_version, p.kind, p.target, p.printer_code, p.copies, p.reprint, p.reason, p.by_user, p.at, r.ok, r.error
        FROM lbl_print p LEFT JOIN lbl_print_result r ON r.print_seq = p.seq ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.seq DESC LIMIT ?`, p);
    });
  },
};
