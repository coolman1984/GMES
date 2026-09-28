import { z } from 'zod';
import { zCode, zDate, zPerformedBy, zPositiveDecimal, zRef, zTime, zUuid } from './common.js';

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

/**
 * A container (or truck) was sealed and left the plant: finished goods physically shipped against a shipping order.
 * Manufacturing states what left, from which warehouse, under which seal; accounting decides how to book the delivery
 * (stock relief, invoice). Serials are listed for serialised items so a recall can reach the customer.
 */
export const zShipmentDispatchedV1 = z.object({
  shipment: z.object({ id: zUuid, code: zCode, customer: z.string().min(1).max(200), destination: z.string().max(200).optional() }),
  container: z.object({ id: zUuid, number: zCode, seal: zCode, type: zCode }),
  lines: z.array(z.object({
    item: zRef,
    qty: zPositiveDecimal,
    uom: zCode,
    warehouse: zRef,
    pallets: z.number().int().min(0),
    serials: z.array(z.string().min(1).max(64)).max(20000).optional(),
  })).min(1),
  dispatched_at: zTime,
  production_date: zDate,
  performed_by: zPerformedBy,
  /** Position of the fact in manufacturing's shipping history (hash-chained). */
  shipping_seq: z.number().int().positive(),
});
export type ShipmentDispatchedV1 = z.infer<typeof zShipmentDispatchedV1>;
