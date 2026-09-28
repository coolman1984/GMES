import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { tvPlant } from './plants.js';

// the screens' own file, loaded as the browser loads it (an ES module with no imports)
const { code128Values, code128Widths } = await import('data:text/javascript,' + encodeURIComponent(readFileSync(new URL('../../mes-web/barcode.js', import.meta.url), 'utf8')));

let n = 0;
const cmd = () => `ops-cmd-${++n}-${Date.now()}`;

test('Code 128 B: the check character is the weighted sum modulo 103, and every symbol is 11 modules wide', () => {
  assert.deepEqual(code128Values('ABC'), [104, 33, 34, 35, 1]);
  assert.deepEqual(code128Values('NT55Q9A00012345').slice(-1), [(104 + [...'NT55Q9A00012345'].reduce((a, c, i) => a + (c.charCodeAt(0) - 32) * (i + 1), 0)) % 103]);
  const w = code128Widths('TV-55');
  assert.equal(w.reduce((a: number, x: number) => a + x, 0), (5 + 2) * 11 + 13, 'start, 5 characters, check, stop');
  assert.throws(() => code128Values('é'), /printable ASCII/);
});

describe('OEE, reports, handover, labels and operations of a TV plant (OEE*, RPT*, LBL*, SYS9030-SYS9100)', () => {
  let s: Awaited<ReturnType<typeof tvPlant>>;
  let printer: Server;
  let received = '';
  let printerPort = 0;
  const scan = (station: string, serial: string, extra: Record<string, unknown> = {}) => s.call('POST', '/api/units/scan', { commandId: cmd(), station, serial, ...extra });
  before(async () => {
    s = await tvPlant();
    // shift A 07:00-15:00 with a 48-minute break (6 % of the shift)
    await s.ok('PUT', '/api/production-shifts/A', { nameEn: 'Morning', start: '07:00', end: '15:00', breakMin: 48 });
    await s.ok('POST', '/api/work-orders', { commandId: cmd(), itemId: s.ids.pba, warehouseId: s.wh, plannedQty: '10', line: 'SMD-01' });
    await s.ok('POST', '/api/work-orders', { commandId: cmd(), itemId: s.ids.tv, warehouseId: s.wh, plannedQty: '10', line: 'MA-01', shift: 'A' });
    await s.ok('POST', '/api/stations/MA-01-PK/loads', { commandId: cmd(), itemId: s.ids.carton, lotNo: 'CTN-OP', warehouseId: s.wh });
    for (const tv of ['OPS-TV-01', 'OPS-TV-02']) {
      const pba = 'PBA-' + tv;
      for (const [st, sr, extra] of [['SMD-01-LD', pba, {}], ['SMD-01-AOI', pba, {}], ['MA-01-PL', tv, { parts: [{ serial: 'PNL-' + tv, itemId: s.ids.panel }] }],
        ['MA-01-MB', tv, { parts: [{ serial: pba }] }], ['MA-01-FT', tv, {}], ['MA-01-PK', tv, {}]] as const) {
        const r = await scan(st, sr, extra as Record<string, unknown>);
        assert.equal(r.status, 200, `${st} ${sr}: ${JSON.stringify(r.body)}`);
      }
    }
    printer = createServer((sock) => sock.on('data', (d) => { received += d.toString('utf8'); }));
    await new Promise<void>((r) => printer.listen(0, '127.0.0.1', () => r()));
    printerPort = (printer.address() as { port: number }).port;
  });
  after(async () => { printer.close(); await s.close(); });

  test('stop reasons are the plant\'s own list; an unknown or switched-off reason is refused', async () => {
    const reasons = await s.ok('GET', '/api/stop-reasons');
    assert.deepEqual(reasons.map((r: any) => r.code).sort(), ['break', 'breakdown', 'changeover', 'material', 'other', 'quality']);
    assert.equal(reasons.find((r: any) => r.code === 'break').planned, 1);
    assert.equal((await s.call('POST', '/api/stoppages', { commandId: cmd(), line: 'MA-01', reason: 'coffee' })).body.error.code, 'stop.reason_unknown');
    await s.ok('PUT', '/api/stop-reasons/cooling', { commandId: cmd(), name_en: 'Cooling water', name_ar: 'مياه التبريد', loss: 'breakdown', active: false });
    assert.equal((await s.call('POST', '/api/stoppages', { commandId: cmd(), line: 'MA-01', reason: 'cooling' })).body.error.code, 'stop.reason_inactive');
    assert.equal((await s.call('PUT', '/api/stop-reasons/cooling', { commandId: cmd(), name_en: 'x', name_ar: 'س', loss: 'breakdown', version: 99 })).body.error.code, 'stale');
    await assert.rejects(s.app.ctx.db.run(`DELETE FROM oee_reason WHERE code = 'cooling'`), /never deleted/);
  });

  test('OEE follows ISO 22400 from the facts: shift time, planned and unplanned stops counted once, ideal cycle from the routing', async () => {
    // a planned break 08:30-08:40, a breakdown 08:35-08:55 (overlapping it by 5 minutes), now 09:00 (12:00 in Cairo)
    s.clock.set('2026-09-27T08:30:00.000Z');
    const brk = await s.ok('POST', '/api/stoppages', { commandId: cmd(), line: 'MA-01', reason: 'break' });
    s.clock.set('2026-09-27T08:35:00.000Z');
    const bd = await s.ok('POST', '/api/stoppages', { commandId: cmd(), line: 'MA-01', station: 'MA-01-FT', reason: 'breakdown' });
    s.clock.set('2026-09-27T08:40:00.000Z');
    await s.ok('POST', `/api/stoppages/${brk.id}/end`, { commandId: cmd() });
    s.clock.set('2026-09-27T08:55:00.000Z');
    await s.ok('POST', `/api/stoppages/${bd.id}/end`, { commandId: cmd() });
    s.clock.set('2026-09-27T09:00:00.000Z');
    const [o] = await s.ok('GET', '/api/oee?line=MA-01&date=2026-09-27');
    // 07:00-12:00 = 300 min less the break share (48 x 300/480 = 30) = 270; less the planned stop (10) = 260 busy;
    // the breakdown 20 min, of which 5 inside the break = 15 down; 245 running; 2 TVs x 42 s = 1.4 min ideal
    assert.deepEqual([o.plannedMin, o.plannedStopMin, o.busyMin, o.downtimeMin, o.runMin, o.idealMin], [270, 10, 260, 15, 245, 1.4]);
    assert.deepEqual([o.availability, o.performance, o.quality, o.oee], [94.2, 0.6, 100, 0.5]);
    assert.deepEqual(o.shiftsWorked, ['A']);
    assert.deepEqual(o.losses, { planned: 10, breakdown: 20 });
    const b = await s.ok('GET', '/api/oee?line=MA-01&date=2026-09-27&shift=B');
    assert.equal(b[0].plannedMin, 0, 'shift B has not started, and the line did not work in it');
    const loss = await s.ok('GET', '/api/oee/losses?from=2026-09-27&to=2026-09-27');
    assert.equal(loss.unplannedMinutes, 20);
    assert.equal(loss.reasons[0].reason, 'breakdown');
    assert.equal(loss.reasons[0].cumulativePct, 100);
    assert.equal(loss.reasons.find((r: any) => r.reason === 'break').cumulativePct, null, 'planned stops are not in the Pareto');
    const trend = await s.ok('GET', '/api/oee/trend?line=MA-01&from=2026-09-25&to=2026-09-27');
    assert.deepEqual(trend.map((d: any) => d.oee), [null, null, 0.5]);
    assert.equal((await s.call('GET', '/api/oee/trend?line=MA-01&from=2026-01-01&to=2026-09-27')).body.error.code, 'range.too_long');
    const board = await s.ok('GET', '/api/boards/line/MA-01?date=2026-09-27');
    assert.equal(board.oee.oee, 0.5, 'the line board shows the same OEE');
  });

  test('the daily report and the scrap report are computed from the ledger and the unit history', async () => {
    await s.ok('POST', '/api/units/scan', { commandId: cmd(), station: 'SMD-01-LD', serial: 'PBA-OPS-X' });
    const fail = await s.call('POST', '/api/units/scan', { commandId: cmd(), station: 'SMD-01-AOI', serial: 'PBA-OPS-X', result: 'FAIL', defectCode: 'D-SOLDER' });
    const daily = await s.ok('GET', '/api/reports/daily?date=2026-09-27');
    const ma = daily.lines.find((l: any) => l.line === 'MA-01');
    assert.deepEqual([ma.planned, ma.good, ma.scrap, ma.attainment, ma.oee], [10, 2, 0, 20, 0.5]);
    assert.equal(daily.totals.good, 4, '2 main boards and 2 TVs');
    assert.equal(daily.orders.length, 2);
    const scrap = await s.ok('GET', '/api/reports/scrap?from=2026-09-27&to=2026-09-27');
    assert.equal(scrap.good, 4);
    assert.equal(scrap.fails, fail.status === 200 ? 1 : 0);
  });

  test('shift handover: notes are append-only, a correction points to its note, receipt is kept once', async () => {
    const note = await s.ok('POST', '/api/handover/notes', { commandId: cmd(), date: '2026-09-27', shift: 'A', line: 'MA-01', kind: 'maintenance', text: 'FT fixture 2 intermittent: watch it' });
    await s.ok('POST', '/api/handover/notes', { commandId: cmd(), date: '2026-09-27', shift: 'A', line: 'MA-01', kind: 'maintenance', text: 'It is fixture 3, not 2', corrects: note.seq });
    assert.equal((await s.call('POST', '/api/handover/notes', { commandId: cmd(), date: '2026-09-27', shift: 'A', kind: 'other', text: 'x', corrects: 999 })).body.error.code, 'note.unknown');
    await assert.rejects(s.app.ctx.db.run(`UPDATE rpt_note SET text = 'nothing happened'`), /append-only/);
    const h = await s.ok('GET', '/api/handover?date=2026-09-27&shift=A&line=MA-01');
    assert.equal(h.notes.length, 2);
    assert.equal(h.notes[1].corrects_seq, note.seq);
    assert.equal(h.output[0].good, 2);
    assert.equal(h.stoppages.length, 2);
    assert.equal(h.received, null);
    const r1 = await s.ok('POST', '/api/handover/receive', { commandId: cmd(), date: '2026-09-27', shift: 'A', line: 'MA-01' });
    const r2 = await s.ok('POST', '/api/handover/receive', { commandId: cmd(), date: '2026-09-27', shift: 'A', line: 'MA-01' });
    assert.deepEqual(r2.received, r1.received, 'received once; a second confirmation changes nothing');
  });

  test('labels: values come from the facts, a reprint needs a reason and its permission, the printer gets the ZPL once', async () => {
    await s.ok('PUT', '/api/printers/ZT-MA01', { commandId: cmd(), name: 'MA-01 pack', host: '127.0.0.1', port: printerPort });
    const tpl = (await s.ok('GET', '/api/label-templates')).find((x: any) => x.code === 'UNIT');
    assert.ok(tpl.variables.includes('serial'));
    const preview = await s.ok('POST', '/api/labels/render', { template: 'UNIT', target: 'ops-tv-01' });
    assert.equal(preview.values.serial, 'OPS-TV-01');
    assert.equal(preview.values.item_code, 'TV-55');
    assert.equal(preview.values.line, 'MA-01');
    assert.match(preview.zpl, /\^FDOPS-TV-01\^FS/);
    assert.equal(preview.reprint, false);
    const c1 = cmd();
    const first = await s.ok('POST', '/api/labels/print', { commandId: c1, template: 'UNIT', target: 'OPS-TV-01', printer: 'ZT-MA01' });
    assert.deepEqual([first.reprint, first.sent], [false, true]);
    await new Promise((r) => setTimeout(r, 50));
    assert.match(received, /\^FDOPS-TV-01\^FS[\s\S]*\^PQ1\^XZ/);
    const before = received.length;
    const again = await s.ok('POST', '/api/labels/print', { commandId: c1, template: 'UNIT', target: 'OPS-TV-01', printer: 'ZT-MA01' });
    assert.equal(again.replayed, true);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(received.length, before, 'a retried command does not print twice');
    assert.equal((await s.call('POST', '/api/labels/print', { commandId: cmd(), template: 'UNIT', target: 'OPS-TV-01', printer: 'ZT-MA01' })).body.error.code, 'label.reason_required');
    const re = await s.ok('POST', '/api/labels/print', { commandId: cmd(), template: 'UNIT', target: 'OPS-TV-01', printer: 'ZT-MA01', reason: 'label torn at packing', copies: 2 });
    assert.equal(re.reprint, true);
    const log = await s.ok('GET', '/api/labels/prints?target=OPS-TV-01');
    assert.deepEqual(log.map((p: any) => [p.reprint, p.ok]), [[1, 1], [0, 1]]);
    await assert.rejects(s.app.ctx.db.run(`DELETE FROM lbl_print`), /append-only/);
    // a template may only use the values of its kind; a value that carries ZPL control characters is refused
    assert.equal((await s.call('PUT', '/api/label-templates/BAD', { commandId: cmd(), name_en: 'b', name_ar: 'ب', kind: 'pallet', zpl: '^XA^FD{serial}^FS^XZ' })).body.error.code, 'label.variable_unknown');
    assert.equal((await s.call('PUT', '/api/label-templates/BAD', { commandId: cmd(), name_en: 'b', name_ar: 'ب', kind: 'free', zpl: 'hello printer' })).body.error.code, 'label.not_zpl');
    await s.ok('PUT', '/api/label-templates/SHIFT', { commandId: cmd(), name_en: 'Shift', name_ar: 'وردية', kind: 'free', zpl: '^XA^FD{printed_by} {date}^FS^XZ' });
    assert.equal((await s.call('POST', '/api/keys', { name: 'bad^name', scopes: ['lbl.print'] })).status, 400);
    // a name that reaches a label with a caret in it (here forced into the table) cannot rewrite the label
    const k = await s.ok('POST', '/api/keys', { name: 'printer.PQ99', scopes: ['lbl.print', 'lbl.read'] });
    assert.equal((await s.call('POST', '/api/labels/print', { commandId: cmd(), template: 'SHIFT', printer: 'ZT-MA01' }, k.key)).status, 200);
    await s.app.ctx.db.run(`UPDATE sys_key SET name = 'evil^XZ' WHERE name = 'printer.PQ99'`);
    assert.equal((await s.call('POST', '/api/labels/print', { commandId: cmd(), template: 'SHIFT', printer: 'ZT-MA01' }, k.key)).body.error.code, 'label.unsafe_value');
  });

  test('keys: shown once, listed without their secret, revoked at once', async () => {
    const made = await s.ok('POST', '/api/keys', { name: 'station-MA01-FT', scopes: ['trk.units.write', 'trk.units.read'] });
    assert.match(made.key, /^gk_/);
    const list = await s.ok('GET', '/api/keys');
    const row = list.find((k: any) => k.name === 'station-MA01-FT');
    assert.deepEqual(row.scopes, ['trk.units.write', 'trk.units.read']);
    assert.ok(!JSON.stringify(list).includes(made.key) && !('key_hash' in row), 'the list never carries a key or its hash');
    assert.equal((await s.call('GET', '/api/wip', undefined, made.key)).status, 200);
    assert.equal((await s.call('POST', '/api/keys', { name: 'station-MA01-FT', scopes: ['trk.units.read'] })).body.error.code, 'key.name_taken');
    await s.ok('POST', '/api/keys/station-MA01-FT/revoke', {});
    assert.equal((await s.call('GET', '/api/wip', undefined, made.key)).status, 401, 'a revoked key stops at once');
    assert.equal((await s.call('POST', '/api/keys/station-MA01-FT/revoke', {})).body.error.code, 'key.revoked');
  });

  test('a backup is a rehearsed copy: it opens read-only, it is intact, every module check passes on it, a rotted copy is found', async () => {
    const b = await s.ok('POST', '/api/system/backups', {});
    assert.equal(b.rehearsal.ok, true, JSON.stringify(b.rehearsal.checks.filter((c: any) => !c.ok)));
    assert.equal(b.rehearsal.integrity, 'ok');
    assert.ok(b.rehearsal.checks.some((c: any) => c.module === 'trk'), 'the unit history chain was checked on the copy');
    assert.equal(b.rehearsal.tables.trk_unit, (await s.app.ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM trk_unit'))!.n);
    const list = await s.ok('GET', '/api/system/backups');
    assert.equal(list.backups[0].name, b.name);
    assert.equal((await s.ok('POST', `/api/system/backups/${b.name}/verify`, {})).rehearsal.ok, true);
    // the copy loses a unit on disk: verify finds it
    const { DatabaseSync } = await import('node:sqlite');
    const raw = new DatabaseSync(`${list.dir}/${b.name}`);
    raw.exec('DROP TRIGGER IF EXISTS trk_unit_no_delete; DELETE FROM trk_unit WHERE rowid = (SELECT MIN(rowid) FROM trk_unit)');
    raw.close();
    const v = await s.ok('POST', `/api/system/backups/${b.name}/verify`, {});
    assert.equal(v.rehearsal.ok, false);
    assert.ok(v.rehearsal.mismatches.some((m: string) => m.startsWith('trk_unit')));
    assert.equal((await s.call('POST', '/api/system/backups/../../etc/verify', {})).status, 404);
  });

  test('the installation describes itself and its roles; a viewer cannot back up', async () => {
    const info = await s.ok('GET', '/api/system/info');
    assert.equal(info.timeZone, 'Africa/Cairo');
    assert.ok(info.modules.some((m: any) => m.id === 'lbl' && m.migrations === 2));
    const roles = await s.ok('GET', '/api/system/roles');
    const op = roles.roles.find((r: any) => r.role === 'OPERATOR');
    assert.ok(op.scopes.includes('lbl.print') && !op.scopes.includes('lbl.reprint'), 'an operator prints, a reprint needs a supervisor');
    assert.ok(roles.scopes.includes('system.backup'));
    assert.equal((await s.call('POST', '/api/system/backups', {}, s.keys.reader)).status, 403);
  });
});
