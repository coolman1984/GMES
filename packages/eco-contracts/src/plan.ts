import { z } from 'zod';
import { zCode, zDate, zDecimal, zName, zOrigin, zPositiveDecimal, zRef, zTime, zUuid } from './common.js';

/**
 * Plan-to-produce and order-to-cash contracts (2026-09-29, ADR-038).
 *
 * Who owns what (docs/ecosystem/02-truth-ownership.md):
 *   - Accounting (Mizan) owns parties, sales orders, the approved demand plan (S&OP), stock balances and purchase
 *     orders. It publishes SNAPSHOTS of them; manufacturing mirrors them read-only to plan.
 *   - Manufacturing (GMES) owns the production plan (MPS), the material requirements (MRP) and the crew each line
 *     needs. It publishes what planning CONCLUDED (a requisition, a supply plan, a crew requirement); the owner of the
 *     follow-up decides what to do with it (accounting buys, HR staffs). No money ever travels in these contracts:
 *     prices, costs and credit stay in accounting.
 *
 * Snapshots follow the master-data rule: full state, `version` only goes up, a consumer applies a newer version only.
 */

const snapshot = {
  id: zUuid,
  code: zCode,
  version: z.number().int().positive(),
  origin: zOrigin,
};

/** A month of the plan, e.g. "2026-11". */
export const zPeriod = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM');

// ------------------------------------------------------------------ owned by accounting

/** A customer or supplier. OWNER: accounting. No credit, price or bank data: other apps only need who it is. */
export const zPartyV1 = z.object({
  ...snapshot,
  name: zName,
  roles: z.array(z.enum(['customer', 'supplier'])).min(1).max(2),
  country: z.string().regex(/^[A-Z]{2}$/, 'ISO 3166 alpha-2').optional(),
  active: z.boolean(),
});
export type PartyV1 = z.infer<typeof zPartyV1>;

/**
 * A customer's order as accounting holds it. OWNER: accounting (sales). Manufacturing plans against the open quantity
 * and links its shipments to the order line; accounting alone promises, delivers, invoices and collects.
 */
export const zSalesOrderV1 = z.object({
  ...snapshot,
  customer: zRef,
  order_date: zDate,
  /** The customer's own purchase-order number, for display. */
  customer_reference: z.string().min(1).max(80).optional(),
  status: z.enum(['open', 'closed', 'cancelled']),
  /** 1 = most urgent. Used by planning to decide who waits when supply is short. */
  priority: z.number().int().min(1).max(9),
  ship_to: z.string().min(1).max(200).optional(),
  lines: z.array(z.object({
    line_no: z.number().int().positive(),
    item: zRef,
    qty: zPositiveDecimal,
    uom: zCode,
    /** The date the customer asked for (delivery at the customer, or at the port for exports). */
    requested_date: zDate,
    /** The date accounting confirmed to the customer (ATP/CTP result), once confirmed. */
    promised_date: zDate.optional(),
    /** Quantity already delivered to the customer (goods issued by accounting). */
    delivered_qty: zDecimal,
  })).min(1).max(500),
});
export type SalesOrderV1 = z.infer<typeof zSalesOrderV1>;

/**
 * The approved (consensus) demand plan of one S&OP cycle: quantities per product and month. OWNER: accounting
 * (sales & finance own demand and its value; only quantities travel). A new cycle is a new plan with its own code;
 * the previous one stays as history. Manufacturing plans the months not yet covered by firm sales orders from it.
 */
export const zDemandPlanV1 = z.object({
  ...snapshot,
  /** e.g. "S&OP 2026-10" — the cycle that approved it. */
  cycle: zPeriod,
  status: z.enum(['approved', 'superseded']),
  approved_at: zTime,
  lines: z.array(z.object({ item: zRef, period: zPeriod, qty: zDecimal })).min(1).max(5000),
});
export type DemandPlanV1 = z.infer<typeof zDemandPlanV1>;

/** The stock of one item in one warehouse as accounting books it. OWNER: accounting. Identity: item × warehouse. */
export const zStockPositionV1 = z.object({
  id: zUuid,
  item: zRef,
  warehouse: zRef,
  on_hand: zDecimal,
  /** Quantity reserved for confirmed sales orders and not yet delivered. */
  reserved: zDecimal,
  uom: zCode,
  as_of: zTime,
  version: z.number().int().positive(),
  origin: zOrigin,
});
export type StockPositionV1 = z.infer<typeof zStockPositionV1>;

/**
 * A purchase order as accounting holds it: planning counts its open quantity as supply on its expected date.
 * OWNER: accounting (purchasing). No prices.
 */
export const zPurchaseOrderV1 = z.object({
  ...snapshot,
  supplier: zRef,
  order_date: zDate,
  status: z.enum(['draft', 'open', 'closed', 'cancelled']),
  lines: z.array(z.object({
    line_no: z.number().int().positive(),
    item: zRef,
    qty: zPositiveDecimal,
    received_qty: zDecimal,
    uom: zCode,
    /** When the goods are expected at the plant warehouse. */
    expected_date: zDate,
    warehouse: zRef,
    /** The manufacturing requisition this line came from, when it did. */
    requisition: zRef.optional(),
  })).min(1).max(500),
});
export type PurchaseOrderV1 = z.infer<typeof zPurchaseOrderV1>;

// ------------------------------------------------------------------ owned by manufacturing

/** Which demand a planned quantity serves (pegging), so everyone can explain every requisition and every order. */
const zPegging = z.array(z.object({
  kind: z.enum(['sales_order', 'demand_plan', 'safety_stock']),
  /** Sales order code and line, or demand plan code and period. */
  reference: z.string().min(1).max(80),
  qty: zPositiveDecimal,
})).max(200);

/**
 * A purchased material that planning (MRP) found missing: net requirement after stock, open purchase orders and
 * safety stock, offset by the supplier lead time. OWNER: manufacturing (the requirement); accounting's purchasing
 * decides whether, from whom and at what price to buy, and publishes the purchase order that answers it.
 * A requisition is replaced by a newer version when a later MRP run changes it; `status: cancelled` withdraws it.
 */
export const zPurchaseRequisitionV1 = z.object({
  ...snapshot,
  item: zRef,
  qty: zPositiveDecimal,
  uom: zCode,
  /** The date the material must be in the plant warehouse (start of the first production that needs it). */
  need_date: zDate,
  /** The latest date the order can be placed with the supplier: need date minus the planned lead time. */
  order_by_date: zDate,
  warehouse: zRef,
  mrp_run: zRef,
  status: z.enum(['open', 'cancelled']),
  pegging: zPegging,
});
export type PurchaseRequisitionV1 = z.infer<typeof zPurchaseRequisitionV1>;

/**
 * What manufacturing can supply, per product and month, after capacity and material checks (the supply review of
 * S&OP). OWNER: manufacturing. Accounting compares it with the demand plan and prices the gap.
 */
export const zSupplyPlanV1 = z.object({
  ...snapshot,
  mrp_run: zRef,
  lines: z.array(z.object({
    item: zRef,
    period: zPeriod,
    demand_qty: zDecimal,
    planned_qty: zDecimal,
    /** Why planned is below demand, when it is. */
    constraint: z.enum(['none', 'capacity', 'material', 'both']),
  })).min(1).max(5000),
});
export type SupplyPlanV1 = z.infer<typeof zSupplyPlanV1>;

/**
 * The people one line needs on one shift of one production day, derived from the production plan, the routing and
 * the station skill requirements. OWNER: manufacturing (the need); HR decides who works, hires or plans overtime and
 * publishes the schedule that answers it. Identity: line × shift × day.
 */
export const zCrewRequirementV1 = z.object({
  id: zUuid,
  line: zCode,
  shift: zCode,
  work_date: zDate,
  /** 0 = the line does not run on that shift (a withdrawn need). */
  headcount: z.number().int().min(0).max(1000),
  skills: z.array(z.object({ skill_code: zCode, level: z.number().int().min(1).max(4), count: z.number().int().positive() })).max(100),
  mrp_run: zRef,
  version: z.number().int().positive(),
  origin: zOrigin,
});
export type CrewRequirementV1 = z.infer<typeof zCrewRequirementV1>;
