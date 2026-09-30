import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mizanId } from '@eco/contracts';
import { COMPANY, item, server, snapshot, warehouse } from './helpers.js';

/** Receiving from accounting and the incoming inspection decision (WP-G4). */
test('a goods receipt makes lots waiting for IQC; a rejection is published; a voided receipt voids its unused lots', async () => {
  const s = await server('mizan');
  await s.app.ctx.db.run("INSERT INTO qms_plan (id, code, name_en, name_ar, stage, item_id, aql, active) VALUES ('p1', 'IQC-CHIP', 'IQC chip', 'IQC', 'iqc', ?, '0.65', 1)", [mizanId(COMPANY, 'item', 3)]);
  const gr = (status: string, version: number) => ({
    id: mizanId(COMPANY, 'goods_receipt', 1), code: 'GRN-00001', version, origin: { app: 'mizan', type: 'goods_receipt', key: '1' },
    supplier: { id: mizanId(COMPANY, 'party', 9), code: 'SUP-1' }, receipt_date: '2026-09-28', warehouse: { id: mizanId(COMPANY, 'warehouse', 1), code: 'MAIN' }, status,
    lines: [{ line_no: 1, item: { id: mizanId(COMPANY, 'item', 3), code: 'CHIP' }, qty: '100', uom: 'PCS', lot_no: 'L-77' },
            { line_no: 2, item: { id: mizanId(COMPANY, 'item', 4), code: 'SCREW' }, qty: '5000', uom: 'PCS' }],
  });
  const send = async (...ev: unknown[]) => (await s.call('POST', '/eco/v1/inbox', { events: ev }, s.keys.link)).body.results as any[];
  assert.deepEqual((await send(snapshot('eco.warehouse.v1', warehouse(1, 'MAIN')), snapshot('eco.item.v1', item(3, 'CHIP')), snapshot('eco.item.v1', item(4, 'SCREW')), snapshot('acc.goods_receipt.v1', gr('posted', 1)))).map((r) => r.result), ['applied', 'applied', 'applied', 'applied']);

  const lots = (await s.call('GET', '/api/qms/incoming-lots')).body;
  assert.deepEqual(lots.map((l: any) => [l.item_code, l.lot_no, l.status]).sort(), [['CHIP', 'L-77', 'pending_iqc'], ['SCREW', 'GRN-00001-2', 'accepted']]);

  await s.app.ctx.db.run("INSERT OR IGNORE INTO qms_defect (code, name_en, name_ar, category, severity, active) VALUES ('SCRATCH', 'Scratch', 'خدش', 'cosmetic', 'minor', 1)");
  const noDefect = await s.call('POST', '/api/qms/incoming-lots/decision', { itemId: mizanId(COMPANY, 'item', 3), lotNo: 'L-77', decision: 'rejected' });
  assert.equal(noDefect.body.error.code, 'lot.defect_required');
  const ok = await s.call('POST', '/api/qms/incoming-lots/decision', { itemId: mizanId(COMPANY, 'item', 3), lotNo: 'L-77', decision: 'partially_accepted', acceptedQty: '80', rejectedQty: '20', defectCodes: ['SCRATCH'] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const feed = (await s.call('GET', '/eco/v1/feed?after=0&limit=500', undefined, s.keys.link)).body.events as any[];
  const d = feed.filter((e) => e.type === 'mes.lot_decision.v1');
  assert.equal(d.length, 1);
  assert.deepEqual([d[0].data.decision, d[0].data.accepted_qty, d[0].data.rejected_qty, d[0].data.goods_receipt.code], ['partially_accepted', '80', '20', 'GRN-00001']);

  assert.equal((await send(snapshot('acc.goods_receipt.v1', gr('voided', 2))))[0].result, 'applied');
  const after = (await s.call('GET', '/api/qms/incoming-lots')).body;
  assert.ok(after.every((l: any) => l.status === 'voided'));
  await s.close();
});
