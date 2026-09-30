import { z } from 'zod';
import { formatQty, parseQty, type GoodsReceiptV1 } from '@eco/contracts';
import type { SnapshotResult } from '../../contracts/services.js';
import type { Db } from '../../kernel/db.js';
import { AppError, conflict, fail, notFound } from '../../kernel/errors.js';
import type { Ctx, RouteKit } from '../../kernel/modules.js';

/**
 * Receiving and incoming inspection (plan 20-GMES WP-G4, flow F5).
 *
 * Accounting posts the goods receipt and publishes acc.goods_receipt.v1; each received lot becomes a material lot here,
 * `pending_iqc` when an active IQC plan covers the item, else `accepted`. Quality decides (accepted, rejected,
 * partially accepted, on hold, released) and publishes mes.lot_decision.v1 so accounting moves the stock. A lot that is
 * not released can never be loaded on a station.
 */
export const receivingMigration = {
  id: '003_receiving',
  up: `
    ALTER TABLE trk_material_lot ADD COLUMN status TEXT NOT NULL DEFAULT 'accepted'
      CHECK (status IN ('pending_iqc', 'accepted', 'rejected', 'partially_accepted', 'on_hold', 'voided'));
    ALTER TABLE trk_material_lot ADD COLUMN goods_receipt_id TEXT;
    ALTER TABLE trk_material_lot ADD COLUMN goods_receipt_code TEXT;
    ALTER TABLE trk_material_lot ADD COLUMN supplier_id TEXT;
    ALTER TABLE trk_material_lot ADD COLUMN accepted_qty INTEGER;
    ALTER TABLE trk_material_lot ADD COLUMN rejected_qty INTEGER;
    ALTER TABLE trk_material_lot ADD COLUMN decided_at TEXT;
    ALTER TABLE trk_material_lot ADD COLUMN decided_by TEXT;
    ALTER TABLE trk_material_lot ADD COLUMN decisions INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE trk_goods_receipt (id TEXT PRIMARY KEY, code TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL, applied_at TEXT NOT NULL);
  `,
};

/** Statuses from which a lot may be loaded on a station. */
export const USABLE = new Set(['accepted', 'partially_accepted']);

const lotOf = (gr: GoodsReceiptV1, l: GoodsReceiptV1['lines'][number]) => (l.lot_no ?? `${gr.code}-${l.line_no}`).trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '-').slice(0, 64);

export async function applyGoodsReceipt(ctx: Ctx, t: Db, gr: GoodsReceiptV1): Promise<SnapshotResult> {
  const prev = await t.get<{ version: number }>('SELECT version FROM trk_goods_receipt WHERE id = ?', [gr.id]);
  if (prev && gr.version < prev.version) return 'stale';
  if (prev && gr.version === prev.version) return 'unchanged';
  const now = ctx.clock.now().toISOString();
  for (const l of gr.lines) {
    const lot = lotOf(gr, l);
    const known = await t.get<{ status: string; goods_receipt_id: string | null }>('SELECT status, goods_receipt_id FROM trk_material_lot WHERE item_id = ? AND lot_no = ?', [l.item.id, lot]);
    if (gr.status === 'voided') {
      if (!known || known.goods_receipt_id !== gr.id) continue;
      const used = await t.get('SELECT 1 FROM trk_load WHERE item_id = ? AND lot_no = ? UNION SELECT 1 FROM trk_genealogy WHERE item_id = ? AND lot_no = ?', [l.item.id, lot, l.item.id, lot]);
      if (used) throw new AppError(409, 'trk.lot_in_use', `lot ${lot} of ${l.item.code} was already used in production: the receipt cannot be voided here`);
      await t.run("UPDATE trk_material_lot SET status = 'voided' WHERE item_id = ? AND lot_no = ?", [l.item.id, lot]);
      continue;
    }
    if (known) continue;                                                          // a newer version of the same receipt: lots already there
    const iqc = await t.get("SELECT 1 FROM qms_plan WHERE stage = 'iqc' AND active = 1 AND (item_id = ? OR item_id IS NULL)", [l.item.id]).catch(() => undefined);
    await t.run(`INSERT INTO trk_material_lot (item_id, lot_no, supplier, supplier_lot, qty, expires_on, received_at, received_by, status, goods_receipt_id, goods_receipt_code, supplier_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [l.item.id, lot, gr.supplier.code, l.supplier_lot ?? null, parseQty(l.qty), l.expiry ?? null, now, 'accounting', iqc ? 'pending_iqc' : 'accepted', gr.id, gr.code, gr.supplier.id]);
    await t.run('UPDATE trk_load SET verified = 1 WHERE item_id = ? AND lot_no = ?', [l.item.id, lot]);
  }
  await t.run('INSERT INTO trk_goods_receipt (id, code, version, status, applied_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET version = excluded.version, status = excluded.status, applied_at = excluded.applied_at',
    [gr.id, gr.code, gr.version, gr.status, now]);
  return 'applied';
}

const zQty = z.string().regex(/^(0|[1-9]\d*)(\.\d{1,3})?$/);

export function receivingRoutes({ http, require }: RouteKit, ctx: Ctx) {
  // QMS2040: the lots waiting for incoming inspection, and the decided ones
  http.get('/api/qms/incoming-lots', async (req) => {
    require(req, 'qms.read');
    const q = z.object({ status: z.string().optional() }).parse(req.query);
    const rows = await ctx.db.all<any>(`SELECT m.*, i.code item_code, i.name_en, i.name_ar, i.base_uom FROM trk_material_lot m JOIN mdm_item i ON i.id = m.item_id
      WHERE m.goods_receipt_id IS NOT NULL ${q.status ? 'AND m.status = ?' : ''} ORDER BY (m.status = 'pending_iqc') DESC, m.received_at DESC LIMIT 2000`, q.status ? [q.status] : []);
    return rows.map((r) => ({ ...r, qty: formatQty(r.qty), accepted_qty: r.accepted_qty === null ? null : formatQty(r.accepted_qty), rejected_qty: r.rejected_qty === null ? null : formatQty(r.rejected_qty) }));
  });

  http.post('/api/qms/incoming-lots/decision', async (req) => {
    const caller = require(req, 'qms.release');
    const input = z.object({
      itemId: z.string(), lotNo: z.string().trim().toUpperCase(), decision: z.enum(['accepted', 'rejected', 'partially_accepted', 'on_hold', 'released']),
      acceptedQty: zQty.optional(), rejectedQty: zQty.optional(), defectCodes: z.array(z.string().trim().min(1).max(64)).max(50).default([]),
      inspection: z.object({ planCode: z.string().min(1).max(64), aql: z.string().min(1).max(20), sampleSize: z.number().int().min(0), defects: z.number().int().min(0) }).optional(),
    }).parse(req.body);
    return ctx.db.tx(async (t) => {
      const lot = (await t.get<{ item_id: string; lot_no: string; qty: number; status: string; goods_receipt_id: string | null; goods_receipt_code: string | null; supplier_id: string | null; supplier: string | null; decisions: number }>(
        'SELECT * FROM trk_material_lot WHERE item_id = ? AND lot_no = ?', [input.itemId, input.lotNo])) ?? notFound('material_lot', input.lotNo);
      if (lot.status === 'voided') conflict('lot.voided', `lot ${lot.lot_no} was voided by accounting`);
      if (input.decision === 'released' && lot.status !== 'on_hold') conflict('lot.not_held', `lot ${lot.lot_no} is not on hold`);
      const item = await ctx.services.get('mdm').item(lot.item_id, t);
      let accepted = lot.qty, rejected = 0;
      if (input.decision === 'rejected') (accepted = 0), (rejected = lot.qty);
      if (input.decision === 'on_hold') (accepted = 0), (rejected = 0);
      if (input.decision === 'partially_accepted') {
        if (!input.acceptedQty || !input.rejectedQty) fail('lot.split_required', 'say how much is accepted and how much is rejected');
        accepted = parseQty(input.acceptedQty!); rejected = parseQty(input.rejectedQty!);
        if (accepted + rejected !== lot.qty) fail('lot.split_sum', `accepted + rejected must be the lot quantity ${formatQty(lot.qty)}`);
      }
      if (input.decision === 'rejected' || input.decision === 'partially_accepted') if (!input.defectCodes.length) fail('lot.defect_required', 'a rejection names at least one defect');
      for (const d of input.defectCodes) await ctx.services.get('qms').checkDefect(t, d);
      const status = input.decision === 'released' ? 'accepted' : input.decision;
      const now = ctx.clock.now().toISOString();
      await t.run('UPDATE trk_material_lot SET status = ?, accepted_qty = ?, rejected_qty = ?, decided_at = ?, decided_by = ?, decisions = decisions + 1 WHERE item_id = ? AND lot_no = ?',
        [status, accepted, rejected, now, caller.name, lot.item_id, lot.lot_no]);
      const id = ctx.clock.newId();
      const code = `LD-${lot.lot_no}-${lot.decisions + 1}`.slice(0, 64);
      const ev = await ctx.services.get('eco').publish(t, {
        type: 'mes.lot_decision.v1', subject: `material_lot/${lot.item_id}/${lot.lot_no}`, correlation: lot.goods_receipt_id ? `goods_receipt/${lot.goods_receipt_id}` : `material_lot/${lot.lot_no}`,
        data: {
          id, code, version: 1, origin: { app: 'gmes', type: 'lot_decision', key: code }, item: { id: item.id, code: item.code }, lot_no: lot.lot_no,
          ...(lot.goods_receipt_id && lot.goods_receipt_code ? { goods_receipt: { id: lot.goods_receipt_id, code: lot.goods_receipt_code } } : {}),
          ...(lot.supplier_id && lot.supplier ? { supplier: { id: lot.supplier_id, code: lot.supplier } } : {}),
          decision: input.decision, accepted_qty: formatQty(accepted), rejected_qty: formatQty(rejected), uom: item.base_uom,
          ...(input.inspection ? { inspection: { plan_code: input.inspection.planCode, aql: input.inspection.aql, sample_size: input.inspection.sampleSize, defects: input.inspection.defects } } : {}),
          defect_codes: input.defectCodes, decided_at: now, decided_by: { user: caller.name },
        },
      });
      await ctx.services.get('sys').audit(t, caller.name, 'lot.decision', `${item.code}/${lot.lot_no}`, input);
      return { lotNo: lot.lot_no, status, eventId: ev.id };
    });
  });
}
