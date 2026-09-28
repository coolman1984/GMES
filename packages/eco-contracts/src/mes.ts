import { z } from 'zod';
import { zCode, zDate, zPerformedBy, zPositiveDecimal, zRef, zUuid } from './common.js';

/**
 * Operational facts published by manufacturing. They say what HAPPENED, never what another
 * system must do: accounting decides how (and at what value) to reflect them in its books.
 */
const zWorkOrderRef = z.object({
  id: zUuid,
  code: zCode,
  item: zRef,
  planned_qty: zPositiveDecimal,
});

const operational = {
  production_date: zDate,
  shift: zCode.optional(),
  /** The station where the work was booked (added 2026-09-28, optional: older events have none). */
  station: zCode.optional(),
  performed_by: zPerformedBy,
  /** Position of the fact in manufacturing's tamper-evident ledger. */
  ledger_seq: z.number().int().positive(),
};

export const zMaterialConsumedV1 = z.object({
  work_order: zWorkOrderRef,
  item: zRef,
  qty: zPositiveDecimal,
  uom: zCode,
  warehouse: zRef,
  lot_no: z.string().min(1).max(64).optional(),
  ...operational,
});
export type MaterialConsumedV1 = z.infer<typeof zMaterialConsumedV1>;

export const zProductionCompletedV1 = z.object({
  work_order: zWorkOrderRef.extend({
    /** Good quantity completed on the order after this event, including it. */
    completed_qty_after: zPositiveDecimal,
    /** Scrapped quantity on the order so far. */
    scrapped_qty: z.string(),
    /** True when no further good output can come from this order (completed + scrapped = planned). */
    is_final: z.boolean(),
  }),
  item: zRef,
  qty: zPositiveDecimal,
  uom: zCode,
  warehouse: zRef,
  lot_no: z.string().min(1).max(64).optional(),
  ...operational,
});
export type ProductionCompletedV1 = z.infer<typeof zProductionCompletedV1>;

export const zProductionScrappedV1 = z.object({
  work_order: zWorkOrderRef,
  qty: zPositiveDecimal,
  uom: zCode,
  reason_code: zCode,
  ...operational,
});
export type ProductionScrappedV1 = z.infer<typeof zProductionScrappedV1>;

export const zWorkOrderClosedV1 = z.object({
  work_order: zWorkOrderRef.extend({
    completed_qty: z.string(),
    scrapped_qty: z.string(),
  }),
  ...operational,
});
export type WorkOrderClosedV1 = z.infer<typeof zWorkOrderClosedV1>;
