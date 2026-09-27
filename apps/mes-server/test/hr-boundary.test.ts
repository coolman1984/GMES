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
});
