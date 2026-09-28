import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { samplingPlan } from '../src/modules/qms/aql.js';
import { signIn } from './helpers.js';
import { tvPlant } from './plants.js';

let n = 0;
const cmd = () => `qms-cmd-${++n}-${Date.now()}`;

describe('acceptance sampling (ISO 2859-1, single, normal)', () => {
  test('the published plans for a lot of 1 000 (letter J, 80 pieces) and of 500 (H, 50)', () => {
    const j = (aql: string) => { const p = samplingPlan(1000, 'II', aql); return [p.letter, p.sample, p.accept, p.reject]; };
    assert.deepEqual(j('0.65'), ['J', 80, 1, 2]);
    assert.deepEqual(j('1.0'), ['J', 80, 2, 3]);
    assert.deepEqual(j('1.5'), ['J', 80, 3, 4]);
    assert.deepEqual(j('2.5'), ['J', 80, 5, 6]);
    assert.deepEqual(j('4.0'), ['J', 80, 7, 8]);
    assert.deepEqual(j('6.5'), ['J', 80, 10, 11]);
    const h = samplingPlan(500, 'II', '2.5');
    assert.deepEqual([h.letter, h.sample, h.accept], ['H', 50, 3]);
  });
  test('the arrows: a plan that does not exist sends to the one above or below', () => {
    const up = samplingPlan(100, 'II', '1.0');    // F (20) at 1.0 is "↑": use E (13), accept 0
    assert.deepEqual([up.letter, up.sample, up.accept], ['E', 13, 0]);
    const down = samplingPlan(1000, 'II', '0.40'); // J (80) at 0.40 is "↓": use K (125), accept 1
    assert.deepEqual([down.letter, down.sample, down.accept], ['K', 125, 1]);
    const small = samplingPlan(10, 'II', '0.65');  // B (3) at 0.65 is "↓" down to F (20) > lot: inspect everything
    assert.equal(small.all, true);
    assert.equal(small.sample, 10);
  });
});

describe('quality: codes, inspections, holds, repair, yield (QMS1010-4010)', () => {
  let s: Awaited<ReturnType<typeof tvPlant>>;
  let tvWo: string;
  const scan = (station: string, serial: string, extra: Record<string, unknown> = {}) => s.call('POST', '/api/units/scan', { commandId: cmd(), station, serial, ...extra });
  /** Makes finished main boards and runs TVs up to the given operation. */
  async function build(tvs: string[], upTo: 'MB' | 'FT' | 'PK') {
    for (const tv of tvs) {
      const pba = 'PBA-' + tv;
      assert.equal((await scan('SMD-01-LD', pba)).status, 200);
      assert.equal((await scan('SMD-01-AOI', pba)).status, 200);
      assert.equal((await scan('MA-01-PL', tv, { parts: [{ serial: 'PNL-' + tv, itemId: s.ids.panel }] })).status, 200);
      assert.equal((await scan('MA-01-MB', tv, { parts: [{ serial: pba }] })).status, 200);
      if (upTo === 'MB') continue;
      assert.equal((await scan('MA-01-FT', tv)).status, 200);
      if (upTo === 'FT') continue;
      assert.equal((await scan('MA-01-PK', tv)).status, 200);
    }
  }
  before(async () => {
    s = await tvPlant();
    await s.ok('POST', '/api/work-orders', { commandId: cmd(), itemId: s.ids.pba, warehouseId: s.wh, plannedQty: '20', line: 'SMD-01' });
    tvWo = (await s.ok('POST', '/api/work-orders', { commandId: cmd(), itemId: s.ids.tv, warehouseId: s.wh, plannedQty: '20', line: 'MA-01' })).id;
    await s.ok('POST', '/api/stations/MA-01-PK/loads', { commandId: cmd(), itemId: s.ids.carton, lotNo: 'CTN-A', warehouseId: s.wh });
  });
  after(() => s.close());

  test('with no list any defect code is taken; once the plant writes its list, only its active codes', async () => {
    await build(['TV001'], 'MB');
    assert.equal((await scan('MA-01-FT', 'TV001', { result: 'fail', defectCode: 'ANYTHING' })).status, 200);
    await s.ok('PUT', '/api/defect-codes/NO-PIC', { nameEn: 'No picture', nameAr: 'لا توجد صورة', category: 'function', severity: 'major' });
    await s.ok('PUT', '/api/defect-codes/SCRATCH', { nameEn: 'Scratch on bezel', category: 'cosmetic', severity: 'minor' });
    await s.ok('PUT', '/api/repair-codes/cause/CABLE', { nameEn: 'Loose cable' });
    await s.ok('PUT', '/api/repair-codes/action/RESEAT', { nameEn: 'Reseated' });
    await s.ok('PUT', '/api/repair-codes/action/REPLACE', { nameEn: 'Part replaced' });
    assert.equal((await s.call('POST', '/api/units/TV001/repair', { commandId: cmd(), cause: 'GREMLINS', action: 'RESEAT' })).body.error.code, 'repair.unknown_cause');
    assert.equal((await s.call('POST', '/api/units/TV001/repair', { commandId: cmd(), cause: 'CABLE', action: 'RESEAT' })).status, 200);
    await build(['TV002'], 'MB');
    assert.equal((await scan('MA-01-FT', 'TV002', { result: 'fail', defectCode: 'BAD-CODE' })).body.error.code, 'defect.unknown');
  });

  test('a key part replaced at repair: the new one is in the genealogy, the old one only in the history', async () => {
    assert.equal((await scan('MA-01-FT', 'TV002', { result: 'fail', defectCode: 'NO-PIC' })).status, 200);
    assert.equal((await scan('SMD-01-LD', 'PBA-SPARE')).status, 200);
    assert.equal((await s.call('POST', '/api/units/TV002/repair', { commandId: cmd(), cause: 'CABLE', action: 'REPLACE', replace: { oldSerial: 'PBA-TV002', newSerial: 'PBA-SPARE' } })).body.error.code,
      'part.not_available', 'a spare still in production cannot be fitted');
    assert.equal((await scan('SMD-01-AOI', 'PBA-SPARE')).status, 200);
    const r = await s.call('POST', '/api/units/TV002/repair', { commandId: cmd(), cause: 'CABLE', action: 'REPLACE', replace: { oldSerial: 'PBA-TV002', newSerial: 'PBA-SPARE' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const back = await s.ok('GET', '/api/trace/backward/TV002');
    assert.deepEqual(back.parts.filter((p: any) => p.kind === 'unit').map((p: any) => p.serial), ['PBA-SPARE']);
    assert.equal((await s.ok('GET', '/api/trace/forward?serial=PBA-TV002')).count, 0, 'the removed board is no longer inside a TV');
    const hist = await s.ok('GET', '/api/units/TV002');
    assert.ok(hist.events.some((e: any) => e.kind === 'REPAIR' && e.detail.replaced.old === 'PBA-TV002'));
    assert.equal((await scan('MA-01-FT', 'TV002')).status, 200);
  });

  test('an inspection against its plan: a measurement outside its limits fails it; the record cannot be changed', async () => {
    const plan = await s.ok('POST', '/api/qms/plans', { code: 'FQC-TV55', nameEn: 'Final check TV 55', stage: 'fqc', itemId: s.ids.tv, opCode: 'FT', characteristics: [
      { seq: 1, code: 'LUM', nameEn: 'Luminance', kind: 'measure', unit: 'cd/m2', nominal: '350', lsl: '320', usl: '400' },
      { seq: 2, code: 'LOGO', nameEn: 'Logo aligned', kind: 'check' }] });
    const bad = await s.ok('POST', '/api/qms/inspections', { commandId: cmd(), planId: plan.id, targetType: 'unit', target: 'TV002', measurements: [{ code: 'LUM', value: '312.5' }, { code: 'LOGO', value: 'ok' }] });
    assert.equal(bad.result, 'fail');
    assert.deepEqual(bad.measures.map((m: any) => [m.code, m.value, m.ok]), [['LUM', '312.5', false], ['LOGO', 'OK', true]]);
    const good = await s.ok('POST', '/api/qms/inspections', { commandId: cmd(), planId: plan.id, targetType: 'unit', target: 'TV002', measurements: [{ code: 'LUM', value: '355' }, { code: 'LOGO', value: '1' }] });
    assert.equal(good.result, 'pass');
    assert.equal((await s.call('POST', '/api/qms/inspections', { commandId: cmd(), planId: plan.id, targetType: 'unit', target: 'TV002', measurements: [{ code: 'LUM', value: '355' }] })).body.error.code, 'inspection.missing');
    await assert.rejects(() => s.app.ctx.db.run(`UPDATE qms_inspection SET result = 'pass'`), /append-only/);
    assert.equal((await s.ok('GET', '/api/qms/verify')).ok, true);
  });

  test('a failed outgoing inspection holds the whole lot; the hold is released only by a person\'s signature', async () => {
    await build(['TV003', 'TV004', 'TV005'], 'PK');
    const oqc = await s.ok('POST', '/api/qms/plans', { code: 'OQC-TV', nameEn: 'Outgoing TV', stage: 'oqc', aql: '0.65' });
    const r = await s.ok('POST', '/api/qms/inspections', { commandId: cmd(), planId: oqc.id, targetType: 'work_order', target: (await s.app.ctx.services.get('exe').workOrder(tvWo)).code,
      findings: [{ defectCode: 'SCRATCH', qty: 1, serial: 'TV003' }] });
    assert.equal(r.result, 'fail', JSON.stringify(r));
    assert.equal(r.accept, 0, 'a lot this small accepts no defect at AQL 0.65');
    assert.ok(r.hold && r.hold.units >= 3, JSON.stringify(r.hold));
    const t04 = (await s.app.ctx.services.get('trk').unit('TV004'))!;
    assert.ok(t04.held > 0);
    // a machine key cannot sign; a person must, with their own password
    const byKey = await s.call('POST', `/api/qms/holds/${r.hold.id}/release`, { commandId: cmd(), disposition: 'release', decision: 'sorted 100%', password: 'x' });
    assert.equal(byKey.body.error.code, 'sign.person_required');
    await s.ok('POST', '/api/users', { login: 'qa.nour', name: 'Nour', role: 'QUALITY', password: 'Quality-pass-1' });
    const qa = await signIn(s, 'qa.nour', 'Quality-pass-1');
    assert.equal((await qa('POST', `/api/qms/holds/${r.hold.id}/release`, { commandId: cmd(), disposition: 'release', decision: 'sorted', password: 'wrong' })).body.error.code, 'sign.wrong_password');
    assert.equal((await qa('POST', `/api/qms/holds/${r.hold.id}/release`, { commandId: cmd(), disposition: 'scrap', decision: 'scrap all', password: 'Quality-pass-1' })).body.error.code, 'hold.finished_units');
    const ok = await qa('POST', `/api/qms/holds/${r.hold.id}/release`, { commandId: cmd(), disposition: 'release', decision: 'sorted 100%, TV003 bezel changed', password: 'Quality-pass-1' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const h = await s.ok('GET', `/api/qms/holds/${r.hold.id}`);
    assert.equal(h.status, 'released');
    assert.match(h.signed_by, /qa\.nour/);
    assert.equal((await s.app.ctx.services.get('trk').unit('TV004'))!.held, 0);
  });

  test('a hold on a material lot stops every product containing it; rework sends units in production to repair', async () => {
    await build(['TV006'], 'MB');
    const hold = await s.ok('POST', '/api/qms/holds', { commandId: cmd(), targetType: 'material_lot', target: 'PNL-TV006', reason: 'panel supplier alert' });
    assert.equal(hold.units, 1);
    assert.equal((await scan('MA-01-FT', 'TV006')).body.error.code, 'unit.held');
    assert.equal((await s.call('POST', '/api/qms/holds', { commandId: cmd(), targetType: 'material_lot', target: 'NOTHING-HERE', reason: 'test' })).body.error.code, 'hold.nothing');
    await s.ok('POST', '/api/users', { login: 'qa.reem', name: 'Reem', role: 'QUALITY', password: 'Quality-pass-2' });
    const qa = await signIn(s, 'qa.reem', 'Quality-pass-2');
    const rel = await qa('POST', `/api/qms/holds/${hold.id}/release`, { commandId: cmd(), disposition: 'rework', decision: 'change the panel', defectCode: 'NO-PIC', password: 'Quality-pass-2' });
    assert.equal(rel.status, 200, JSON.stringify(rel.body));
    assert.equal((await s.app.ctx.services.get('trk').unit('TV006'))!.status, 'repair');
    const health = await s.ok('GET', '/api/system/health');
    assert.ok(health.qms.every((c: any) => c.ok), JSON.stringify(health.qms));
  });

  test('first-pass yield per operation and the defect Pareto come from the unit history', async () => {
    const day = (await s.ok('GET', '/api/units/TV001')).events[0].production_date;
    const y = await s.ok('GET', `/api/qms/yield?from=${day}&to=${day}&line=MA-01`);
    const ft = y[0].ops.find((o: any) => o.op === 'FT');
    assert.ok(ft.units >= 5 && ft.fails >= 3, JSON.stringify(ft));
    assert.ok(ft.fpy < 100);
    const p = await s.ok('GET', `/api/qms/pareto?from=${day}&to=${day}&by=defect`);
    assert.equal(p.rows[0].key, 'NO-PIC');
    assert.equal(p.rows[p.rows.length - 1].cum, 100);
    const q = await s.ok('GET', '/api/qms/repair-queue');
    assert.ok(q.some((u: any) => u.serial === 'TV006'));
  });
});
