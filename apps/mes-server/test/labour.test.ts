import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hrId, validateEvent } from '@eco/contracts';
import { splitMinutes } from '../src/modules/lab/index.js';
import { COMPANY, HR_SOURCE, employee, snapshot, stocked } from './helpers.js';

/** Labour facts to HR (WP-G6): the day's minutes split by bookings, exactly, and published as a snapshot. */
test('minutes are split in proportion to the bookings, always adding up to the minute', () => {
  const w = (o: Record<string, number>) => new Map(Object.entries(o));
  assert.deepEqual([...splitMinutes(w({ 'FA-1|PL': 1, 'FA-1|MB': 1, 'FA-2|PL': 1 }), 480)], [['FA-1|MB', 160], ['FA-1|PL', 160], ['FA-2|PL', 160]]);
  const odd = splitMinutes(w({ a: 1, b: 1, c: 1 }), 100);
  assert.equal([...odd.values()].reduce((x, y) => x + y, 0), 100, '100 / 3 keeps every minute: 34 + 33 + 33');
  assert.deepEqual([...splitMinutes(w({ a: 3, b: 1 }), 100)], [['a', 75], ['b', 25]]);
  assert.equal(splitMinutes(w({ a: 1 }), 0).size, 0);
  assert.equal(splitMinutes(w({}), 480).size, 0);
});

test('a closed day publishes each person\'s minutes per line; a recompute with a changed figure is a newer version', async () => {
  const s = await stocked('hr');
  const E1 = 'E000001';
  const day = '2026-09-27';                         // the test clock's production day
  const att = (minutes: number, version: number) => snapshot('eco.attendance_day.v1', {
    id: hrId(COMPANY, 'attendance', 'A1'), code: 'A1', employee: { id: hrId(COMPANY, 'employee', E1), code: E1 }, work_date: day, status: 'Present',
    scheduled_shift_code: 'A', worked_minutes: minutes, version, origin: { app: 'hr', type: 'attendance', key: 'A1' } }, undefined, HR_SOURCE);
  await s.call('POST', '/eco/v1/inbox', { events: [snapshot('eco.employee.v1', employee(E1), undefined, HR_SOURCE), att(480, 1)] }, s.keys.link);
  // two lines, three bookings by the same person that day: 2 on FA-1, 1 on FA-2
  for (const n of ['FA-1', 'FA-2']) {
    const p = (await s.call('POST', '/api/plant', { code: 'P' + n, type: 'plant', nameEn: n })).body;
    const a = (await s.call('POST', '/api/plant', { code: 'A' + n, type: 'area', parentId: p.id, nameEn: n })).body;
    await s.call('POST', '/api/plant', { code: n, type: 'line', parentId: a.id, nameEn: n, capacityPerShift: 100 });
  }
  const person = { id: hrId(COMPANY, 'employee', E1), code: E1 };
  const book = async (line: string, n: number) => {
    const wo = (await s.call('POST', '/api/work-orders', { commandId: `lab-wo-${line}`, itemId: s.chair, plannedQty: '20', warehouseId: s.main, line, productionDate: day })).body.id;
    for (let i = 0; i < n; i++) assert.equal((await s.call('POST', `/api/work-orders/${wo}/complete`, { commandId: `lab-c-${line}-${i}`, qty: '1', person, productionDate: day })).status, 200);
  };
  await book('FA-1', 2);
  await book('FA-2', 1);
  const closed = await s.call('POST', '/api/labor/close-day', { date: day });
  assert.deepEqual([closed.body.people, closed.body.published], [1, 1], JSON.stringify(closed.body));
  const labour = (await s.call('GET', `/api/labor?date=${day}`)).body;
  assert.deepEqual(labour[0].entries.map((e: any) => [e.line, e.minutes]), [['FA-1', 320], ['FA-2', 160]]);
  assert.equal(labour[0].total_minutes, 480);
  const feed = (await s.call('GET', '/eco/v1/feed?after=0&limit=500', undefined, s.keys.link)).body.events as any[];
  const ev = feed.filter((e) => e.type === 'mes.labor_day.v1');
  assert.equal(ev.length, 1);
  assert.ok(validateEvent(ev[0]).ok, JSON.stringify(validateEvent(ev[0])));

  // closing again changes nothing; a longer attendance is version 2
  assert.equal((await s.call('POST', '/api/labor/close-day', { date: day })).body.published, 0);
  await s.call('POST', '/eco/v1/inbox', { events: [att(540, 2)] }, s.keys.link);
  assert.equal((await s.call('POST', '/api/labor/close-day', { date: day })).body.published, 1);
  const ev2 = ((await s.call('GET', '/eco/v1/feed?after=0&limit=500', undefined, s.keys.link)).body.events as any[]).filter((e) => e.type === 'mes.labor_day.v1');
  assert.deepEqual([ev2.length, ev2[1].data.version, ev2[1].data.total_minutes], [2, 2, 540]);
  assert.equal((await s.call('POST', '/api/labor/close-day', { date: '2099-01-01' })).body.error.code, 'labor.future');
  await s.close();
});
