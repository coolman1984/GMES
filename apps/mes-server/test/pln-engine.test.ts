import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { addDays, isoWeek, plan, type Bom, type Commitment, type LineInfo, type PlanInput, type PlanItem, type SalesLine } from '../src/modules/pln/engine.js';

const TODAY = '2026-09-28';                                       // a Monday
const q = (n: number) => Math.round(n * 1000);                     // quantities are thousandths
const day = (n: number) => addDays(TODAY, n);

const item = (id: string, extra: Partial<PlanItem> = {}): PlanItem => ({
  id, code: id, kind: 'product', procurement: 'buy', hasPlanning: true, leadTimeDays: 0, moq: 0, lotRule: 'lot_for_lot', lotSize: 0, safetyStock: 0, expediteLeadTimeDays: null, ...extra,
});
const make = (id: string, extra: Partial<PlanItem> = {}) => item(id, { procurement: 'make', ...extra });
const bom = (parentId: string, lines: [string, number, number?][]): Bom => ({ parentId, lines: lines.map(([componentId, qtyPer, scrapBp]) => ({ componentId, qtyPer: q(qtyPer), scrapBp: scrapBp ?? 0 })) });
const sale = (orderCode: string, itemId: string, qty: number, date: string, lineNo = 1): SalesLine => ({ orderCode, lineNo, itemId, itemCode: itemId, openQty: q(qty), date, priority: 2 });
const line = (code: string, capacity: number | null, shifts: string[] = ['A'], crew = 0, stations: LineInfo['stations'] = []): LineInfo => ({ code, capacityPerShift: capacity === null ? null : q(capacity), crew, stations, shiftsOn: () => shifts });

function input(extra: Partial<PlanInput> = {}): PlanInput {
  return {
    today: TODAY, horizonDays: 60, frozenDays: 0, defaultMakeLeadDays: 1, isWorkingDay: () => true, shiftOrder: ['A', 'B', 'C'],
    items: [], boms: [], itemLines: new Map(), lines: [], sales: [], demandPlans: [], onHand: new Map(), receipts: [], commitments: [], ...extra,
  };
}
// exceptions that need a person; `info` ones (an item made without a BOM, an item not tied to a line) are only listed
const problems = (o: ReturnType<typeof plan>) => o.exceptions.filter((e) => e.severity !== 'info');
const rec = (o: ReturnType<typeof plan>, itemId: string, date: string) => o.records.find((r) => r.itemId === itemId && r.date === date);

describe('the classic MRP case: two levels, lead times, lot rules, exact record', () => {
  // A (made, 1 working day) = 2 x B (made, fixed lot 50) + 1 x C (bought, 5 days);  B = 3 x D (bought, 3 days)
  const items = [make('A'), make('B', { lotRule: 'fixed', lotSize: q(50) }), item('C', { leadTimeDays: 5 }), item('D', { leadTimeDays: 3 })];
  const boms = [bom('A', [['B', 2], ['C', 1]]), bom('B', [['D', 3]])];
  const base = () => input({ items, boms, sales: [sale('SO-1', 'A', 40, day(10))] });

  test('demand 40 of A on day 10 gives the exact time-phased records, orders and requisitions', () => {
    const o = plan(base());
    assert.deepEqual(rec(o, 'A', day(10)), { itemId: 'A', date: day(10), gross: q(40), scheduledReceipts: 0, projectedOnHand: 0, net: q(40), plannedReceipt: q(40) });
    assert.deepEqual(o.plannedOrders.filter((p) => p.itemId === 'A').map((p) => [p.qty, p.startDate, p.dueDate]), [[q(40), day(9), day(10)]]);
    // B: 2 x 40 = 80 needed on day 9; the fixed lot of 50 makes it 100, the extra 20 stays in stock
    assert.deepEqual(rec(o, 'B', day(9)), { itemId: 'B', date: day(9), gross: q(80), scheduledReceipts: 0, projectedOnHand: q(20), net: q(80), plannedReceipt: q(100) });
    assert.deepEqual(o.plannedOrders.filter((p) => p.itemId === 'B').map((p) => [p.qty, p.startDate, p.dueDate]), [[q(100), day(8), day(9)]]);
    // D: 3 x 100 = 300 needed when B starts (day 8); order by day 5 (3 days lead)
    // C: 40 needed when A starts (day 9); order by day 4 (5 days lead)
    const req = (id: string) => o.requisitions.find((r) => r.itemId === id)!;
    assert.deepEqual([req('D').qty, req('D').needDate, req('D').orderByDate, req('D').pastDue], [q(300), day(8), day(5), false]);
    assert.deepEqual([req('C').qty, req('C').needDate, req('C').orderByDate, req('C').pastDue], [q(40), day(9), day(4), false]);
    assert.equal(problems(o).length, 0);
  });

  test('stock and a scheduled receipt come first: no purchase when they cover the need', () => {
    const o = plan({ ...base(), onHand: new Map([['C', q(15)]]), receipts: [{ itemId: 'C', date: day(6), qty: q(25), ref: 'PO-1' }] });
    assert.equal(o.requisitions.find((r) => r.itemId === 'C'), undefined, '15 in stock + 25 arriving on day 6 = the 40 needed on day 9');
    const r = rec(o, 'C', day(9))!;
    assert.deepEqual([r.gross, r.projectedOnHand, r.plannedReceipt], [q(40), 0, 0]);
  });

  test('a shortage of stock buys only the difference', () => {
    const o = plan({ ...base(), onHand: new Map([['C', q(15)]]) });
    assert.equal(o.requisitions.find((r) => r.itemId === 'C')!.qty, q(25));
  });

  test('every planned quantity says which sales order it serves, and the pegs add up exactly', () => {
    const o = plan(base());
    for (const p of o.plannedOrders) assert.equal(p.pegging.reduce((a, x) => a + x.qty, 0), p.qty, `${p.itemId} pegs`);
    const d = o.requisitions.find((r) => r.itemId === 'D')!;
    assert.equal(d.pegging.reduce((a, x) => a + x.qty, 0), d.qty);
    assert.ok(d.pegging.some((x) => x.kind === 'sales_order' && x.reference === 'SO-1/1'), 'the purchase of D traces back to SO-1 line 1');
    assert.ok(d.pegging.some((x) => x.kind === 'safety_stock'), 'the lot-size excess is labelled, not hidden');
  });
});

describe('lot sizing, minimum order, safety stock', () => {
  test('safety stock is a floor: with 4 in stock and 10 required, 6 are planned on day 0', () => {
    const o = plan(input({ items: [item('S', { safetyStock: q(10) })], onHand: new Map([['S', q(4)]]) }));
    assert.deepEqual([o.requisitions[0]!.qty, o.requisitions[0]!.needDate], [q(6), day(0)]);
  });

  test('minimum order and multiples of the lot round up, never down', () => {
    const buy = (extra: Partial<PlanItem>) => plan(input({ items: [item('X', extra)], sales: [sale('SO', 'X', 7, day(5))] })).requisitions[0]!.qty;
    assert.equal(buy({ moq: q(30) }), q(30));
    assert.equal(buy({ lotRule: 'multiple', lotSize: q(12) }), q(12));
    assert.equal(buy({ lotRule: 'fixed', lotSize: q(5) }), q(10));
    assert.equal(buy({ moq: q(30), lotRule: 'multiple', lotSize: q(12) }), q(36), 'minimum first, then the multiple');
    assert.equal(buy({}), q(7), 'lot for lot: exactly what is needed');
  });

  test('the excess of a lot carries forward and covers the next demand', () => {
    const o = plan(input({ items: [item('X', { lotRule: 'fixed', lotSize: q(100) })], sales: [sale('A', 'X', 30, day(5)), sale('B', 'X', 30, day(8), 1), sale('C', 'X', 50, day(12), 1)] }));
    assert.deepEqual(o.requisitions.map((r) => r.qty), [q(100), q(100)], '30 + 30 from the first lot (40 left), then 50 needs a second lot');
  });
});

describe('the BOM: exact quantities, scrap, cycles', () => {
  test('scrap adds to the component and is exact', () => {
    // 1000 units x 1.5 per unit x (1 + 2 %) = 1530
    const o = plan(input({ items: [make('P'), item('C')], boms: [bom('P', [['C', 1.5, 200]])], sales: [sale('SO', 'P', 1000, day(5))] }));
    assert.equal(o.requisitions.find((r) => r.itemId === 'C')!.qty, q(1530));
    assert.equal(o.stats.roundedUp, 0);
  });

  test('a fraction below a thousandth is rounded UP and counted, never silent', () => {
    const o = plan(input({ items: [make('P'), item('C')], boms: [{ parentId: 'P', lines: [{ componentId: 'C', qtyPer: 1, scrapBp: 0 }] }], sales: [{ ...sale('SO', 'P', 0.5, day(5)), openQty: 500 }] }));
    assert.equal(o.requisitions.find((r) => r.itemId === 'C')!.qty, 1, '0.5 x 0.001 = 0.0005, up to 0.001');
    assert.equal(o.stats.roundedUp, 1);
  });

  test('a BOM that contains itself stops the run with a clear exception and plans nothing', () => {
    const o = plan(input({ items: [make('A'), make('B')], boms: [bom('A', [['B', 1]]), bom('B', [['A', 1]])], sales: [sale('SO', 'A', 5, day(3))] }));
    assert.deepEqual(o.exceptions.map((e) => e.kind), ['bom_cycle']);
    assert.equal(o.plannedOrders.length, 0);
  });

  test('a component shared by two levels is planned once, after all its demand is known (low-level code)', () => {
    // P = 1 x Q + 1 x Z;  Q = 1 x Z.  Z is needed by P directly and through Q: it must be netted AFTER Q.
    const o = plan(input({ items: [make('P'), make('Q'), item('Z')], boms: [bom('P', [['Q', 1], ['Z', 1]]), bom('Q', [['Z', 1]])], sales: [sale('SO', 'P', 10, day(10))] }));
    const z = o.requisitions.filter((r) => r.itemId === 'Z');
    assert.equal(z.reduce((a, r) => a + r.qty, 0), q(20), '10 for P and 10 for Q');
  });
});

describe('demand: firm orders, the approved plan, forecast consumption, the fence', () => {
  const plans = (qty: number, period = '2026-10') => [{ planCode: 'SOP-1', itemId: 'X', itemCode: 'X', period, qty: q(qty) }];

  test('the forecast of a month not covered by firm orders is spread evenly over its working days', () => {
    const o = plan(input({ items: [item('X')], demandPlans: plans(310), horizonDays: 90 }));
    const gross = o.records.filter((r) => r.itemId === 'X' && r.date.startsWith('2026-10')).map((r) => r.gross);
    assert.equal(gross.length, 31);
    assert.equal(gross.reduce((a, b) => a + b, 0), q(310));
    assert.ok(gross.every((g) => g === q(10)));
  });

  test('firm orders of the month consume the forecast: only the rest is planned from the plan', () => {
    const o = plan(input({ items: [item('X')], demandPlans: plans(310), sales: [sale('SO', 'X', 100, '2026-10-15')], horizonDays: 90 }));
    const sum = (kind: string) => o.records.filter((r) => r.itemId === 'X' && r.date.startsWith('2026-10')).reduce((a, r) => a + r.gross, 0);
    assert.equal(sum('all'), q(310), '100 firm + 210 forecast left = the plan, not more');
  });

  test('a forecast smaller than the firm orders adds nothing', () => {
    const o = plan(input({ items: [item('X')], demandPlans: plans(50), sales: [sale('SO', 'X', 100, '2026-10-15')], horizonDays: 90 }));
    assert.equal(o.records.filter((r) => r.itemId === 'X').reduce((a, r) => a + r.gross, 0), q(100));
  });

  test('inside the frozen fence the forecast is ignored, firm orders still count', () => {
    const o = plan(input({ items: [item('X')], demandPlans: plans(300, '2026-09'), sales: [sale('SO', 'X', 5, day(3))], frozenDays: 14, horizonDays: 60 }));
    const inFence = o.records.filter((r) => r.itemId === 'X' && r.date <= day(14)).reduce((a, r) => a + r.gross, 0);
    assert.equal(inFence, q(5), 'only the firm order: no September forecast before day 15');
  });

  test('an order due in the past is planned for today and reported', () => {
    const o = plan(input({ items: [item('X')], sales: [sale('SO', 'X', 5, day(-3))] }));
    assert.equal(o.requisitions[0]!.needDate, day(0));
    assert.ok(o.exceptions.some((e) => e.kind === 'past_due_demand'));
  });

  test('an order for an item planning does not know is an exception, not a crash', () => {
    const o = plan(input({ items: [item('X')], sales: [sale('SO', 'NOPE', 5, day(3))] }));
    assert.deepEqual(o.exceptions.map((e) => e.kind), ['unknown_item']);
  });
});

describe('purchasing dates', () => {
  test('a requisition whose order-by date is already past is flagged, with the way out when there is one', () => {
    const items = [item('OC', { leadTimeDays: 70, expediteLeadTimeDays: 14 }), item('NO', { leadTimeDays: 70 })];
    const o = plan(input({ items, sales: [sale('S1', 'OC', 10, day(30)), sale('S2', 'NO', 10, day(30))] }));
    const oc = o.requisitions.find((r) => r.itemId === 'OC')!, no = o.requisitions.find((r) => r.itemId === 'NO')!;
    assert.deepEqual([oc.pastDue, oc.expediteWouldMeetNeed], [true, true]);
    assert.deepEqual([no.pastDue, no.expediteWouldMeetNeed], [true, false]);
    assert.equal(o.exceptions.find((e) => e.itemId === 'OC')!.severity, 'warn');
    assert.equal(o.exceptions.find((e) => e.itemId === 'NO')!.severity, 'error');
  });

  test('needs in the same ISO week merge into one requisition with a stable key; the next week is another', () => {
    assert.equal(isoWeek('2026-09-28'), '2026-W40');
    assert.equal(isoWeek('2026-01-01'), '2026-W01');
    assert.equal(isoWeek('2024-12-30'), '2025-W01');
    assert.equal(isoWeek('2021-01-03'), '2020-W53');
    const o = plan(input({ items: [item('X', { leadTimeDays: 2 })], sales: [sale('A', 'X', 4, '2026-10-06'), sale('B', 'X', 6, '2026-10-08'), sale('C', 'X', 1, '2026-10-13')] }));
    assert.deepEqual(o.requisitions.map((r) => [r.key, r.qty, r.needDate]), [['X|2026-W41', q(10), '2026-10-06'], ['X|2026-W42', q(1), '2026-10-13']]);
    assert.deepEqual(plan(input({ items: [item('X', { leadTimeDays: 2 })], sales: [sale('A', 'X', 4, '2026-10-06'), sale('B', 'X', 6, '2026-10-08')] })).requisitions.map((r) => r.key), ['X|2026-W41']);
  });

  test('an overdue purchase order still counts, today, and is reported', () => {
    const o = plan(input({ items: [item('X')], sales: [sale('A', 'X', 4, day(5))], receipts: [{ itemId: 'X', date: day(-4), qty: q(4), ref: 'PO-9' }] }));
    assert.equal(o.requisitions.length, 0);
    assert.ok(o.exceptions.some((e) => e.kind === 'po_overdue'));
  });
});

describe('capacity: backward loading, overload and the proposal', () => {
  const fa = (shifts: string[] = ['A']) => line('FA-2', 100, shifts);
  const tv = () => make('TV');
  const cfg = (qty: number, extra: Partial<PlanInput> = {}) => input({ items: [tv()], lines: [fa()], itemLines: new Map([['TV', ['FA-2']]]), sales: [sale('SO', 'TV', qty, day(4))], ...extra });

  test('a large order is spread backward over the days the line has, chunk by chunk', () => {
    const o = plan(cfg(350));
    assert.deepEqual(o.plannedOrders.map((p) => [p.qty, p.dueDate]), [[q(50), day(1)], [q(100), day(2)], [q(100), day(3)], [q(100), day(4)]]);
    assert.equal(problems(o).length, 0);
    assert.equal(o.proposals.length, 0);
  });

  test('a rest day gives no capacity: the work moves to the working days before it', () => {
    const o = plan(cfg(250, { isWorkingDay: (d) => d !== day(3) }));
    assert.deepEqual(o.plannedOrders.map((p) => p.dueDate), [day(1), day(2), day(4)], '250 = 100 + 100 + 50 over the three working days before day 4');
    assert.ok(o.plannedOrders.every((p) => p.dueDate !== day(3)));
  });

  test('more than the line can make before today is an overload: planned anyway, reported, with the smallest shift proposal', () => {
    const o = plan(cfg(600));                                  // days 0..4 hold 500
    const e = o.exceptions.find((x) => x.kind === 'capacity_overload')!;
    assert.equal(e.severity, 'error');
    assert.equal((e.data as { unplacedQty: number }).unplacedQty, q(100));
    assert.deepEqual(o.proposals, [{ line: 'FA-2', shift: 'B', from: day(4), to: day(4), days: 1, addedCapacity: q(100) }]);
    assert.equal(o.plannedOrders.reduce((a, p) => a + p.qty, 0), q(600), 'nothing is dropped: the whole order is planned');
    assert.equal(o.stats.overloadUnits, q(100));
  });

  test('accepting the proposal (a second shift on that day) removes the overload', () => {
    const withB = { ...fa(), shiftsOn: (d: string) => (d === day(4) ? ['A', 'B'] : ['A']) };
    const o = plan(cfg(600, { lines: [withB] }));
    assert.equal(o.exceptions.filter((e) => e.kind === 'capacity_overload').length, 0);
    assert.equal(o.proposals.length, 0);
    assert.equal(o.plannedOrders.find((p) => p.dueDate === day(4))!.qty, q(200));
    // the five days are now full, so the chunk due today cannot start before today: that is its own, true, warning
    assert.deepEqual(problems(o).map((e) => [e.kind, e.date]), [['late_start', day(0)]]);
  });

  test('a firmed order already uses its line, so new work loads around it', () => {
    const firmed: Commitment = { id: 'PO-F1', itemId: 'TV', openQty: q(100), startDate: day(3), dueDate: day(4), lineCode: 'FA-2', status: 'firmed' };
    const o = plan(cfg(150, { commitments: [firmed] }));
    // the firmed 100 fills day 4 and counts as supply, so 50 more are needed and go to day 3
    assert.deepEqual(o.plannedOrders.map((p) => [p.qty, p.dueDate]), [[q(50), day(3)]]);
  });

  test('a line with no capacity figure is never overloaded', () => {
    const o = plan(input({ items: [tv()], lines: [line('FA-9', null)], itemLines: new Map([['TV', ['FA-9']]]), sales: [sale('SO', 'TV', 99999, day(2))] }));
    assert.equal(problems(o).length, 0);
    assert.equal(o.plannedOrders.length, 1);
  });

  test('of several candidate lines the one with more free capacity is chosen', () => {
    const o = plan(input({ items: [tv()], lines: [line('L1', 100), line('L2', 300)], itemLines: new Map([['TV', ['L1', 'L2']]]), sales: [sale('SO', 'TV', 200, day(4))] }));
    assert.ok(o.plannedOrders.every((p) => p.lineCode === 'L2'));
  });
});

describe('crew: the people each line needs per shift and day', () => {
  const stations = [{ code: 'FA-2-FT', crew: 2, requirements: [{ skill: 'FCT', level: 3 }] }, { code: 'FA-2-PK', crew: 3, requirements: [{ skill: 'PACK', level: 2 }, { skill: 'ESD', level: 2 }] }];
  const cfg = (qty: number, shifts: string[]) => input({ items: [make('TV')], lines: [line('FA-2', 100, shifts, 4, stations)], itemLines: new Map([['TV', ['FA-2']]]), sales: [sale('SO', 'TV', qty, day(2))] });

  test('a loaded day needs the line crew plus every station crew, with the skills of the stations', () => {
    const o = plan(cfg(80, ['A', 'B']));
    const row = o.crew.find((c) => c.date === day(2))!;
    assert.deepEqual([row.line, row.shift, row.headcount], ['FA-2', 'A', 9], '4 on the line + 2 + 3');
    assert.deepEqual(row.skills, [{ skill: 'ESD', level: 2, count: 3 }, { skill: 'FCT', level: 3, count: 2 }, { skill: 'PACK', level: 2, count: 3 }]);
  });

  test('a second shift is staffed only on the days the load needs it', () => {
    const o = plan(cfg(260, ['A', 'B']));                     // 200 on the due day (both shifts), the other 60 the day before (one shift)
    const shiftsOn = (d: number) => o.crew.filter((c) => c.date === day(d)).map((c) => c.shift);
    assert.deepEqual([shiftsOn(2), shiftsOn(1), shiftsOn(0)], [['A', 'B'], ['A'], []]);
  });

  test('days with no load need nobody', () => {
    const o = plan(cfg(80, ['A']));
    assert.deepEqual(o.crew.map((c) => c.date), [day(2)]);
  });
});

describe('the supply plan says where demand is not met, and why', () => {
  test('a month that fits is "none"; an overloaded line makes it "capacity"', () => {
    const cfg = (qty: number) => input({ items: [make('TV')], lines: [line('L', 100)], itemLines: new Map([['TV', ['L']]]), sales: [sale('SO', 'TV', qty, day(4))] });
    const october = (o: ReturnType<typeof plan>) => o.supplyPlan.find((s) => s.itemId === 'TV' && s.period === '2026-10')!;   // earlier months only show production made ahead
    assert.equal(october(plan(cfg(300))).constraint, 'none');
    const s = october(plan(cfg(900)));
    assert.deepEqual([s.demandQty, s.constraint], [q(900), 'capacity']);
  });

  test('a purchase that cannot arrive in time and has no fast alternative makes it "material"', () => {
    const o = plan(input({ items: [make('TV'), item('OC', { leadTimeDays: 70 })], boms: [bom('TV', [['OC', 1]])], sales: [sale('SO', 'TV', 10, day(20))] }));
    assert.equal(o.supplyPlan.find((s) => s.itemId === 'TV' && s.period === '2026-10')!.constraint, 'material');
  });

  test('capacity and material together are "both"', () => {
    const o = plan(input({ items: [make('TV'), item('OC', { leadTimeDays: 70 })], boms: [bom('TV', [['OC', 1]])], lines: [line('L', 100)], itemLines: new Map([['TV', ['L']]]), sales: [sale('SO', 'TV', 900, day(4))] }));
    assert.equal(o.supplyPlan.find((s) => s.itemId === 'TV' && s.period === '2026-10')!.constraint, 'both');
  });
});

describe('determinism', () => {
  test('the same input, in any order, gives the same output byte for byte', () => {
    const build = (flip: boolean) => {
      const sales = [sale('SO-1', 'A', 40, day(10)), sale('SO-2', 'A', 25, day(12)), sale('SO-3', 'A', 60, day(9))];
      const items = [make('A'), make('B', { lotRule: 'fixed', lotSize: q(50) }), item('C', { leadTimeDays: 5 }), item('D', { leadTimeDays: 3 })];
      return input({
        items: flip ? [...items].reverse() : items, boms: flip ? [bom('B', [['D', 3]]), bom('A', [['B', 2], ['C', 1]])] : [bom('A', [['B', 2], ['C', 1]]), bom('B', [['D', 3]])],
        sales: flip ? [...sales].reverse() : sales, lines: [line('L', 60)], itemLines: new Map([['A', ['L']]]),
      });
    };
    const a = JSON.stringify(plan(build(false))), b = JSON.stringify(plan(build(true)));
    assert.equal(a, b);
    assert.equal(a, JSON.stringify(plan(build(false))), 'and again');
  });
});

describe('firmed and released orders are supply, and their components are still needed', () => {
  test('a released order covers demand on its due day, and its components are required when it starts', () => {
    const released: Commitment = { id: 'WO-7', itemId: 'A', openQty: q(30), startDate: day(4), dueDate: day(5), lineCode: null, status: 'released' };
    const o = plan(input({ items: [make('A'), item('C')], boms: [bom('A', [['C', 2]])], sales: [sale('SO', 'A', 30, day(5))], commitments: [released] }));
    assert.equal(o.plannedOrders.length, 0, 'the released order covers the sales order');
    assert.deepEqual(o.requisitions.map((r) => [r.itemId, r.qty, r.needDate]), [['C', q(60), day(4)]]);
  });
});
