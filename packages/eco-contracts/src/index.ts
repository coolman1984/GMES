import type { z } from 'zod';
import { zAckV1 } from './ack.js';
import { zEnvelope } from './envelope.js';
import { zAttendanceDayV1, zEmployeeV1, zItemV1, zQualificationV1, zScheduleDayV1, zWarehouseV1 } from './master.js';
import { zMaterialConsumedV1, zProductionCompletedV1, zProductionScrappedV1, zShipmentDispatchedV1, zWorkOrderClosedV1 } from './mes.js';
import {
  zCrewRequirementV1, zDemandPlanV1, zGoodsReceiptV1, zLaborDayV1, zLayoutSnapshotV1, zLotDecisionV1, zPartyV1, zPayrollPeriodV1, zPlantNodeV1,
  zPurchaseOrderV1, zPurchaseRequisitionV1, zSalesOrderV1, zStockPositionV1, zSupplyPlanV1,
} from './plan.js';

export * from './quantity.js';
export * from './ids.js';
export * from './common.js';
export * from './envelope.js';
export * from './master.js';
export * from './mes.js';
export * from './plan.js';
export * from './ack.js';
export * from './canonical.js';

/** Every contract, by its versioned type name. The JSON Schemas in schemas/ are generated from this map. */
export const CONTRACTS = {
  'eco.envelope.v1': zEnvelope,
  'eco.ack.v1': zAckV1,
  'eco.item.v1': zItemV1,
  'eco.warehouse.v1': zWarehouseV1,
  'eco.employee.v1': zEmployeeV1,
  'eco.attendance_day.v1': zAttendanceDayV1,
  'eco.schedule_day.v1': zScheduleDayV1,
  'eco.qualification.v1': zQualificationV1,
  'mes.material.consumed.v1': zMaterialConsumedV1,
  'mes.production.completed.v1': zProductionCompletedV1,
  'mes.production.scrapped.v1': zProductionScrappedV1,
  'mes.work_order.closed.v1': zWorkOrderClosedV1,
  'mes.shipment.dispatched.v1': zShipmentDispatchedV1,
  'eco.party.v1': zPartyV1,
  'acc.sales_order.v1': zSalesOrderV1,
  'acc.demand_plan.v1': zDemandPlanV1,
  'acc.stock_position.v1': zStockPositionV1,
  'acc.purchase_order.v1': zPurchaseOrderV1,
  'mes.purchase_requisition.v1': zPurchaseRequisitionV1,
  'mes.supply_plan.v1': zSupplyPlanV1,
  'mes.crew_requirement.v1': zCrewRequirementV1,
  'acc.goods_receipt.v1': zGoodsReceiptV1,
  'mes.lot_decision.v1': zLotDecisionV1,
  'mes.labor_day.v1': zLaborDayV1,
  'hr.payroll_period.v1': zPayrollPeriodV1,
  'eco.plant_node.v1': zPlantNodeV1,
  'eco.layout.snapshot.v1': zLayoutSnapshotV1,
} as const satisfies Record<string, z.ZodType>;

export type ContractType = keyof typeof CONTRACTS;
export type DataOf<T extends ContractType> = z.infer<(typeof CONTRACTS)[T]>;

/** Event types (the data contracts that travel inside an envelope). */
export const EVENT_TYPES = Object.keys(CONTRACTS).filter((k) => k !== 'eco.envelope.v1' && k !== 'eco.ack.v1') as ContractType[];

export type ValidationResult = { ok: true; data: unknown } | { ok: false; code: 'contract.unknown_type' | 'contract.invalid'; message: string };

/** Validate an envelope and its data against the contract named by its type. */
export function validateEvent(input: unknown): ValidationResult {
  const env = zEnvelope.safeParse(input);
  if (!env.success) return { ok: false, code: 'contract.invalid', message: env.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  const schema = (CONTRACTS as Record<string, z.ZodType>)[env.data.type];
  if (!schema || !EVENT_TYPES.includes(env.data.type as ContractType)) return { ok: false, code: 'contract.unknown_type', message: `unknown event type ${env.data.type}` };
  const data = schema.safeParse(env.data.data);
  if (!data.success) return { ok: false, code: 'contract.invalid', message: data.error.issues.map((i) => `data.${i.path.join('.')}: ${i.message}`).join('; ') };
  return { ok: true, data: { ...env.data, data: data.data } };
}
