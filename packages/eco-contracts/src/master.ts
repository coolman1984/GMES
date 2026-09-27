import { z } from 'zod';
import { zCode, zName, zOrigin, zUuid } from './common.js';

/**
 * Master-data contracts: a FULL snapshot of the entity as its owner sees it, with a version
 * that only goes up. A consumer applies a snapshot only when its version is newer than the
 * one it holds, so re-delivery and out-of-order delivery are both harmless.
 */
const snapshotBase = {
  id: zUuid,
  code: zCode,
  name: zName,
  active: z.boolean(),
  /** Monotonic per entity at the owner. A content fingerprint is NOT a version (it can go "back"). */
  version: z.number().int().positive(),
  origin: zOrigin,
};

export const zItemV1 = z.object({
  ...snapshotBase,
  kind: z.enum(['product', 'service']),
  /** Carries a stock balance in the financial inventory. */
  stock_tracked: z.boolean(),
  tracking: z.enum(['none', 'lot', 'serial']),
  base_uom: zCode,
  /** Alternative units: 1 unit = factor base units, as an exact decimal string. */
  units: z.array(z.object({ code: zCode, factor: z.string() })).max(50),
});
export type ItemV1 = z.infer<typeof zItemV1>;

export const zWarehouseV1 = z.object({
  ...snapshotBase,
  is_default: z.boolean(),
});
export type WarehouseV1 = z.infer<typeof zWarehouseV1>;
