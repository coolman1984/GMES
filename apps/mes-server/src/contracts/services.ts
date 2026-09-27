import type { ItemV1, WarehouseV1 } from '@eco/contracts';
import type { Db } from '../kernel/db.js';

/** A master-data row as manufacturing holds it (a mirror of the owner, or its own in fallback mode). */
export interface MirrorItem {
  id: string;
  code: string;
  name_en: string;
  name_ar: string;
  kind: 'product' | 'service';
  stock_tracked: number;
  tracking: 'none' | 'lot' | 'serial';
  base_uom: string;
  active: number;
  version: number;
  owner: 'mizan' | 'gmes';
}

export interface MirrorWarehouse {
  id: string;
  code: string;
  name_en: string;
  name_ar: string;
  active: number;
  is_default: number;
  version: number;
  owner: 'mizan' | 'gmes';
}

export type SnapshotResult = 'applied' | 'unchanged' | 'stale';

export interface MdmService {
  item(id: string, t?: Db): Promise<MirrorItem>;
  warehouse(id: string, t?: Db): Promise<MirrorWarehouse>;
  /** Apply an owner's snapshot inside the caller's transaction. Refuses entities this installation owns itself. */
  applyItem(t: Db, snapshot: ItemV1): Promise<SnapshotResult>;
  applyWarehouse(t: Db, snapshot: WarehouseV1): Promise<SnapshotResult>;
}

export interface OutboxEvent {
  type: string;
  subject: string;
  correlation: string;
  causation?: string;
  data: Record<string, unknown>;
}

export interface EcoService {
  /** Append an event to the outbox INSIDE the caller's transaction (no fact without its event, no event without its fact). */
  publish(t: Db, event: OutboxEvent): Promise<{ id: string; seq: number }>;
}

declare module '../kernel/modules.js' {
  interface ServiceMap {
    mdm: MdmService;
    eco: EcoService;
  }
}
