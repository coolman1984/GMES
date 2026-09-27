import { createHash } from 'node:crypto';
import {
  formatQty, mizanId, parseQty, sourceOf, uuidv7, validateEvent,
  type AckV1, type Envelope, type ItemV1, type MaterialConsumedV1, type ProductionCompletedV1, type WarehouseV1, type WorkOrderClosedV1,
} from '@eco/contracts';
import { randomBytes } from 'node:crypto';
import { BusinessError, TransientError } from './errors.js';
import type { MesClient } from './mes.js';
import type { MizanAccount, MizanClient } from './mizan.js';
import type { LinkState } from './state.js';

/**
 * link-mizan: Mizan's agent in the ecosystem, until Mizan grows a native eco module.
 *
 *  Mizan ──(items, warehouses: owner snapshots)──► manufacturing inbox
 *  manufacturing feed ──(consumed / completed / scrapped / closed)──► Mizan stock documents & journal
 *
 * Accounting keeps the truth about VALUE: consumption is issued at Mizan's own average cost, and a
 * completion is received at the work-in-progress value Mizan booked for that order (ADR-019).
 * Every document it writes carries `eco:<event id>` as its reference, so a crash, a retry or a lost
 * state file can never post anything twice.
 */
export interface LinkConfig {
  companyId: string;
  consumer: string;
  accounts: { wip: string; variance: string };
  /** Test hook: simulate a crash right after Mizan accepted a document, before the link recorded it. */
  faults?: { afterMizanPost?: (eventId: string) => void; beforeMizanPost?: (eventId: string) => void };
}

export interface CycleReport {
  mirrored: { items: number; warehouses: number; sent: number };
  applied: number;
  parked: number;
  skipped: number;
  retriedOk: number;
  cursor: number;
  stoppedBy?: string;
}

const REF = (id: string) => `eco:${id}`;

export class Link {
  private itemsByGlobal = new Map<string, number>();
  private whByGlobal = new Map<string, number>();
  private acc?: { wip: number; variance: number };
  readonly source: string;

  constructor(
    private readonly cfg: LinkConfig,
    private readonly mizan: MizanClient,
    private readonly mes: MesClient,
    private readonly state: LinkState,
  ) {
    this.source = sourceOf(cfg.companyId, 'mizan', cfg.consumer);
  }

  /** One pass: mirror master data, retry parked events, consume the feed, flush acks. */
  async runOnce(): Promise<CycleReport> {
    const report: CycleReport = { mirrored: { items: 0, warehouses: 0, sent: 0 }, applied: 0, parked: 0, skipped: 0, retriedOk: 0, cursor: this.state.cursor };
    try {
      await this.checkAccounts();
      report.mirrored = await this.mirrorMasterData();
      report.retriedOk = await this.retryParked(report);
      await this.consumeFeed(report);
    } catch (err) {
      if (!(err instanceof TransientError)) throw err;
      report.stoppedBy = err.message;
    }
    try {
      await this.flushAcks();
    } catch (err) {
      if (!(err instanceof TransientError)) throw err;
      report.stoppedBy ??= err.message;
    }
    report.cursor = this.state.cursor;
    return report;
  }

  // ------------------------------------------------------------------ setup checks

  private async checkAccounts() {
    if (this.acc) return;
    const all = await this.mizan.accounts();
    const find = (code: string) => all.find((a) => a.code === code);
    const wip = find(this.cfg.accounts.wip);
    const variance = find(this.cfg.accounts.variance);
    const problems: string[] = [];
    const check = (a: MizanAccount | undefined, code: string, type: string) => {
      if (!a) problems.push(`account ${code} does not exist in Mizan`);
      else if (a.type !== type || a.is_group || !a.is_active) problems.push(`account ${code} must be an active, postable ${type} account`);
    };
    check(wip, this.cfg.accounts.wip, 'asset');
    check(variance, this.cfg.accounts.variance, 'expense');
    // LESSONS: an `inventory` subtype would make Mizan's valuation health check fail, because work in
    // progress is not stock Mizan can count.
    if (wip && wip.subtype === 'inventory') problems.push(`account ${wip.code} must not have the subtype "inventory" (use current_asset): Mizan checks inventory accounts against its stock valuation`);
    if (problems.length) throw new Error('link-mizan cannot start: ' + problems.join('; '));
    this.acc = { wip: wip!.id, variance: variance!.id };
  }

  // ------------------------------------------------------------------ master data: Mizan -> manufacturing

  private async mirrorMasterData() {
    const [items, whs] = await Promise.all([this.mizan.items(), this.mizan.warehouses()]);
    const events: Envelope[] = [];
    this.itemsByGlobal.clear();
    this.whByGlobal.clear();
    for (const i of items) {
      const id = mizanId(this.cfg.companyId, 'item', i.id);
      this.itemsByGlobal.set(id, i.id);
      const body = {
        id, code: i.sku, name: { en: i.name_en, ar: i.name_ar }, active: !!i.is_active, origin: { app: 'mizan', type: 'item', key: String(i.id) },
        kind: i.kind, stock_tracked: i.kind === 'product' && !!i.track_stock, tracking: i.tracking === 'batch' ? 'lot' : i.tracking,
        base_uom: (i.unit ?? 'UNIT').trim().toUpperCase().slice(0, 64) || 'UNIT', units: [],
      } satisfies Omit<ItemV1, 'version'>;
      const ev = this.snapshot('eco.item.v1', 'item', body);
      if (ev) events.push(ev);
    }
    for (const w of whs) {
      const id = mizanId(this.cfg.companyId, 'warehouse', w.id);
      this.whByGlobal.set(id, w.id);
      const body = {
        id, code: w.code, name: { en: w.name_en, ar: w.name_ar }, active: !!w.is_active, is_default: !!w.is_default,
        origin: { app: 'mizan', type: 'warehouse', key: String(w.id) },
      } satisfies Omit<WarehouseV1, 'version'>;
      const ev = this.snapshot('eco.warehouse.v1', 'warehouse', body);
      if (ev) events.push(ev);
    }
    let sent = 0;
    for (let i = 0; i < events.length; i += 200) {
      const chunk = events.slice(i, i + 200);
      const r = await this.mes.inbox(chunk);
      const refused = r.results.filter((x) => !['applied', 'unchanged', 'stale', 'duplicate'].includes(x.result));
      if (refused.length) throw new Error(`manufacturing refused master data: ${JSON.stringify(refused.slice(0, 3))}`);
      // Remember what was delivered only after manufacturing accepted it.
      this.state.tx(() => {
        for (const e of chunk) {
          const d = e.data as { id: string; version: number };
          this.state.db.prepare('INSERT INTO master (entity_id, hash, version) VALUES (?, ?, ?) ON CONFLICT(entity_id) DO UPDATE SET hash = excluded.hash, version = excluded.version')
            .run(d.id, fingerprint(d), d.version);
        }
      });
      sent += chunk.length;
    }
    return { items: items.length, warehouses: whs.length, sent };
  }

  /** An owner snapshot when the content changed since the last delivery; the version only ever goes up. */
  private snapshot(type: 'eco.item.v1' | 'eco.warehouse.v1', kind: string, body: Record<string, unknown> & { id: string }): Envelope | null {
    const prev = this.state.db.prepare('SELECT hash, version FROM master WHERE entity_id = ?').get(body.id) as { hash: string; version: number } | undefined;
    const hash = fingerprint(body);
    if (prev && prev.hash === hash) return null;
    // Mizan has no per-row version, so the link issues one: never below the last one it sent, and
    // time-based, so a link that lost its state still sends a HIGHER version than before.
    const version = Math.max((prev?.version ?? 0) + 1, Date.now());
    const now = new Date();
    return {
      specversion: '1.0', id: uuidv7(now.getTime(), randomBytes(10)), source: this.source, type, subject: `${kind}/${body.id}`,
      time: now.toISOString(), datacontenttype: 'application/json', ecoseq: version, ecocorrelation: `${kind}/${body.id}`, data: { ...body, version },
    };
  }

  // ------------------------------------------------------------------ facts: manufacturing -> Mizan

  private async consumeFeed(report: CycleReport) {
    for (;;) {
      const page = await this.mes.feed(this.state.cursor, 100);
      if (page.events.length === 0) return;
      for (const raw of page.events) {
        const v = validateEvent(raw);
        const env = raw as Envelope;
        if (!v.ok) {
          // A producer bug: park it visibly rather than skipping a fact.
          this.park(env, 'contract.invalid', v.message);
          report.parked++;
          this.state.tx(() => this.state.setCursor(env.ecoseq));
          continue;
        }
        const held = this.state.heldCorrelations();
        if (held.has(env.ecocorrelation)) {
          const first = this.state.parked().find((p) => p.correlation === env.ecocorrelation)!;
          this.park(env, 'eco.held_behind', `waits for event ${first.event_id} (${first.code}) of the same work order`);
          report.parked++;
          this.state.tx(() => this.state.setCursor(env.ecoseq));
          continue;
        }
        const outcome = await this.applyOne(env);
        if (outcome === 'parked') report.parked++;
        else if (outcome === 'skipped') report.skipped++;
        else report.applied++;
      }
    }
  }

  private async retryParked(report: CycleReport): Promise<number> {
    let ok = 0;
    const blocked = new Set<string>();
    for (const p of this.state.parked()) {
      if (blocked.has(p.correlation)) continue;
      const env = JSON.parse(p.envelope) as Envelope;
      if (!validateEvent(env).ok) {
        blocked.add(p.correlation);
        continue;
      }
      const outcome = await this.applyOne(env, true);
      if (outcome === 'parked') blocked.add(p.correlation);
      else {
        ok++;
        if (outcome === 'applied') report.applied++;
        else report.skipped++;
      }
    }
    return ok;
  }

  /** Apply one event exactly once. Returns what happened; throws TransientError when Mizan is unreachable. */
  private async applyOne(env: Envelope, retry = false): Promise<'applied' | 'parked' | 'skipped'> {
    if (this.state.isDone(env.id)) {
      this.state.tx(() => {
        this.state.db.prepare('DELETE FROM parked WHERE event_id = ?').run(env.id);
        if (!retry) this.state.setCursor(Math.max(this.state.cursor, env.ecoseq));
      });
      return 'skipped';
    }
    try {
      const r = await this.dispatch(env);
      this.state.tx(() => {
        this.state.db.prepare('INSERT INTO applied (event_id, seq, type, status, target_ref, value, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(env.id, env.ecoseq, env.type, r.status, r.targetRef ?? null, r.value ?? 0, new Date().toISOString());
        if (r.wip) this.state.addWip(r.wip.workOrderId, r.wip.consumed, r.wip.relieved);
        this.state.db.prepare('DELETE FROM parked WHERE event_id = ?').run(env.id);
        if (!retry) this.state.setCursor(Math.max(this.state.cursor, env.ecoseq));
        this.queueAck({ event_id: env.id, consumer: this.cfg.consumer, status: r.status, detail: r.detail });
      });
      return r.status;
    } catch (err) {
      if (!(err instanceof BusinessError)) throw err;
      this.park(env, err.code, err.message);
      if (!retry) this.state.tx(() => this.state.setCursor(Math.max(this.state.cursor, env.ecoseq)));
      return 'parked';
    }
  }

  private park(env: Envelope, code: string, message: string) {
    this.state.tx(() => {
      this.state.db.prepare(
        `INSERT INTO parked (event_id, seq, correlation, envelope, code, message, attempts, last_try) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT(event_id) DO UPDATE SET code = excluded.code, message = excluded.message, attempts = attempts + 1, last_try = excluded.last_try`,
      ).run(env.id, env.ecoseq ?? 0, env.ecocorrelation ?? 'unknown', JSON.stringify(env), code, message.slice(0, 1000), new Date().toISOString());
      if (env.id) this.queueAck({ event_id: env.id, consumer: this.cfg.consumer, status: 'parked', detail: { code, message: message.slice(0, 1000) } });
    });
  }

  private queueAck(ack: AckV1) {
    this.state.db.prepare('INSERT INTO pending_acks (event_id, ack) VALUES (?, ?) ON CONFLICT(event_id) DO UPDATE SET ack = excluded.ack').run(ack.event_id, JSON.stringify(ack));
  }

  private async flushAcks() {
    const rows = this.state.db.prepare('SELECT event_id, ack FROM pending_acks LIMIT 500').all() as { event_id: string; ack: string }[];
    if (!rows.length) return;
    await this.mes.acks(rows.map((r) => JSON.parse(r.ack)));
    this.state.tx(() => {
      for (const r of rows) this.state.db.prepare('DELETE FROM pending_acks WHERE event_id = ? AND ack = ?').run(r.event_id, r.ack);
    });
  }

  private async dispatch(env: Envelope): Promise<Result> {
    switch (env.type) {
      case 'mes.material.consumed.v1':
        return this.consumed(env as Envelope<MaterialConsumedV1>);
      case 'mes.production.completed.v1':
        return this.completed(env as Envelope<ProductionCompletedV1>);
      case 'mes.production.scrapped.v1':
        return { status: 'skipped', detail: { code: 'eco.absorbed', message: 'Normal scrap is absorbed by the good output of the order (ADR-019); nothing is posted.' } };
      case 'mes.work_order.closed.v1':
        return this.closed(env as Envelope<WorkOrderClosedV1>);
      default:
        return { status: 'skipped', detail: { code: 'eco.not_consumed', message: `link-mizan does not consume ${env.type}` } };
    }
  }

  private localItem(id: string, code: string) {
    const local = this.itemsByGlobal.get(id);
    if (local === undefined) throw new BusinessError('link.unknown_item', `item ${code} (${id}) does not exist in Mizan`);
    return local;
  }
  private localWarehouse(id: string, code: string) {
    const local = this.whByGlobal.get(id);
    if (local === undefined) throw new BusinessError('link.unknown_warehouse', `warehouse ${code} (${id}) does not exist in Mizan`);
    return local;
  }

  /** Issue to production: stock out at Mizan's average cost; debit work in progress. */
  private async consumed(env: Envelope<MaterialConsumedV1>): Promise<Result> {
    const d = env.data;
    const itemId = this.localItem(d.item.id, d.item.code);
    const warehouseId = this.localWarehouse(d.warehouse.id, d.warehouse.code);
    const doc = await this.findOrPost(env.id, () =>
      this.mizan.ok<{ id: number }>('POST', '/inventory/operations', {
        kind: 'adjustment', date: d.production_date, warehouseId, counterAccountId: this.acc!.wip, reference: REF(env.id), post: true,
        memo: `GMES ${d.work_order.code}: consumed ${d.qty} ${d.uom} ${d.item.code} (ledger #${d.ledger_seq}, ${d.performed_by.user})`,
        lines: [{ itemId, qty: -parseQty(d.qty), ...(d.lot_no ? { lots: [{ lotNo: d.lot_no, qty: parseQty(d.qty) }] } : {}) }],
      }),
    );
    const op = await this.mizan.operation(doc.id);
    const value = -op.lines.reduce((s, l) => s + l.value, 0);
    return {
      status: 'applied', targetRef: op.number, value, wip: { workOrderId: d.work_order.id, consumed: value, relieved: 0 },
      detail: { target_ref: op.number, figures: { value_minor: String(value) } },
    };
  }

  /** Receipt from production: finished goods in, valued at the order's share of work in progress. */
  private async completed(env: Envelope<ProductionCompletedV1>): Promise<Result> {
    const d = env.data;
    const itemId = this.localItem(d.item.id, d.item.code);
    const warehouseId = this.localWarehouse(d.warehouse.id, d.warehouse.code);
    const qty = parseQty(d.qty);
    const planned = parseQty(d.work_order.planned_qty);
    const completedBefore = parseQty(d.work_order.completed_qty_after) - qty;
    const scrapped = parseQty(d.work_order.scrapped_qty);
    const w = this.state.wip(d.work_order.id);
    const open = w.consumed - w.relieved;
    const remaining = planned - completedBefore - scrapped;
    // On the final completion `remaining` equals `qty`, so the share IS the whole remainder; the
    // explicit branch states the rule ("the last unit takes what is left") rather than relying on it.
    const target = d.work_order.is_final ? open : Math.round((open * qty) / remaining);
    // Mizan prices a stock line per whole unit in minor units; value = qty/1000 × unitCost.
    const unitCost = Math.max(0, Math.round((target * 1000) / qty));
    const doc = await this.findOrPost(env.id, () =>
      this.mizan.ok<{ id: number }>('POST', '/inventory/operations', {
        kind: 'adjustment', date: d.production_date, warehouseId, counterAccountId: this.acc!.wip, reference: REF(env.id), post: true,
        memo: `GMES ${d.work_order.code}: completed ${d.qty} ${d.uom} ${d.item.code}${d.work_order.is_final ? ' (final)' : ''} (ledger #${d.ledger_seq})`,
        lines: [{ itemId, qty, unitCost, ...(d.lot_no ? { lots: [{ lotNo: d.lot_no, qty }] } : {}) }],
      }),
    );
    const op = await this.mizan.operation(doc.id);
    const value = op.lines.reduce((s, l) => s + l.value, 0);
    const figures: Record<string, string> = { value_minor: String(value), target_minor: String(target) };
    if (d.work_order.is_final) figures.wip_left_minor = String(open - value);
    return { status: 'applied', targetRef: op.number, value, wip: { workOrderId: d.work_order.id, consumed: 0, relieved: value }, detail: { target_ref: op.number, figures } };
  }

  /** Closing an order sends whatever is left in its work in progress (rounding, late scrap) to the variance account. */
  private async closed(env: Envelope<WorkOrderClosedV1>): Promise<Result> {
    const d = env.data;
    const w = this.state.wip(d.work_order.id);
    const left = w.consumed - w.relieved;
    const existing = await this.mizan.journalByReference(REF(env.id));
    if (!existing && left === 0) return { status: 'skipped', detail: { code: 'eco.nothing_left', message: 'Work in progress of this order is already zero.' } };
    let je = existing;
    if (!je) {
      const amount = Math.abs(left);
      const lines = left > 0
        ? [{ accountId: this.acc!.variance, debit: amount, description: `GMES ${d.work_order.code} variance` }, { accountId: this.acc!.wip, credit: amount }]
        : [{ accountId: this.acc!.wip, debit: amount }, { accountId: this.acc!.variance, credit: amount, description: `GMES ${d.work_order.code} variance` }];
      const { id } = await this.mizan.ok<{ id: number }>('POST', '/journal', {
        date: d.production_date, reference: REF(env.id), memo: `GMES ${d.work_order.code} closed: work in progress left ${left}`, lines, post: true,
      });
      this.cfg.faults?.afterMizanPost?.(env.id);
      je = { id, number: (await this.mizan.journal(id)).number };
    }
    const full = await this.mizan.journal(je.id);
    const wipLine = full.lines.find((l) => l.account_id === this.acc!.wip)!;
    const relieved = wipLine.credit - wipLine.debit;
    return { status: 'applied', targetRef: full.number, value: relieved, wip: { workOrderId: d.work_order.id, consumed: 0, relieved }, detail: { target_ref: full.number, figures: { variance_minor: String(relieved) } } };
  }

  /** Post once: look for a document carrying this event's reference first (crash recovery). */
  private async findOrPost(eventId: string, post: () => Promise<{ id: number }>): Promise<{ id: number }> {
    const found = await this.mizan.operationByReference(REF(eventId));
    if (found) return found;
    this.cfg.faults?.beforeMizanPost?.(eventId);
    const doc = await post();
    this.cfg.faults?.afterMizanPost?.(eventId);
    return doc;
  }
}

interface Result {
  status: 'applied' | 'skipped';
  targetRef?: string;
  value?: number;
  wip?: { workOrderId: string; consumed: number; relieved: number };
  detail: AckV1['detail'];
}

/** Content fingerprint with sorted keys at every depth (a replacer array would silently drop nested keys). */
function fingerprint(v: Record<string, unknown>): string {
  const { version: _v, ...rest } = v;
  return createHash('sha256').update(stable(rest)).digest('hex');
}

function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}';
}

export { formatQty };
