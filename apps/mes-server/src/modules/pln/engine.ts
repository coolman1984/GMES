/**
 * The planning engine (MPS + MRP + rough-cut capacity + crew). A PURE function: the same input gives the same output,
 * byte for byte. No clock, no database, no randomness; `input.today` is given.
 *
 * Units: quantities are integers in thousandths (x1000, ADR-018); dates are "YYYY-MM-DD"; day 0 is `today`.
 * Nothing here is money: quantities and days only (manufacturing never holds a price).
 *
 * What it does, in order (plan/20-GMES.md, WP-G2):
 *  1. demand per finished item and day: firm sales-order lines, plus the approved demand plan of each month that firm
 *     orders have not already used ("forecast consumption"); the forecast inside the frozen fence is ignored;
 *  2. items are planned level by level (low-level code): time-phased netting against stock, scheduled receipts (open
 *     purchase orders, firmed and released orders) and safety stock, sized by the item's lot rule and minimum order;
 *  3. a buy item's planned receipt becomes a REQUISITION (order-by = need date minus the lead time); a make item's becomes
 *     planned orders, loaded BACKWARD onto its line within the line's capacity (chunks); each chunk's start date explodes
 *     into the components' gross requirements (BOM quantity x (1 + scrap), rounded UP to a thousandth and counted);
 *  4. overload that the line cannot absorb is an exception with a proposal ("add shift C on line L from D1 to D2");
 *  5. crew: people each line needs per shift and day (line crew + station crews, skills from station requirements);
 *  6. pegging: every planned quantity says which demand it serves; a supply plan per finished item and month.
 */

export type LotRule = 'lot_for_lot' | 'fixed' | 'multiple';

export interface PlanItem {
  id: string;
  code: string;
  kind: 'product' | 'service';
  /** From planning parameters when the item has them; otherwise derived: an item with an approved BOM is made, else bought. */
  procurement: 'buy' | 'make';
  hasPlanning: boolean;
  /** Buy: calendar days from order to plant warehouse. Make: working days from start to finish (0 = the default). */
  leadTimeDays: number;
  moq: number;
  lotRule: LotRule;
  lotSize: number;
  safetyStock: number;
  expediteLeadTimeDays: number | null;
}

export interface BomLine { componentId: string; qtyPer: number; scrapBp: number }
export interface Bom { parentId: string; lines: BomLine[] }

export interface SalesLine { orderCode: string; lineNo: number; itemId: string; itemCode: string; openQty: number; date: string; priority: number }
export interface DemandPlanLine { planCode: string; itemId: string; itemCode: string; period: string; qty: number }
export interface SupplyReceipt { itemId: string; date: string; qty: number; ref: string }
export interface Commitment { id: string; itemId: string; openQty: number; startDate: string; dueDate: string; lineCode: string | null; status: 'firmed' | 'released'; pegs?: Peg[] }

export interface StationInfo { code: string; crew: number; requirements: { skill: string; level: number }[] }
export interface LineInfo {
  code: string;
  /** Units per shift; null = not capacity-limited. */
  capacityPerShift: number | null;
  /** People the line itself needs per running shift (leader, handlers, repair). */
  crew: number;
  stations: StationInfo[];
  /** Shifts the line runs on a working day, as codes in order (e.g. ['A','B'], or ['A','B','C'] while a third shift is added). */
  shiftsOn(date: string): string[];
}

export interface PlanInput {
  today: string;
  horizonDays: number;
  /** Days from today inside which forecast is ignored and firmed/released orders are never changed. */
  frozenDays: number;
  defaultMakeLeadDays: number;
  /** Whether a date is a working day of the plant (shifts, rest days and holidays are the caller's business). */
  isWorkingDay(date: string): boolean;
  /** The order shifts are added in, e.g. ['A','B','C']. */
  shiftOrder: string[];
  items: PlanItem[];
  boms: Bom[];
  /** Candidate lines of a make item, best first. */
  itemLines: Map<string, string[]>;
  lines: LineInfo[];
  sales: SalesLine[];
  demandPlans: DemandPlanLine[];
  /** Usable stock per item: on hand minus reserved, summed over the planning warehouses. */
  onHand: Map<string, number>;
  receipts: SupplyReceipt[];
  commitments: Commitment[];
}

export interface Peg { kind: 'sales_order' | 'demand_plan' | 'safety_stock'; reference: string; qty: number }

export interface MrpRecord { itemId: string; date: string; gross: number; scheduledReceipts: number; projectedOnHand: number; net: number; plannedReceipt: number }
export interface PlannedOrder { itemId: string; qty: number; startDate: string; dueDate: string; lineCode: string | null; pegging: Peg[] }
export interface Requisition { key: string; itemId: string; qty: number; needDate: string; orderByDate: string; pegging: Peg[]; expediteWouldMeetNeed: boolean; pastDue: boolean }
export interface CrewRow { line: string; shift: string; date: string; headcount: number; skills: { skill: string; level: number; count: number }[] }
export interface SupplyLine { itemId: string; period: string; demandQty: number; plannedQty: number; constraint: 'none' | 'capacity' | 'material' | 'both' }
export interface LoadCell { line: string; date: string; loaded: number; capacity: number }
export interface Proposal { line: string; shift: string; from: string; to: string; days: number; addedCapacity: number }
export interface PlanException {
  kind: 'bom_cycle' | 'unknown_item' | 'no_bom' | 'late_start' | 'past_due_demand' | 'past_due_order' | 'po_overdue' | 'capacity_overload' | 'no_line';
  severity: 'info' | 'warn' | 'error';
  itemId?: string;
  line?: string;
  date?: string;
  data: Record<string, unknown>;
}

export interface PlanOutput {
  records: MrpRecord[];
  plannedOrders: PlannedOrder[];
  requisitions: Requisition[];
  crew: CrewRow[];
  supplyPlan: SupplyLine[];
  load: LoadCell[];
  proposals: Proposal[];
  exceptions: PlanException[];
  stats: { items: number; levels: number; plannedOrders: number; requisitions: number; roundedUp: number; overloadUnits: number };
}

// ------------------------------------------------------------------ dates (pure arithmetic on "YYYY-MM-DD")
const DAY_MS = 86_400_000;
const num = (d: string): number => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / DAY_MS;
const str = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10);
export const addDays = (d: string, n: number): string => str(num(d) + n);
export const daysBetween = (a: string, b: string): number => num(b) - num(a);
/** ISO 8601 year-week of a date, e.g. "2026-W40" (the requisition's stable bucket). */
export function isoWeek(d: string): string {
  const n = num(d);
  const dow = (((n + 3) % 7) + 7) % 7;               // Monday = 0
  const thursday = n - dow + 3;
  const year = new Date(thursday * DAY_MS).getUTCFullYear();
  const jan4 = Date.UTC(year, 0, 4) / DAY_MS;
  const week = 1 + Math.floor((thursday - (jan4 - ((((jan4 + 3) % 7) + 7) % 7) + 3)) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// ------------------------------------------------------------------ exact arithmetic helpers
const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

/** Component quantity (x1000) for `parent` units (x1000): parent x qtyPer x (1 + scrap), rounded UP to a thousandth. */
function componentQty(parentQty: number, qtyPer: number, scrapBp: number): { qty: number; rounded: boolean } {
  const numerator = BigInt(parentQty) * BigInt(qtyPer) * BigInt(10_000 + scrapBp);
  const denominator = 1000n * 10_000n;
  const q = ceilDiv(numerator, denominator);
  return { qty: Number(q), rounded: numerator % denominator !== 0n };
}

/** Splits `target` in proportion to the weights, exactly (largest remainder, ties by key). */
function split(weights: Map<string, number>, target: number): Map<string, number> {
  const total = [...weights.values()].reduce((a, b) => a + b, 0);
  const out = new Map<string, number>();
  if (target <= 0) return out;
  if (total <= 0) { out.set('safety_stock||', target); return out; }
  const keys = [...weights.keys()].sort();
  let given = 0;
  const rest: { key: string; frac: bigint }[] = [];
  for (const k of keys) {
    const w = BigInt(weights.get(k)!);
    const share = (w * BigInt(target)) / BigInt(total);
    out.set(k, Number(share));
    given += Number(share);
    rest.push({ key: k, frac: (w * BigInt(target)) % BigInt(total) });
  }
  rest.sort((a, b) => (a.frac === b.frac ? (a.key < b.key ? -1 : 1) : a.frac > b.frac ? -1 : 1));
  for (let i = 0; given < target; i = (i + 1) % rest.length) { out.set(rest[i]!.key, out.get(rest[i]!.key)! + 1); given++; }
  return new Map([...out].filter(([, v]) => v > 0));
}

const addTo = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
// a peg key carries what the supply plan needs: kind | reference | item id | date
const pegKey = (kind: Peg['kind'], reference: string, itemId: string, date: string) => `${kind}|${reference}|${itemId}|${date}`;
function toPegs(m: Map<string, number>): Peg[] {
  const out: Peg[] = [];
  for (const [k, qty] of [...m].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const [kind, reference] = k.split('|') as [Peg['kind'], string];
    out.push({ kind, reference: reference || 'safety stock', qty });
  }
  return out.slice(0, 200);
}

interface Gross { qty: number; pegs: Map<string, number> }
interface Request { itemId: string; dueIdx: number; qty: number; pegs: Map<string, number> }

export function plan(input: PlanInput): PlanOutput {
  const out: PlanOutput = { records: [], plannedOrders: [], requisitions: [], crew: [], supplyPlan: [], load: [], proposals: [], exceptions: [], stats: { items: 0, levels: 0, plannedOrders: 0, requisitions: 0, roundedUp: 0, overloadUnits: 0 } };
  const N = input.horizonDays + 1;                                       // day indexes 0 .. horizonDays
  const dateOf = (i: number) => addDays(input.today, i);
  const idxOf = (d: string) => Math.max(0, daysBetween(input.today, d));  // anything past due counts today
  const working = (i: number) => input.isWorkingDay(dateOf(i));
  const workingOnOrBefore = (i: number) => { let k = Math.min(i, N - 1); while (k > 0 && !working(k)) k--; return k; };
  const firstWorkingFromToday = () => { let k = 0; while (k < N - 1 && !working(k)) k++; return k; };
  const backWorking = (from: number, days: number): { idx: number; truncated: boolean } => {
    let k = from, left = days;
    while (left > 0) { k--; if (k < 0) return { idx: 0, truncated: true }; if (working(k)) left--; }
    return { idx: k, truncated: false };
  };
  const exception = (e: PlanException) => out.exceptions.push(e);

  const items = new Map(input.items.map((i) => [i.id, i]));
  const bomOf = new Map(input.boms.map((b) => [b.parentId, b]));
  const lineOf = new Map(input.lines.map((l) => [l.code, l]));

  // ---------------------------------------------------------------- low-level codes (BOM graph); a cycle stops the run
  const level = new Map<string, number>();
  const visiting = new Set<string>();
  let cycle: string | null = null;
  const depth = (id: string): number => {
    if (level.has(id)) return level.get(id)!;
    if (visiting.has(id)) { cycle ??= id; return 0; }
    visiting.add(id);
    let d = 0;
    for (const l of bomOf.get(id)?.lines ?? []) d = Math.max(d, 1 + depth(l.componentId));
    visiting.delete(id);
    level.set(id, d);
    return d;
  };
  // "level" here counts depth BELOW an item; the planning level is the deepest chain ABOVE it, so invert with parents
  const parentsOf = new Map<string, string[]>();
  for (const b of input.boms) for (const l of b.lines) (parentsOf.get(l.componentId) ?? parentsOf.set(l.componentId, []).get(l.componentId)!).push(b.parentId);
  for (const i of input.items) depth(i.id);
  if (cycle) {
    exception({ kind: 'bom_cycle', severity: 'error', itemId: cycle, data: { item: items.get(cycle)?.code ?? cycle } });
    return out;
  }
  const llc = new Map<string, number>();
  const up = (id: string, seen = new Set<string>()): number => {
    if (llc.has(id)) return llc.get(id)!;
    let d = 0;
    for (const p of parentsOf.get(id) ?? []) if (!seen.has(p)) d = Math.max(d, 1 + up(p, new Set([...seen, id])));
    llc.set(id, d);
    return d;
  };
  for (const i of input.items) up(i.id);
  const levels = [...new Set([...llc.values()])].sort((a, b) => a - b);
  out.stats.levels = levels.length;

  // ---------------------------------------------------------------- gross requirements: independent demand
  const gross = new Map<string, Map<number, Gross>>();
  const addGross = (itemId: string, idx: number, qty: number, pegs: Map<string, number>) => {
    if (qty <= 0 || idx >= N) return;
    const byDay = gross.get(itemId) ?? gross.set(itemId, new Map()).get(itemId)!;
    const g = byDay.get(idx) ?? { qty: 0, pegs: new Map<string, number>() };
    g.qty += qty;
    for (const [k, v] of pegs) addTo(g.pegs, k, v);
    byDay.set(idx, g);
  };
  const firmByMonth = new Map<string, number>();                         // item|month -> firm qty in the month
  for (const s of input.sales) {
    if (!items.has(s.itemId)) { exception({ kind: 'unknown_item', severity: 'warn', itemId: s.itemId, data: { item: s.itemCode, order: s.orderCode, line: s.lineNo } }); continue; }
    if (s.openQty <= 0) continue;
    if (s.date < input.today) exception({ kind: 'past_due_demand', severity: 'warn', itemId: s.itemId, date: s.date, data: { order: s.orderCode, line: s.lineNo, qty: s.openQty } });
    const idx = idxOf(s.date);
    addGross(s.itemId, idx, s.openQty, new Map([[pegKey('sales_order', `${s.orderCode}/${s.lineNo}`, s.itemId, s.date < input.today ? input.today : s.date), s.openQty]]));
    addTo(firmByMonth, `${s.itemId}|${s.date.slice(0, 7)}`, s.openQty);
  }
  const fenceEnd = input.frozenDays;                                     // forecast counts only from the day after the fence
  const monthDemand = new Map<string, number>();                         // for the supply plan: item|month -> demand
  for (const s of input.sales) if (items.has(s.itemId) && s.openQty > 0) addTo(monthDemand, `${s.itemId}|${(s.date < input.today ? input.today : s.date).slice(0, 7)}`, s.openQty);
  for (const p of input.demandPlans) {
    if (!items.has(p.itemId)) { exception({ kind: 'unknown_item', severity: 'warn', itemId: p.itemId, data: { item: p.itemCode, plan: p.planCode } }); continue; }
    const left = Math.max(0, p.qty - (firmByMonth.get(`${p.itemId}|${p.period}`) ?? 0));   // firm orders of the month consume the forecast
    if (left === 0) continue;
    const days: number[] = [];
    for (let k = fenceEnd + 1; k < N; k++) if (dateOf(k).slice(0, 7) === p.period && working(k)) days.push(k);
    if (!days.length) continue;
    const base = Math.floor(left / days.length);
    let rest = left - base * days.length;
    for (const k of days) {
      const q = base + (rest > 0 ? 1 : 0);
      if (rest > 0) rest--;
      addGross(p.itemId, k, q, new Map([[pegKey('demand_plan', p.planCode, p.itemId, p.period), q]]));
    }
    addTo(monthDemand, `${p.itemId}|${p.period}`, left);
  }

  // ---------------------------------------------------------------- capacity state (commitments load their lines first)
  const capacityOf = (line: string, idx: number): number => {
    const l = lineOf.get(line);
    if (!l || l.capacityPerShift === null || !working(idx)) return 0;
    return l.capacityPerShift * l.shiftsOn(dateOf(idx)).length;
  };
  const used = new Map<string, Map<number, number>>();
  const useLine = (line: string, idx: number, qty: number) => { const m = used.get(line) ?? used.set(line, new Map()).get(line)!; m.set(idx, (m.get(idx) ?? 0) + qty); };
  for (const c of input.commitments) if (c.lineCode && c.openQty > 0) useLine(c.lineCode, idxOf(c.dueDate), c.openQty);

  // ---------------------------------------------------------------- planning, level by level
  const planned: (PlannedOrder & { dueIdx: number; chunkOf: number })[] = [];
  const reqs = new Map<string, Requisition>();                           // key -> merged requisition
  const reqPegs = new Map<string, Map<string, number>>();
  let roundedUp = 0;
  const unplaced: { line: string; qty: number; dueIdx: number; roots: Set<string> }[] = [];

  const explode = (parentId: string, qty: number, startIdx: number, pegs: Map<string, number>) => {
    const b = bomOf.get(parentId);
    if (!b) return;
    for (const l of b.lines) {
      if (!items.has(l.componentId)) { exception({ kind: 'unknown_item', severity: 'warn', itemId: l.componentId, data: { parent: items.get(parentId)?.code } }); continue; }
      const c = componentQty(qty, l.qtyPer, l.scrapBp);
      if (c.rounded) roundedUp++;
      addGross(l.componentId, startIdx, c.qty, split(pegs, c.qty));
    }
  };

  const pickLine = (itemId: string, dueIdx: number): string | null => {
    const candidates = (input.itemLines.get(itemId) ?? []).filter((c) => lineOf.has(c));
    if (!candidates.length) return null;
    let best = candidates[0]!, bestFree = -Infinity;
    for (const c of candidates) {                                        // the line with the most free capacity in the week before the due day
      let free = 0;
      for (let k = Math.max(0, dueIdx - 6); k <= dueIdx; k++) free += Math.max(0, capacityOf(c, k) - (used.get(c)?.get(k) ?? 0));
      if (free > bestFree) { best = c; bestFree = free; }
    }
    return best;
  };

  for (const lv of levels) {
    const atLevel = input.items.filter((i) => llc.get(i.id) === lv && i.kind === 'product').sort((a, b) => (a.code < b.code ? -1 : 1));
    const makeRequests: Request[] = [];
    for (const item of atLevel) {
      out.stats.items++;
      const hasBom = bomOf.has(item.id);
      // commitments of this item: firmed and released orders still need their components, and they are supply on their due day
      const sched = new Map<number, number>();
      for (const r of input.receipts.filter((r) => r.itemId === item.id).sort((a, b) => (a.date + a.ref < b.date + b.ref ? -1 : 1))) {
        if (r.date < input.today) exception({ kind: 'po_overdue', severity: 'warn', itemId: item.id, date: r.date, data: { ref: r.ref, qty: r.qty } });
        const k = idxOf(r.date);
        if (k < N) sched.set(k, (sched.get(k) ?? 0) + r.qty);
      }
      for (const c of input.commitments.filter((c) => c.itemId === item.id).sort((a, b) => (a.id < b.id ? -1 : 1))) {
        const k = idxOf(c.dueDate);
        if (k < N) sched.set(k, (sched.get(k) ?? 0) + c.openQty);
        explode(item.id, c.openQty, idxOf(c.startDate), commitmentPegs(c));
      }
      if (item.procurement === 'make' && !hasBom && (gross.get(item.id)?.size ?? 0) > 0) exception({ kind: 'no_bom', severity: 'info', itemId: item.id, data: { item: item.code } });

      // time-phased netting
      let poh = input.onHand.get(item.id) ?? 0;
      const byDay = gross.get(item.id) ?? new Map<number, Gross>();
      for (let k = 0; k < N; k++) {
        const g = byDay.get(k);
        const s = sched.get(k) ?? 0;
        const gq = g?.qty ?? 0;
        let proj = poh + s - gq;
        let net = 0, receipt = 0;
        if (proj < item.safetyStock) {
          net = item.safetyStock - proj;
          receipt = lotSize(item, net);
          proj += receipt;
          const covered = Math.min(net, gq);
          const pegs = g ? split(g.pegs, covered) : new Map<string, number>();
          if (net > covered) addTo(pegs, pegKey('safety_stock', 'safety stock', item.id, dateOf(k)), Math.min(net - covered, receipt - covered));
          const excess = receipt - [...pegs.values()].reduce((a, b) => a + b, 0);
          if (excess > 0) addTo(pegs, pegKey('safety_stock', 'lot size', item.id, dateOf(k)), excess);
          if (item.procurement === 'buy') buyReceipt(item, k, receipt, pegs);
          else makeRequests.push({ itemId: item.id, dueIdx: workingOnOrBefore(k), qty: receipt, pegs });
        }
        if (gq || s || receipt) out.records.push({ itemId: item.id, date: dateOf(k), gross: gq, scheduledReceipts: s, projectedOnHand: proj, net, plannedReceipt: receipt });
        poh = proj;
      }
    }

    // make items of this level: load the lines backward, chunk, then explode each chunk into the next levels
    makeRequests.sort((a, b) => (a.dueIdx - b.dueIdx) || (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
    for (const r of makeRequests) {
      const item = items.get(r.itemId)!;
      const lead = item.leadTimeDays > 0 ? item.leadTimeDays : input.defaultMakeLeadDays;
      const line = pickLine(r.itemId, r.dueIdx);
      const limited = line !== null && lineOf.get(line)!.capacityPerShift !== null;
      if (line === null && bomOf.has(r.itemId) && (input.itemLines.get(r.itemId) ?? []).length === 0) exception({ kind: 'no_line', severity: 'info', itemId: r.itemId, data: { item: item.code } });
      const chunks: { dueIdx: number; qty: number }[] = [];
      if (!limited) chunks.push({ dueIdx: r.dueIdx, qty: r.qty });
      else {
        let left = r.qty;
        for (let k = r.dueIdx; k >= 0 && left > 0; k--) {
          const free = capacityOf(line!, k) - (used.get(line!)?.get(k) ?? 0);
          if (free <= 0) continue;
          const put = Math.min(left, free);
          useLine(line!, k, put); chunks.push({ dueIdx: k, qty: put }); left -= put;
        }
        if (left > 0) {                                                  // the line cannot absorb it: plan it on the first working day anyway, and say so
          const k = firstWorkingFromToday();
          useLine(line!, k, left); chunks.push({ dueIdx: k, qty: left });
          unplaced.push({ line: line!, qty: left, dueIdx: r.dueIdx, roots: rootsOf(r.pegs) });
          out.stats.overloadUnits += left;
        }
      }
      const total = chunks.reduce((a, c) => a + c.qty, 0);
      for (const c of chunks.sort((a, b) => a.dueIdx - b.dueIdx)) {
        const back = backWorking(c.dueIdx, lead);
        if (back.truncated) exception({ kind: 'late_start', severity: 'warn', itemId: r.itemId, date: dateOf(c.dueIdx), data: { item: item.code, qty: c.qty, leadDays: lead } });
        const pegs = split(r.pegs, c.qty);
        planned.push({ itemId: r.itemId, qty: c.qty, startDate: dateOf(back.idx), dueDate: dateOf(c.dueIdx), lineCode: line, pegging: toPegs(pegs), dueIdx: c.dueIdx, chunkOf: total });
        explode(r.itemId, c.qty, back.idx, pegs);
      }
    }
  }
  out.stats.roundedUp = roundedUp;

  // the finished item and month a peg ultimately serves (sales order lines and demand plan months only)
  function rootsOf(pegs: Map<string, number>): Set<string> {
    const roots = new Set<string>();
    for (const k of pegs.keys()) {
      const [kind, , rootItem, when] = k.split('|');
      if (kind !== 'safety_stock' && rootItem && when) roots.add(`${rootItem}|${when.slice(0, 7)}`);
    }
    return roots;
  }
  // a firmed or released order's components serve what the order itself serves (its pegs), rooted at the order's own item and due month
  function commitmentPegs(c: Commitment): Map<string, number> {
    const weights = new Map<string, number>();
    for (const p of c.pegs ?? []) addTo(weights, pegKey(p.kind, p.reference, c.itemId, c.dueDate), p.qty);
    if (!weights.size) weights.set(pegKey('demand_plan', 'firmed order', c.itemId, c.dueDate), c.openQty);
    return split(weights, c.openQty);
  }
  function lotSize(item: PlanItem, net: number): number {
    let q = Math.max(net, item.moq);
    if ((item.lotRule === 'fixed' || item.lotRule === 'multiple') && item.lotSize > 0) q = Math.ceil(q / item.lotSize) * item.lotSize;
    return q;
  }
  function buyReceipt(item: PlanItem, idx: number, qty: number, pegs: Map<string, number>) {
    const need = dateOf(idx);
    const orderBy = addDays(need, -item.leadTimeDays);
    const key = `${item.id}|${isoWeek(need)}`;
    const cur = reqs.get(key);
    const ob = orderBy < input.today;
    const expedite = item.expediteLeadTimeDays !== null && addDays(need, -item.expediteLeadTimeDays) >= input.today;
    if (cur) {
      cur.qty += qty;
      if (need < cur.needDate) { cur.needDate = need; cur.orderByDate = orderBy; }
      cur.pastDue = cur.orderByDate < input.today;
      cur.expediteWouldMeetNeed = item.expediteLeadTimeDays !== null && addDays(cur.needDate, -item.expediteLeadTimeDays) >= input.today;
      for (const [k, v] of pegs) addTo(reqPegs.get(key)!, k, v);
    } else {
      reqs.set(key, { key, itemId: item.id, qty, needDate: need, orderByDate: orderBy, pegging: [], expediteWouldMeetNeed: expedite, pastDue: ob });
      reqPegs.set(key, new Map(pegs));
    }
  }

  // ---------------------------------------------------------------- requisitions
  const blockedRoots = new Set<string>();                                // item|month of demand that a past-due purchase without a way out endangers
  for (const [key, r] of [...reqs].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    r.pegging = toPegs(reqPegs.get(key)!);
    out.requisitions.push(r);
    if (r.pastDue) {
      exception({ kind: 'past_due_order', severity: r.expediteWouldMeetNeed ? 'warn' : 'error', itemId: r.itemId, date: r.orderByDate, data: { item: items.get(r.itemId)?.code, needDate: r.needDate, orderBy: r.orderByDate, expediteWouldMeetNeed: r.expediteWouldMeetNeed } });
      if (!r.expediteWouldMeetNeed) for (const root of rootsOf(reqPegs.get(key)!)) blockedRoots.add(root);
    }
  }
  out.stats.requisitions = out.requisitions.length;

  // ---------------------------------------------------------------- capacity: what was loaded, what could not be, and what to do about it
  planned.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : a.startDate < b.startDate ? -1 : 1));
  out.plannedOrders = planned.map(({ dueIdx: _d, chunkOf: _c, ...p }) => p);
  out.stats.plannedOrders = out.plannedOrders.length;
  for (const l of [...input.lines].sort((a, b) => (a.code < b.code ? -1 : 1))) {
    for (let k = 0; k < N; k++) {
      const u = used.get(l.code)?.get(k) ?? 0;
      if (u > 0 || (l.capacityPerShift !== null && working(k) && k < 14)) out.load.push({ line: l.code, date: dateOf(k), loaded: u, capacity: capacityOf(l.code, k) });
    }
  }
  const byLine = new Map<string, { qty: number; latest: number }>();
  for (const u of unplaced) { const c = byLine.get(u.line) ?? { qty: 0, latest: 0 }; c.qty += u.qty; c.latest = Math.max(c.latest, u.dueIdx); byLine.set(u.line, c); }
  for (const [line, c] of [...byLine].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const l = lineOf.get(line)!;
    const per = l.capacityPerShift!;
    const need = Number(ceilDiv(BigInt(c.qty), BigInt(per)));
    const days: number[] = [];
    for (let k = c.latest; k >= 0 && days.length < need; k--) if (working(k)) days.push(k);
    days.sort((a, b) => a - b);
    const next = input.shiftOrder[l.shiftsOn(dateOf(days[0] ?? 0)).length] ?? input.shiftOrder[input.shiftOrder.length - 1] ?? 'C';
    const proposal: Proposal | null = days.length ? { line, shift: next, from: dateOf(days[0]!), to: dateOf(days[days.length - 1]!), days: days.length, addedCapacity: days.length * per } : null;
    if (proposal) out.proposals.push(proposal);
    exception({ kind: 'capacity_overload', severity: 'error', line, data: { line, unplacedQty: c.qty, proposal } });
  }

  // ---------------------------------------------------------------- crew
  for (const l of [...input.lines].sort((a, b) => (a.code < b.code ? -1 : 1))) {
    if (l.capacityPerShift === null) continue;
    const perStation = l.stations.reduce((a, s) => a + s.crew, 0);
    for (let k = 0; k < N; k++) {
      const u = used.get(l.code)?.get(k) ?? 0;
      if (u <= 0 || !working(k)) continue;
      const shifts = l.shiftsOn(dateOf(k));
      const runs = Math.min(shifts.length, Math.max(1, Math.ceil(u / l.capacityPerShift)));
      const skills = new Map<string, number>();
      for (const s of l.stations) for (const r of s.requirements) addTo(skills, `${r.skill}|${r.level}`, s.crew);
      for (let s = 0; s < runs; s++) {
        out.crew.push({
          line: l.code, shift: shifts[s]!, date: dateOf(k), headcount: l.crew + perStation,
          skills: [...skills].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([key, count]) => { const [skill, lvl] = key.split('|'); return { skill: skill!, level: Number(lvl), count }; }),
        });
      }
    }
  }

  // ---------------------------------------------------------------- supply plan: per finished item and month
  const plannedByMonth = new Map<string, number>();
  for (const p of out.plannedOrders) if (items.get(p.itemId) && !parentsOf.has(p.itemId)) addTo(plannedByMonth, `${p.itemId}|${p.dueDate.slice(0, 7)}`, p.qty);
  for (const c of input.commitments) if (!parentsOf.has(c.itemId)) addTo(plannedByMonth, `${c.itemId}|${c.dueDate.slice(0, 7)}`, c.openQty);
  const capRoots = new Set<string>();                                    // finished item|month whose line could not absorb the load
  for (const u of unplaced) for (const root of u.roots) capRoots.add(root);
  const keys = [...new Set([...monthDemand.keys(), ...plannedByMonth.keys()])].sort();
  for (const k of keys) {
    const [itemId, period] = k.split('|') as [string, string];
    if (parentsOf.has(itemId)) continue;                                 // finished items only
    const cap = capRoots.has(k);
    const mat = blockedRoots.has(k);
    out.supplyPlan.push({ itemId, period, demandQty: monthDemand.get(k) ?? 0, plannedQty: plannedByMonth.get(k) ?? 0, constraint: cap && mat ? 'both' : cap ? 'capacity' : mat ? 'material' : 'none' });
  }
  out.records.sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : a.date < b.date ? -1 : 1));
  out.exceptions.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : (a.itemId ?? '') < (b.itemId ?? '') ? -1 : (a.itemId ?? '') > (b.itemId ?? '') ? 1 : (a.date ?? '') < (b.date ?? '') ? -1 : 1));
  return out;
}
