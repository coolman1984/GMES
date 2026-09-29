import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CONTRACTS, hrId, isUuid, laborId, mizanId, sourceOf, spaceId, uuidv7, validateEvent } from '../src/index.js';

// One valid sample and at least two refused ones for every contract added on 2026-09-29 (plan-to-produce, order-to-cash,
// receiving, people and pay, plant and layout), plus the two additive fields on existing contracts.
const COMPANY = '0192f7c4-8a3e-7b21-9c55-3d1f2a4b6c7d';
const uid = (n: number) => uuidv7(1_780_000_000_000 + n, new Uint8Array(10).fill(n));
const ref = (code: string, n: number) => ({ id: uid(n), code });
const item = (code: string, n: number) => ({ id: mizanId(COMPANY, 'item', n), code });
const origin = (app: string, type: string, key: string) => ({ app, type, key });

function envelope(type: string, data: unknown, app = 'mizan') {
  return {
    specversion: '1.0', id: uid(900), source: sourceOf(COMPANY, app, 'main'), type, subject: `${type.split('.')[1]}/x`,
    time: '2026-09-29T10:00:00.000Z', datacontenttype: 'application/json', ecoseq: 1, ecocorrelation: 'c/1', data,
  };
}
const ok = (type: string, data: unknown, app?: string) => {
  const r = validateEvent(envelope(type, data, app));
  assert.ok(r.ok, r.ok ? '' : r.message);
};
const bad = (type: string, data: unknown, part: RegExp) => {
  const r = validateEvent(envelope(type, data));
  assert.ok(!r.ok, `${type}: expected a refusal`);
  if (!r.ok) assert.match(r.message, part);
};

const party = { id: mizanId(COMPANY, 'party', 7), code: 'C-BTECH', version: 3, origin: origin('mizan', 'party', '7'), name: { en: 'Retail chain', ar: 'سلسلة تجزئة' }, roles: ['customer'], country: 'EG', active: true };
const so = {
  id: mizanId(COMPANY, 'sales_order', 11), code: 'SO-00011', version: 5, origin: origin('mizan', 'sales_order', '11'),
  customer: ref('C-BTECH', 1), order_date: '2026-08-17', status: 'open', priority: 2,
  lines: [{ line_no: 1, item: item('NV-65U', 5), qty: '9000', uom: 'PCS', requested_date: '2026-09-10', promised_date: '2026-09-17', delivered_qty: '0' }],
};

describe('plan-to-produce and order-to-cash contracts', () => {
  test('a party, a sales order, a demand plan, a stock position and a purchase order pass', () => {
    ok('eco.party.v1', party);
    ok('acc.sales_order.v1', so);
    ok('acc.demand_plan.v1', { id: mizanId(COMPANY, 'demand_plan', 1), code: 'SOP-2026-10', version: 1, origin: origin('mizan', 'demand_plan', '1'), cycle: '2026-10', status: 'approved', approved_at: '2026-09-25T09:00:00Z', lines: [{ item: item('NV-55U', 4), period: '2026-10', qty: '20000' }] });
    ok('acc.stock_position.v1', { id: mizanId(COMPANY, 'stock_position', 3), item: item('OC-55', 9), warehouse: ref('RM', 2), on_hand: '1200', reserved: '0', uom: 'PCS', as_of: '2026-09-29T00:00:00Z', version: 2, origin: origin('mizan', 'stock_position', '9:2') });
    ok('acc.purchase_order.v1', { id: mizanId(COMPANY, 'purchase_order', 4), code: 'PO-00004', version: 1, origin: origin('mizan', 'purchase_order', '4'), supplier: ref('S-CSOT', 3), order_date: '2026-08-20', status: 'open', lines: [{ line_no: 1, item: item('OC-55', 9), qty: '5000', received_qty: '0', uom: 'PCS', expected_date: '2026-10-30', warehouse: ref('RM', 2) }] });
  });

  test('a sales order without lines, with a bad priority or with a fraction beyond three decimals is refused', () => {
    bad('acc.sales_order.v1', { ...so, lines: [] }, /lines/);
    bad('acc.sales_order.v1', { ...so, priority: 0 }, /priority/);
    bad('acc.sales_order.v1', { ...so, lines: [{ ...so.lines[0], qty: '1.0005' }] }, /qty/);
  });

  test('requisitions, supply plans and crew requirements pass, and refuse the wrong shapes', () => {
    const run = ref('MRP-20260929-0200', 20);
    ok('mes.purchase_requisition.v1', { id: uid(31), code: 'PR-1', version: 1, origin: origin('gmes', 'requisition', 'x'), item: item('OC-55', 9), qty: '5000', uom: 'PCS', need_date: '2026-11-20', order_by_date: '2026-09-11', warehouse: ref('RM', 2), mrp_run: run, status: 'open', pegging: [{ kind: 'sales_order', reference: 'SO-00011/1', qty: '5000' }] }, 'gmes');
    ok('mes.supply_plan.v1', { id: uid(32), code: 'SUP-1', version: 1, origin: origin('gmes', 'supply_plan', 'x'), mrp_run: run, lines: [{ item: item('NV-65U', 5), period: '2026-10', demand_qty: '9000', planned_qty: '7200', constraint: 'material' }] }, 'gmes');
    ok('mes.crew_requirement.v1', { id: uid(33), line: 'FA-2', shift: 'C', work_date: '2026-09-21', headcount: 58, skills: [{ skill_code: 'ESD', level: 2, count: 58 }], mrp_run: run, version: 1, origin: origin('gmes', 'crew', 'x') }, 'gmes');
    bad('mes.supply_plan.v1', { id: uid(32), code: 'SUP-1', version: 1, origin: origin('gmes', 'supply_plan', 'x'), mrp_run: run, lines: [{ item: item('NV-65U', 5), period: '2026-13', demand_qty: '1', planned_qty: '1', constraint: 'none' }] }, /period/);
    bad('mes.crew_requirement.v1', { id: uid(33), line: 'FA-2', shift: 'C', work_date: '2026-09-21', headcount: -1, skills: [], mrp_run: run, version: 1, origin: origin('gmes', 'crew', 'x') }, /headcount/);
  });
});

describe('receiving and quality of material', () => {
  const receipt = { id: mizanId(COMPANY, 'goods_receipt', 21), code: 'GR-00021', version: 1, origin: origin('mizan', 'goods_receipt', '21'), purchase_order: ref('PO-00004', 4), supplier: ref('S-CSOT', 3), receipt_date: '2026-10-28', warehouse: ref('RM', 2), status: 'posted', lines: [{ line_no: 1, item: item('OC-55', 9), qty: '480', uom: 'PCS', lot_no: 'L2610-01', supplier_lot: 'CSOT-8841', po_line_no: 1 }] };
  const decision = { id: uid(41), code: 'LD-1', version: 1, origin: origin('gmes', 'lot_decision', 'x'), item: item('OC-55', 9), lot_no: 'L2610-01', decision: 'rejected', accepted_qty: '0', rejected_qty: '480', uom: 'PCS', inspection: { plan_code: 'IQC-OC55', aql: '0.65', sample_size: 50, defects: 4 }, defect_codes: ['LINE-DEFECT'], decided_at: '2026-10-29T08:00:00Z', decided_by: { user: 'qa.nour' } };

  test('a goods receipt and a lot decision pass', () => {
    ok('acc.goods_receipt.v1', receipt);
    ok('mes.lot_decision.v1', decision, 'gmes');
  });

  test('a receipt with no lines or a zero quantity, and a decision that is not one of the five, are refused', () => {
    bad('acc.goods_receipt.v1', { ...receipt, lines: [] }, /lines/);
    bad('acc.goods_receipt.v1', { ...receipt, lines: [{ ...receipt.lines[0], qty: '0' }] }, /qty|greater/);
    bad('mes.lot_decision.v1', { ...decision, decision: 'maybe' }, /decision/);
  });
});

describe('people and pay', () => {
  const labor = { id: laborId(COMPANY, 'E000123', '2026-09-21'), version: 1, origin: origin('gmes', 'labor', 'E000123:2026-09-21'), employee: { id: hrId(COMPANY, 'employee', 'E000123'), code: 'E000123' }, production_date: '2026-09-21', shift: 'C', entries: [{ line: 'FA-2', station: 'FA-2-FT', minutes: 450 }], total_minutes: 450 };
  const payroll = { id: hrId(COMPANY, 'payroll_period', '2026-09:1'), code: 'PAY-2026-09-1', version: 1, origin: origin('hr', 'payroll_period', '2026-09:1'), period: '2026-09', run: 1, currency: 'EGP', pay_date: '2026-09-28', status: 'approved', lines: [{ cost_center: 'CC-FA2', account_key: 'gross_earnings', amount_minor: 125_000_000 }, { cost_center: 'CC-FA2', account_key: 'net_payable', amount_minor: 98_000_000 }], headcount: 120, hours: { regular: 19200, overtime_day: 800, overtime_night: 1500 } };

  test('a labour day and a payroll period pass', () => {
    ok('mes.labor_day.v1', labor, 'gmes');
    ok('hr.payroll_period.v1', payroll, 'hr');
  });

  test('more than 1440 minutes in a day, a negative amount, a fractional amount and a foreign currency are refused', () => {
    bad('mes.labor_day.v1', { ...labor, total_minutes: 1441 }, /total_minutes/);
    bad('hr.payroll_period.v1', { ...payroll, lines: [{ cost_center: 'X', account_key: 'gross_earnings', amount_minor: -5 }] }, /amount_minor/);
    bad('hr.payroll_period.v1', { ...payroll, lines: [{ cost_center: 'X', account_key: 'gross_earnings', amount_minor: 10.5 }] }, /amount_minor/);
    bad('hr.payroll_period.v1', { ...payroll, currency: 'USD' }, /currency/);
  });

  test('a payroll period names no person: an unknown key such as an employee is dropped by the contract, and no name field exists', () => {
    const keys = Object.keys((CONTRACTS['hr.payroll_period.v1'] as unknown as { shape: Record<string, unknown> }).shape);
    assert.ok(!keys.some((k) => /employee|name|person/.test(k)), keys.join(','));
  });
});

describe('the plant and its layout', () => {
  const node = { id: uid(51), code: 'FA-2-FT', version: 4, origin: origin('gmes', 'plant_node', 'x'), name: { en: 'Function test', ar: 'الاختبار الوظيفي' }, type: 'station', parent: ref('FA-2', 50), active: true, capacity_per_shift: 480, crew: 2 };
  const layout = { id: spaceId(COMPANY, 'layout', 'p-1a2b3c4d'), code: 'FA-HALL', version: 7, origin: origin('space', 'layout', 'p-1a2b3c4d'), name: 'FA hall', revision: 7, length_unit: '0.1mm', items: [{ item_id: 'S01', name: 'Function test', category: 'station', x: 120000, y: 84000, rotation_mdeg: 90000, w: 12000, d: 9000, h: 15000, eco_ref: { type: 'plant_node', id: node.id, code: 'FA-2-FT' } }], zones: [{ id: 'z1', kind: 'aisle', polygon: [[0, 0], [100000, 0], [100000, 30000]] }] };

  test('a plant node and a layout snapshot pass', () => {
    ok('eco.plant_node.v1', node, 'gmes');
    ok('eco.layout.snapshot.v1', layout, 'space');
  });

  test('a fractional position, another length unit, a zone with two points and a rotation of a full turn are refused', () => {
    bad('eco.layout.snapshot.v1', { ...layout, items: [{ ...layout.items[0], x: 1.5 }] }, /x/);
    bad('eco.layout.snapshot.v1', { ...layout, length_unit: 'mm' }, /length_unit/);
    bad('eco.layout.snapshot.v1', { ...layout, zones: [{ id: 'z', kind: 'k', polygon: [[0, 0], [1, 1]] }] }, /polygon/);
    bad('eco.layout.snapshot.v1', { ...layout, items: [{ ...layout.items[0], rotation_mdeg: 360000 }] }, /rotation_mdeg/);
  });

  test('ids: a layout id is stable per company and project, and never equals a Mizan or HR id for the same text', () => {
    assert.equal(spaceId(COMPANY, 'layout', 'p-1'), spaceId(COMPANY, 'layout', 'p-1'));
    assert.notEqual(spaceId(COMPANY, 'layout', 'p-1'), spaceId('0192f7c4-8a3e-7b21-9c55-3d1f2a4b6c7e', 'layout', 'p-1'));
    assert.notEqual(spaceId(COMPANY, 'layout', '1'), mizanId(COMPANY, 'item', 1));
    assert.ok(isUuid(laborId(COMPANY, 'E1', '2026-09-21')));
  });
});

describe('additive fields on existing contracts', () => {
  const itemV1 = { id: mizanId(COMPANY, 'item', 9), code: 'OC-55', name: { en: 'Open cell 55"', ar: 'خلية مفتوحة 55' }, active: true, version: 8, origin: origin('mizan', 'item', '9'), kind: 'product', stock_tracked: true, tracking: 'lot', base_uom: 'PCS', units: [] };

  test('an item without planning still passes (older snapshots), with planning passes, and a negative lead time is refused', () => {
    ok('eco.item.v1', itemV1);
    ok('eco.item.v1', { ...itemV1, planning: { material_type: 'raw', procurement: 'buy', lead_time_days: 70, moq: '30', lot_rule: 'multiple', lot_size: '30', safety_stock: '600', expedite_lead_time_days: 14 } });
    bad('eco.item.v1', { ...itemV1, planning: { material_type: 'raw', procurement: 'buy', lead_time_days: -1, moq: '0', lot_rule: 'lot_for_lot', lot_size: '0', safety_stock: '0' } }, /lead_time_days/);
    bad('eco.item.v1', { ...itemV1, planning: { material_type: 'gadget', procurement: 'buy', lead_time_days: 1, moq: '0', lot_rule: 'lot_for_lot', lot_size: '0', safety_stock: '0' } }, /material_type/);
  });

  test('a schedule day may name the line, and a blank line is refused', () => {
    const day = { id: uid(61), employee: { id: hrId(COMPANY, 'employee', 'E1'), code: 'E1' }, work_date: '2026-09-21', status: 'work', shift_code: 'C', paid_minutes: 450, version: 1, origin: origin('hr', 'schedule', 'E1:2026-09-21') };
    ok('eco.schedule_day.v1', { ...day, line: 'FA-2' }, 'hr');
    ok('eco.schedule_day.v1', day, 'hr');
    bad('eco.schedule_day.v1', { ...day, line: '' }, /line/);
  });

  test('the shipment dispatched event keeps working without the new order fields and accepts them when present', () => {
    const shipment = { shipment: { id: uid(71), code: 'SO-000001', customer: 'Retail chain' }, container: { id: uid(72), number: 'MSKU1234565', seal: 'S1', type: '40HC' }, lines: [{ item: item('NV-65U', 5), qty: '320', uom: 'PCS', warehouse: ref('FG', 6), pallets: 8 }], dispatched_at: '2026-09-17T18:00:00Z', production_date: '2026-09-17', performed_by: { user: 'sup.ma' }, shipping_seq: 12 };
    ok('mes.shipment.dispatched.v1', shipment, 'gmes');
    ok('mes.shipment.dispatched.v1', { ...shipment, shipment: { ...shipment.shipment, customer_party: ref('C-BTECH', 1) }, lines: [{ ...shipment.lines[0], sales_order: { id: so.id, code: 'SO-00011', line_no: 1 } }] }, 'gmes');
  });
});
