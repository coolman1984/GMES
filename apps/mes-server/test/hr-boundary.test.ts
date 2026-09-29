import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { hrId } from '@eco/contracts';
import { COMPANY, HR_SOURCE, employee, server, snapshot, stocked } from './helpers.js';

/**
 * The HR boundary (docs/ecosystem/02: people are owned by HR-System). Manufacturing keeps a
 * READ-ONLY mirror and checks the operator a command names; with ownership.person = 'none' it
 * behaves exactly as before the boundary existed (the rollback switch).
 */
describe('people are owned by HR: manufacturing mirrors and checks, never edits', () => {
  test('HR snapshots are mirrored once; newer versions win; other owners are refused', async () => {
    const s = await server('mizan', 'hr');
    const first = snapshot('eco.employee.v1', employee('E000001'), undefined, HR_SOURCE);
    const r = await s.call('POST', '/eco/v1/inbox', { events: [first, first] }, s.keys.link);
    assert.deepEqual(r.body.results.map((x: any) => x.result), ['applied', 'duplicate']);
    const newer = snapshot('eco.employee.v1', employee('E000001', { version: 2, employment_status: 'Suspended', active: false }), undefined, HR_SOURCE);
    const older = snapshot('eco.employee.v1', employee('E000001', { version: 1, display_name: 'OLD' }), undefined, HR_SOURCE);
    const r2 = await s.call('POST', '/eco/v1/inbox', { events: [newer, older] }, s.keys.link);
    assert.deepEqual(r2.body.results.map((x: any) => x.result), ['applied', 'stale']);
    const list = (await s.call('GET', '/api/employees')).body;
    assert.equal(list.length, 1);
    assert.equal(list[0].employment_status, 'Suspended');
    // an employee claimed by any other app is refused: one owner, one truth
    const forged = snapshot('eco.employee.v1', { ...employee('E000009'), origin: { app: 'mizan', type: 'employee', key: '9' } }, undefined, HR_SOURCE);
    assert.equal((await s.call('POST', '/eco/v1/inbox', { events: [forged] }, s.keys.link)).body.results[0].code, 'mdm.wrong_owner');
    await s.close();
  });

  test('a command must name a known, active employee; HR code wins over what the client sent', async () => {
    const s = await stocked('hr');
    await s.call('POST', '/eco/v1/inbox', { events: [
      snapshot('eco.employee.v1', employee('E000001'), undefined, HR_SOURCE),
      snapshot('eco.employee.v1', employee('E000002', { employment_status: 'Terminated', active: false }), undefined, HR_SOURCE),
    ] }, s.keys.link);
    const wo = (await s.call('POST', '/api/work-orders', { commandId: 'hr-create-1', itemId: s.chair, plannedQty: '5', warehouseId: s.main })).body.id;
    const book = (commandId: string, person: unknown) =>
      s.call('POST', `/api/work-orders/${wo}/complete`, { commandId, qty: '1', person }, s.keys.operator);
    const unknown = await book('hr-done-1', { id: hrId(COMPANY, 'employee', 'E999999'), code: 'E999999' });
    assert.equal(unknown.body.error.code, 'person.unknown');
    const inactive = await book('hr-done-2', { id: hrId(COMPANY, 'employee', 'E000002'), code: 'E000002' });
    assert.equal(inactive.body.error.code, 'person.inactive');
    const ok = await book('hr-done-3', { id: hrId(COMPANY, 'employee', 'E000001'), code: 'typo' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const feed = (await s.call('GET', '/eco/v1/feed', undefined, s.keys.link)).body;
    assert.deepEqual(feed.events.at(-1).data.performed_by.person, { id: hrId(COMPANY, 'employee', 'E000001'), code: 'E000001' });
    const lines = (await s.call('GET', `/api/work-orders/${wo}`)).body.ledger;
    assert.equal(lines.filter((l: any) => l.txn_type === 'COMPLETE').length, 1, 'refused commands leave no trace in the ledger');
    await s.close();
  });

  test('attendance days are mirrored for the shift view, keyed by the shared employee id', async () => {
    const s = await server('mizan', 'hr');
    const day = { id: hrId(COMPANY, 'attendance', 'TIM02-00001'), code: 'TIM02-00001', employee: { id: hrId(COMPANY, 'employee', 'E000001'), code: 'E000001' },
      work_date: '2026-06-17', status: 'Present', scheduled_shift_code: 'S4', version: 1, origin: { app: 'hr', type: 'attendance', key: 'TIM02-00001' } };
    const r = await s.call('POST', '/eco/v1/inbox', { events: [snapshot('eco.attendance_day.v1', day, undefined, HR_SOURCE)] }, s.keys.link);
    assert.equal(r.body.results[0].result, 'applied');
    await s.close();
  });

  test("rollback switch: with ownership.person = 'none' HR snapshots are refused and person references pass unchecked (old behaviour)", async () => {
    const s = await stocked('none');
    const r = await s.call('POST', '/eco/v1/inbox', { events: [snapshot('eco.employee.v1', employee('E000001'), undefined, HR_SOURCE)] }, s.keys.link);
    assert.equal(r.body.results[0].code, 'mdm.not_mirror');
    const wo = (await s.call('POST', '/api/work-orders', { commandId: 'none-create-1', itemId: s.chair, plannedQty: '1', warehouseId: s.main })).body.id;
    const ok = await s.call('POST', `/api/work-orders/${wo}/complete`, { commandId: 'none-done-1', qty: '1', person: { id: hrId(COMPANY, 'employee', 'E777'), code: 'E777' } });
    assert.equal(ok.status, 200);
    await s.close();
  });

  test('a station that needs a skill takes only people HR qualified, at the level, on that day (phase 5 gate)', async () => {
    const s = await stocked('hr');
    const ref = (code: string) => ({ id: hrId(COMPANY, 'employee', code), code });
    const qual = (emp: string, extra: Record<string, unknown> = {}) => ({ id: hrId(COMPANY, 'qualification', `${emp}-WELD`), employee: ref(emp), skill_code: 'WELD',
      level: 3, certified_on: '2026-01-01', expires_on: '2026-12-31', active: true, version: 1, origin: { app: 'hr', type: 'qualification', key: `${emp}-WELD` }, ...extra });
    const r = await s.call('POST', '/eco/v1/inbox', { events: [
      ...['E1', 'E2', 'E3', 'E4', 'E5'].map((c) => snapshot('eco.employee.v1', employee(c), undefined, HR_SOURCE)),
      snapshot('eco.qualification.v1', qual('E1'), undefined, HR_SOURCE),
      snapshot('eco.qualification.v1', qual('E2', { level: 1 }), undefined, HR_SOURCE),
      snapshot('eco.qualification.v1', qual('E3', { expires_on: '2026-06-30' }), undefined, HR_SOURCE),
      snapshot('eco.qualification.v1', qual('E4', { active: false }), undefined, HR_SOURCE),
    ] }, s.keys.link);
    assert.ok(r.body.results.every((x: any) => x.result === 'applied'), JSON.stringify(r.body));
    const set = await s.call('PUT', '/api/stations/ASM-02-ST20/requirements', [{ skillCode: 'WELD', minLevel: 2 }]);
    assert.equal(set.status, 200, JSON.stringify(set.body));
    const wo = (await s.call('POST', '/api/work-orders', { commandId: 'q-create', itemId: s.chair, plannedQty: '9', warehouseId: s.main })).body.id;
    const book = (n: number, emp: string, station?: string) => s.call('POST', `/api/work-orders/${wo}/complete`,
      { commandId: `q-done-${n}`, qty: '1', person: ref(emp), station, productionDate: '2026-09-28' }, s.keys.operator);
    assert.equal((await book(1, 'E1', 'ASM-02-ST20')).status, 200);
    const why = async (n: number, emp: string) => (await book(n, emp, 'ASM-02-ST20')).body.error;
    assert.match((await why(2, 'E2')).message, /level 1, the station needs 2/);
    assert.match((await why(3, 'E3')).message, /qualified until 2026-06-30/);
    assert.match((await why(4, 'E4')).message, /no qualification/);
    assert.equal((await why(5, 'E5')).code, 'person.not_qualified');
    assert.equal((await book(6, 'E5', 'PACK-01')).status, 200, 'a station without requirements takes anybody HR says may work');
    assert.equal((await book(7, 'E5')).status, 200, 'without a station, nothing more is asked than before');
    const lines = (await s.call('GET', `/api/work-orders/${wo}`)).body.ledger;
    const done = lines.filter((l: any) => l.txn_type === 'COMPLETE');
    assert.equal(done.length, 3, 'refused bookings leave no trace');
    assert.deepEqual(done.map((l: any) => l.station_code), ['ASM-02-ST20', 'PACK-01', null], 'the ledger keeps where the work was booked');
    const feed = (await s.call('GET', '/eco/v1/feed', undefined, s.keys.link)).body.events.filter((e: any) => e.type === 'mes.production.completed.v1');
    assert.deepEqual(feed.map((e: any) => e.data.station ?? null), ['ASM-02-ST20', 'PACK-01', null], 'so does the published fact');
    assert.equal((await s.call('GET', '/api/ledger/verify')).body.ok, true);
    assert.equal((await s.call('PUT', '/api/stations/X/requirements', [{ skillCode: 'WELD', minLevel: 2 }], s.keys.operator)).status, 403, 'operators do not configure stations');
    await s.close();
  });

  test('the plan from HR is mirrored with its age: last-known-good when HR is away, never a stop', async () => {
    const s = await server('mizan', 'hr');
    const day = { id: hrId(COMPANY, 'schedule', 'E1:2026-10-01'), employee: { id: hrId(COMPANY, 'employee', 'E1'), code: 'E1' }, work_date: '2026-10-01',
      status: 'work', shift_code: 'NIGHT', start: '2026-10-01T23:00', end: '2026-10-02T07:00', paid_minutes: 450, source: 'regular', version: 1,
      origin: { app: 'hr', type: 'schedule', key: 'E1:2026-10-01' } };
    const r = await s.call('POST', '/eco/v1/inbox', { events: [snapshot('eco.employee.v1', employee('E1'), undefined, HR_SOURCE), snapshot('eco.schedule_day.v1', day, undefined, HR_SOURCE)] }, s.keys.link);
    assert.ok(r.body.results.every((x: any) => x.result === 'applied'), JSON.stringify(r.body));
    const plan = (await s.call('GET', '/api/schedule?date=2026-10-01')).body;
    assert.deepEqual([plan[0].employee_code, plan[0].shift_code, plan[0].end_at], ['E1', 'NIGHT', '2026-10-02T07:00']);
    s.clock.set('2026-09-27T10:00:00.000Z');
    const st = (await s.call('GET', '/api/workforce/status')).body;
    assert.equal(st.schedule.rows, 1);
    assert.equal(st.schedule.ageMinutes, 120, 'the age of what HR last sent is visible');
    await s.close();
  });
});
