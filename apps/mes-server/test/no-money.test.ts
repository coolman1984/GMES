import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CONTRACTS, sourceOf, uuidv7 } from '@eco/contracts';
import { z } from 'zod';
import { ACCEPTED_TYPES } from '../src/modules/eco/index.js';
import { buildApp } from '../src/app.js';

// "Store or compute a money value in manufacturing" is a rule of this repository (CLAUDE.md). The inbox is where money
// could walk in from another application, so: no type it accepts may carry a money field, and the one contract that
// does (payroll) is refused.
const MONEY = /^(amount|amount_minor|price|unit_price|cost|unit_cost|value_minor|salary|pay|net_pay|gross|currency)$/i;

function keysOf(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) node.forEach((n) => keysOf(n, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'properties' && v && typeof v === 'object') Object.keys(v).forEach((p) => out.add(p));
      keysOf(v, out);
    }
  }
  return out;
}

test('no event type the inbox accepts has a money field', () => {
  for (const type of ACCEPTED_TYPES) {
    const schema = z.toJSONSchema((CONTRACTS as Record<string, z.ZodType>)[type]!, { io: 'input', unrepresentable: 'any' });
    const bad = [...keysOf(schema)].filter((k) => MONEY.test(k));
    assert.deepEqual(bad, [], `${type} carries money fields: ${bad.join(', ')}`);
  }
});

test('the detector really sees money: the payroll contract has it and is not accepted', () => {
  const schema = z.toJSONSchema(CONTRACTS['hr.payroll_period.v1'], { io: 'input', unrepresentable: 'any' });
  assert.ok([...keysOf(schema)].some((k) => MONEY.test(k)), 'payroll must trip the detector, or the test above proves nothing');
  assert.ok(!(ACCEPTED_TYPES as readonly string[]).includes('hr.payroll_period.v1'));
});

test('a payroll event sent to manufacturing is refused with eco.not_accepted, even from the right company', async () => {
  const COMPANY = '0192f7c4-0000-7000-8000-00000000d3e2';
  const dir = mkdtempSync(join(tmpdir(), 'gmes-nomoney-'));
  const app = await buildApp({ dbFile: join(dir, 'gmes.db'), config: { companyId: COMPANY, node: 'test', timeZone: 'Africa/Cairo', productionDayStart: '07:00', ownership: { item: 'mizan', warehouse: 'mizan', person: 'hr' } } });
  try {
    const { addKey } = await import('../src/modules/system/index.js');
    const key = await addKey(app.ctx, 'hr-test', ['eco.inbox.write']);
    const id = uuidv7(Date.now(), new Uint8Array(10).fill(3));
    const payroll = {
      id, code: 'PAY-2026-09-1', version: 1, origin: { app: 'hr', type: 'payroll_period', key: '2026-09:1' },
      period: '2026-09', run: 1, currency: 'EGP', pay_date: '2026-09-28', status: 'approved',
      lines: [{ cost_center: 'CC-FA1', account_key: 'gross_earnings', amount_minor: 1_250_000 }],
      headcount: 10, hours: { regular: 1600, overtime_day: 0, overtime_night: 0 },
    };
    const envelope = {
      specversion: '1.0', id, source: sourceOf(COMPANY, 'hr', 'hr-main'), type: 'hr.payroll_period.v1', subject: `payroll_period/${id}`,
      time: '2026-09-29T10:00:00.000Z', datacontenttype: 'application/json', ecoseq: 1, ecocorrelation: `payroll_period/${id}`, data: payroll,
    };
    const r = await app.http.inject({ method: 'POST', url: '/eco/v1/inbox', headers: { 'x-eco-key': key }, payload: { events: [envelope] } });
    assert.equal(r.statusCode, 200, r.body);
    const res = JSON.parse(r.body).results[0];
    assert.equal(res.result, 'rejected');
    assert.equal(res.code, 'eco.not_accepted');
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
