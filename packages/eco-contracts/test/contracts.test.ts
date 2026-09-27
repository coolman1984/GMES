import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import {
  EVENT_TYPES, formatQty, hrId, isUuid, zAttendanceDayV1, zEmployeeV1, mizanId, parseQty, QuantityError, sourceOf, uuidv5, uuidv7, validateEvent, zItemV1,
} from '../src/index.js';
import { renderSchemas } from '../src/schemas.js';

const COMPANY = '0192f7c4-8a3e-7b21-9c55-3d1f2a4b6c7d';

describe('quantities are exact decimal strings (ADR-018)', () => {
  test('round-trips at the x1000 scale', () => {
    for (const [text, n] of [['0', 0], ['1', 1000], ['12.5', 12500], ['0.001', 1], ['-3.25', -3250], ['2.500', 2500]] as const) {
      assert.equal(parseQty(text), n);
    }
    for (const [n, text] of [[0, '0'], [1000, '1'], [12500, '12.5'], [1, '0.001'], [-3250, '-3.25']] as const) {
      assert.equal(formatQty(n), text);
    }
  });

  test('refuses what it cannot carry exactly instead of rounding', () => {
    assert.throws(() => parseQty('0.0005'), (e: QuantityError) => e.code === 'qty.precision');
    assert.throws(() => parseQty('1e3'), (e: QuantityError) => e.code === 'qty.format');
    assert.throws(() => parseQty('01'), (e: QuantityError) => e.code === 'qty.format');
    assert.throws(() => parseQty(' 1'), (e: QuantityError) => e.code === 'qty.format');
    assert.throws(() => parseQty('99999999999999999'), (e: QuantityError) => e.code === 'qty.range');
    // a JSON number is not a quantity on the wire
    assert.throws(() => parseQty(12 as unknown as string), (e: QuantityError) => e.code === 'qty.format');
  });

  test('every formatted value parses back to itself (property over a range)', () => {
    for (let n = -5000; n <= 5000; n += 7) assert.equal(parseQty(formatQty(n)), n);
  });
});

describe('identities (ADR-017)', () => {
  test('UUIDv5 matches the RFC 9562 test vector', () => {
    // RFC 9562 appendix A.4: DNS namespace, "www.example.com"
    assert.equal(uuidv5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com'), '2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });

  test('Mizan ids are deterministic per company and differ between companies', () => {
    assert.equal(mizanId(COMPANY, 'item', 42), mizanId(COMPANY, 'item', 42));
    assert.notEqual(mizanId(COMPANY, 'item', 42), mizanId(COMPANY, 'warehouse', 42));
    assert.notEqual(mizanId(COMPANY, 'item', 42), mizanId('0192f7c4-8a3e-7b21-9c55-3d1f2a4b6c7e', 'item', 42));
    assert.ok(isUuid(mizanId(COMPANY, 'item', 42)));
  });

  test('UUIDv7 carries the time first, so ids sort by creation', () => {
    const r = new Uint8Array(10);
    const a = uuidv7(1_700_000_000_000, r);
    const b = uuidv7(1_700_000_000_001, r);
    assert.ok(isUuid(a) && a[14] === '7');
    assert.ok(a < b);
    assert.equal(a.slice(0, 13), '018bcfe5-6800');
  });
});

describe('envelope and event contracts', () => {
  const base = {
    specversion: '1.0', id: '0192f7c4-8a3e-7b21-9c55-000000000001', source: sourceOf(COMPANY, 'gmes', 'plant-1'),
    subject: 'work_order/0192f7c4-8a3e-7b21-9c55-000000000009', time: '2026-09-27T10:42:05.120Z',
    datacontenttype: 'application/json', ecoseq: 1, ecocorrelation: 'work_order/0192f7c4-8a3e-7b21-9c55-000000000009',
  };
  const wo = { id: '0192f7c4-8a3e-7b21-9c55-000000000009', code: 'WO-1', item: { id: mizanId(COMPANY, 'item', 2), code: 'FG' }, planned_qty: '10' };
  const op = { production_date: '2026-09-27', performed_by: { user: 'op1' }, ledger_seq: 1 };

  test('a valid consumption passes', () => {
    const r = validateEvent({ ...base, type: 'mes.material.consumed.v1', data: {
      work_order: wo, item: { id: mizanId(COMPANY, 'item', 1), code: 'RM' }, qty: '2.5', uom: 'KG',
      warehouse: { id: mizanId(COMPANY, 'warehouse', 1), code: 'MAIN' }, ...op,
    } });
    assert.deepEqual(r.ok, true);
  });

  test('numbers instead of decimal strings, unknown types and bad envelopes are refused with a reason', () => {
    const r1 = validateEvent({ ...base, type: 'mes.material.consumed.v1', data: {
      work_order: wo, item: { id: mizanId(COMPANY, 'item', 1), code: 'RM' }, qty: 2.5, uom: 'KG',
      warehouse: { id: mizanId(COMPANY, 'warehouse', 1), code: 'MAIN' }, ...op,
    } });
    assert.equal(r1.ok, false);
    assert.match((r1 as { message: string }).message, /data\.qty/);
    const r2 = validateEvent({ ...base, type: 'mes.unknown.thing.v1', data: {} });
    assert.equal(r2.ok, false);
    assert.equal((r2 as { code: string }).code, 'contract.unknown_type');
    const r3 = validateEvent({ ...base, source: 'http://x', type: 'mes.material.consumed.v1', data: {} });
    assert.equal((r3 as { code: string }).code, 'contract.invalid');
  });

  test('item snapshots require a monotonic integer version and bilingual names', () => {
    const item = { id: mizanId(COMPANY, 'item', 1), code: 'RM', name: { en: 'Steel', ar: 'صلب' }, active: true, version: 1,
      origin: { app: 'mizan', type: 'item', key: '1' }, kind: 'product', stock_tracked: true, tracking: 'none', base_uom: 'KG', units: [] };
    assert.ok(zItemV1.safeParse(item).success);
    assert.ok(!zItemV1.safeParse({ ...item, version: 0 }).success);
    assert.ok(!zItemV1.safeParse({ ...item, name: { en: 'Steel' } }).success);
  });
});

describe('workforce contracts owned by HR-System', () => {
  test('an employee id is the same in TypeScript and in the Python HR system (uuid.uuid5)', () => {
    // python3 -c "import uuid; print(uuid.uuid5(uuid.UUID(COMPANY), 'hr:employee:E000001'))"
    assert.equal(hrId(COMPANY, 'employee', 'E000001'), 'ad793f13-3ba3-5304-92f6-7bc2f8c8d5c8');
  });

  test('an employee snapshot carries no personal data and needs the owner version', () => {
    const e = { id: hrId(COMPANY, 'employee', 'E000001'), code: 'E000001', employment_status: 'Active', active: true, hire_date: '2015-05-08',
      version: 1, origin: { app: 'hr', type: 'employee', key: 'E000001' } };
    assert.ok(zEmployeeV1.safeParse(e).success);
    const parsed = zEmployeeV1.parse({ ...e, date_of_birth: '1990-01-01', national_id: 'x', base_pay: '9000' });
    assert.equal('date_of_birth' in parsed || 'national_id' in parsed || 'base_pay' in parsed, false, 'unknown (personal) fields are dropped, never carried');
    assert.ok(!zEmployeeV1.safeParse({ ...e, active: 'yes' }).success);
  });

  test('an attendance day references its employee by the shared id', () => {
    const a = { id: hrId(COMPANY, 'attendance', 'TIM02-00001'), code: 'TIM02-00001', employee: { id: hrId(COMPANY, 'employee', 'E000001'), code: 'E000001' },
      work_date: '2026-06-17', status: 'Leave', scheduled_shift_code: 'S4', leave: { type: 'Annual' }, worked_minutes: 376, version: 1,
      origin: { app: 'hr', type: 'attendance', key: 'TIM02-00001' } };
    assert.ok(zAttendanceDayV1.safeParse(a).success);
    assert.ok(!zAttendanceDayV1.safeParse({ ...a, worked_minutes: 3.5 }).success);
  });
});

describe('generated JSON Schemas', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'schemas');
  test('exist for every contract and are up to date (run `npm run schemas`)', () => {
    const rendered = renderSchemas();
    assert.ok(EVENT_TYPES.length >= 4);
    for (const [name, text] of Object.entries(rendered)) {
      const file = join(dir, `${name}.schema.json`);
      assert.ok(existsSync(file), `missing ${file}`);
      assert.equal(readFileSync(file, 'utf8'), text, `${name}.schema.json is stale`);
    }
  });
});
