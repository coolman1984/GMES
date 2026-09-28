/**
 * End to end, black box: the REAL HR-System (Python, pinned by scripts/fetch-hr.ps1) processes the
 * synthetic workforce files and publishes through its own eco_publisher.py to a real manufacturing
 * server over HTTP. Covers docs/ecosystem/05 scenario S9 (who worked, and may they work).
 */
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { hrId, newUuidv7 } from '@eco/contracts';
import { buildApp, type App } from '../src/app.js';
import { addKey } from '../src/modules/system/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const HR = [process.env.HR_DIR, resolve(here, '../../../.cache/hr-system'), resolve(here, '../../../../hr-system')]
  .find((d) => d && existsSync(join(d, 'eco_publisher.py')));
const PY = process.env.PYTHON ?? 'python3';
if (!HR && process.env.ECO_E2E_REQUIRED === '1') throw new Error('ECO_E2E_REQUIRED=1 but no HR-System checkout: run scripts/fetch-hr.ps1');

describe('HR-System -> manufacturing, end to end', { skip: HR ? false : 'no HR-System checkout (run scripts/fetch-hr.ps1 or set HR_DIR)' }, () => {
  const company = newUuidv7();
  const hrData = mkdtempSync(join(tmpdir(), 'hr-e2e-'));
  const mesDb = join(mkdtempSync(join(tmpdir(), 'gmes-hr-e2e-')), 'gmes.db');
  let app: App;
  let port = 0;
  let hrKey = '';
  let opKey = '';
  let adminKey = '';

  const startMes = async () => {
    app = await buildApp({ dbFile: mesDb, config: { companyId: company, node: 'plant-1', timeZone: 'Africa/Cairo', productionDayStart: '07:00', ownership: { item: 'gmes', warehouse: 'gmes', person: 'hr' } } });
    await app.http.listen({ port, host: '127.0.0.1' });
    port = (app.http.server.address() as { port: number }).port;
  };
  const hr = (code: string) => execFileSync(PY, ['-c', code], { cwd: HR!, env: { ...process.env, EXCEL_APP_DATA_DIR: hrData, PYTHONPATH: join(HR!, 'vendor.zip') }, encoding: 'utf8' });
  // Asynchronous on purpose: the manufacturing server lives in THIS process, and a synchronous child
  // process would freeze the very event loop that must answer the publisher (found the hard way: a timeout).
  const publish = () =>
    new Promise<any>((ok, fail) =>
      execFile(PY, ['eco_publisher.py', '--once'], {
        cwd: HR!, encoding: 'utf8',
        env: { ...process.env, EXCEL_APP_DATA_DIR: hrData, PYTHONPATH: join(HR!, 'vendor.zip'), ECO_COMPANY_ID: company, ECO_GMES_URL: `http://127.0.0.1:${port}`, ECO_GMES_KEY: hrKey },
      }, (err, stdout, stderr) => (err ? fail(new Error(stderr || err.message)) : ok(JSON.parse(stdout.trim().split('\n').at(-1)!)))),
    );
  const call = async (method: string, path: string, body?: unknown, key = adminKey) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'content-type': 'application/json', 'x-eco-key': key }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };

  before(async () => {
    await startMes();
    hrKey = await addKey(app.ctx, 'hr-system', ['eco.inbox.write']);
    opKey = await addKey(app.ctx, 'station-1', ['exe.orders.write', 'exe.orders.read']);
    adminKey = await addKey(app.ctx, 'admin', ['*']);
    const c = 'inputs/hr-factory-synthetic-dataset/01_CLEAN_BASELINE/';
    hr(`import engine; engine.process_file('${c}05_Time_Attendance_Leave.xlsx', auxiliary_paths={'employee': '${c}02_Employee_Master.xlsx', 'roster': '${c}06_Shifts_Overtime.xlsx', 'leave': '${c}05_Time_Attendance_Leave.xlsx'})`);
  });
  after(async () => app?.close());

  test('the contract HR validates against is byte for byte the one generated here (no drift)', () => {
    const generated = resolve(here, '../../../packages/eco-contracts/schemas');
    for (const f of readdirSync(join(HR!, 'eco_schemas')).filter((n) => n.endsWith('.schema.json'))) {
      assert.equal(readFileSync(join(HR!, 'eco_schemas', f), 'utf8'), readFileSync(join(generated, f), 'utf8'), `${f} drifted`);
    }
    // the canonical JSON / journal-hash vectors (ADR-026) are the same file in both repositories
    assert.equal(readFileSync(join(HR!, 'eco_schemas', 'canonical-v1.json'), 'utf8'),
      readFileSync(resolve(here, '../../../packages/eco-contracts/vectors/canonical-v1.json'), 'utf8'), 'canonical vectors drifted');
  });

  test('HR publishes; manufacturing mirrors every confirmed employee under the shared id', async () => {
    const r = await publish();
    assert.equal(r.stopped_by, undefined);
    assert.equal(r.delivered, 400);
    const employees = (await call('GET', '/api/employees')).body;
    assert.equal(employees.length, 200);
    assert.equal(employees.find((e: any) => e.code === 'E000001').id, hrId(company, 'employee', 'E000001'));
    assert.equal((await publish()).sent, 0, 'nothing changed, nothing sent');
  });

  test('production is booked only by employees HR knows; the booked identity is HR\'s', async () => {
    const item = (await call('POST', '/api/items', { code: 'FG', nameEn: 'FG', nameAr: 'FG' })).body.id;
    const wh = (await call('POST', '/api/warehouses', { code: 'W', nameEn: 'W', nameAr: 'W' })).body.id;
    const wo = (await call('POST', '/api/work-orders', { commandId: 'hr-e2e-create', itemId: item, plannedQty: '3', warehouseId: wh }, opKey)).body.id;
    const ok = await call('POST', `/api/work-orders/${wo}/complete`, { commandId: 'hr-e2e-done-1', qty: '1', person: { id: hrId(company, 'employee', 'E000001'), code: 'E000001' } }, opKey);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const nobody = await call('POST', `/api/work-orders/${wo}/complete`, { commandId: 'hr-e2e-done-2', qty: '1', person: { id: hrId(company, 'employee', 'E999999'), code: 'E999999' } }, opKey);
    assert.equal(nobody.body.error.code, 'person.unknown');
  });

  test('once HR has its own registry, manufacturing receives employees with their organisation, without duplicates', async () => {
    const c = 'inputs/hr-factory-synthetic-dataset/01_CLEAN_BASELINE/';
    hr(`import sys; sys.argv = ['x']; import hr_registry, os; os.environ['ECO_COMPANY_ID'] = '${company}'; ` +
      `sys.exit(hr_registry.main(['import', '${c}01_Organization_Factory.xlsx', '${c}02_Employee_Master.xlsx', '--actor', 'e2e']))`);
    const r = await publish();
    assert.equal(r.stopped_by, undefined);
    assert.ok(r.delivered >= 197, JSON.stringify(r));
    const employees = (await call('GET', '/api/employees')).body;
    assert.equal(employees.length, 200, 'same people, same ids: nobody duplicated by the switch to the registry');
    const e1 = employees.find((e: any) => e.code === 'E000001');
    assert.equal(e1.id, hrId(company, 'employee', 'E000001'));
    assert.match(e1.department_code, /^DEP-/);
    assert.equal(e1.position_code, 'POS-0001');
    assert.equal(e1.display_name, 'Ahmed');
    assert.equal((await publish()).sent, 0);
  });

  test('HR plans shifts and qualifies people; manufacturing mirrors the plan and turns away the unqualified (phases 3 and 5)', async () => {
    const today = hr('from datetime import date; print(date.today().isoformat())').trim();
    hr([
      'import os', 'from hr_core.registry import Registry', `r = Registry(os.environ['EXCEL_APP_DATA_DIR'], '${company}')`,
      "e = r.get('employee', 'E000001')",
      "r.commit('e2e', 'plan', [r.op_put('shift', 'DAY', {'name': 'Day', 'start_time': '07:00', 'end_time': '15:00', 'break_minutes': 30, 'grace_minutes': 10}), " +
        "r.op_put('work_calendar', 'EG', {'name': 'Egypt', 'rest_days': '', 'holidays': ''})])",
      `r.commit('e2e', 'assign', [r.op_put('shift_assignment', 'E000001-${today}-R', {'employee_id': e['id'], 'shift_id': r.get('shift', 'DAY')['id'], ` +
        `'calendar_id': r.get('work_calendar', 'EG')['id'], 'kind': 'regular', 'valid_from': '${today}'})])`,
      "r.commit('e2e', 'skill', [r.op_put('skill', 'WELD', {'name': 'MIG welding', 'validity_months': None})])",
      "r.commit('e2e', 'qualify', [r.op_put('employee_skill', 'E000001-WELD', {'employee_id': e['id'], 'skill_id': r.get('skill', 'WELD')['id'], 'level': 3, 'certified_on': '2026-01-01'})])",
    ].join('\n'));
    const r = await publish();
    assert.equal(r.stopped_by, undefined, JSON.stringify(r));
    assert.equal(r.rejected, 0, JSON.stringify(r));
    const plan = (await call('GET', `/api/schedule?date=${today}`)).body;
    assert.deepEqual(plan.map((d: any) => [d.employee_code, d.status, d.shift_code]), [['E000001', 'work', 'DAY']]);
    assert.ok((await call('GET', '/api/workforce/status')).body.qualifications.rows >= 1);
    assert.equal((await call('PUT', '/api/stations/WELD-01/requirements', [{ skillCode: 'WELD', minLevel: 2 }])).status, 200);
    const wo = (await call('GET', '/api/items')).body.find((i: any) => i.code === 'FG');
    const wh = (await call('POST', '/api/warehouses', { code: 'W2', nameEn: 'W2', nameAr: 'W2' })).body.id;
    const order = (await call('POST', '/api/work-orders', { commandId: 'hr-e2e-q-create', itemId: wo.id, plannedQty: '2', warehouseId: wh }, opKey)).body.id;
    const book = (n: number, code: string) => call('POST', `/api/work-orders/${order}/complete`, { commandId: `hr-e2e-q-${n}`, qty: '1', station: 'WELD-01', person: { id: hrId(company, 'employee', code), code } }, opKey);
    assert.equal((await book(1, 'E000001')).status, 200);
    assert.equal((await book(2, 'E000002')).body.error.code, 'person.not_qualified');
    assert.equal((await publish()).sent, 0, 'nothing changed, nothing sent');
  });

  test('manufacturing down while HR works: HR keeps its outbox, then delivers once, without duplicates', async () => {
    await app.close();
    hr(`import engine; engine.process_file('sample/HR_Attendance_Delta_Demo.xlsx')`); // HR keeps working: a correction + a new day
    const down = await publish();
    assert.match(down.stopped_by ?? '', /unreachable/);
    assert.ok(down.outbox.pending >= 1);
    await startMes(); // same database, same port
    const up = await publish();
    assert.equal(up.stopped_by, undefined);
    assert.equal(up.outbox.pending ?? 0, 0);
    assert.equal((await call('GET', '/api/employees')).body.length, 200, 'no employee duplicated');
    const again = await publish();
    assert.equal(again.sent, 0);
    const health = (await call('GET', '/api/system/health')).body;
    for (const [mod, checks] of Object.entries(health) as [string, { id: string; ok: boolean }[]][]) {
      for (const c of checks) assert.ok(c.ok || c.id === 'no_parked_events', `${mod}.${c.id}`);
    }
  });
});
