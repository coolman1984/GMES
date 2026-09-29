import type { AttendanceDayV1, DemandPlanV1, EmployeeV1, ItemV1, PartyV1, PurchaseOrderV1, QualificationV1, SalesOrderV1, ScheduleDayV1, StockPositionV1, WarehouseV1 } from '@eco/contracts';
import type { Db } from '../kernel/db.js';
import type { Caller } from '../kernel/modules.js';

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

/** A read-only mirror of an HR employee (the HR system owns it; manufacturing never edits it). */
export interface MirrorEmployee {
  id: string;
  code: string;
  display_name: string | null;
  employment_status: string;
  active: number;
  version: number;
}

/** A node of the plant model (manufacturing owns it: docs/ecosystem/02, "line / station / equipment"). */
export interface PlantNode {
  id: string;
  code: string;
  type: 'plant' | 'area' | 'line' | 'station' | 'equipment';
  parent_id: string | null;
  name_en: string;
  name_ar: string;
  active: number;
  capacity_per_shift: number | null;
}

export interface MdmService {
  item(id: string, t?: Db): Promise<MirrorItem>;
  /** A plant-model node by its code, or undefined. */
  plantNode(code: string, t?: Db): Promise<PlantNode | undefined>;
  /** Every plant-model node of one type, ordered by code. */
  plantNodes(type: PlantNode['type'], t?: Db): Promise<PlantNode[]>;
  warehouse(id: string, t?: Db): Promise<MirrorWarehouse>;
  /** Apply an owner's snapshot inside the caller's transaction. Refuses entities this installation owns itself. */
  applyItem(t: Db, snapshot: ItemV1): Promise<SnapshotResult>;
  applyWarehouse(t: Db, snapshot: WarehouseV1): Promise<SnapshotResult>;
  applyEmployee(t: Db, snapshot: EmployeeV1): Promise<SnapshotResult>;
  applyAttendanceDay(t: Db, snapshot: AttendanceDayV1): Promise<SnapshotResult>;
  applyScheduleDay(t: Db, snapshot: ScheduleDayV1): Promise<SnapshotResult>;
  applyQualification(t: Db, snapshot: QualificationV1): Promise<SnapshotResult>;
  /** Accounting's commercial truth, mirrored read-only for planning (only from Mizan, only when it owns items here). */
  applyParty(t: Db, snapshot: PartyV1): Promise<SnapshotResult>;
  applySalesOrder(t: Db, snapshot: SalesOrderV1): Promise<SnapshotResult>;
  applyDemandPlan(t: Db, snapshot: DemandPlanV1): Promise<SnapshotResult>;
  applyStockPosition(t: Db, snapshot: StockPositionV1): Promise<SnapshotResult>;
  applyPurchaseOrder(t: Db, snapshot: PurchaseOrderV1): Promise<SnapshotResult>;
  /**
   * The person a production command names, checked against the HR mirror when HR owns people
   * (ownership.person = 'hr'). With 'none' (manufacturing alone, or rollback) the reference is
   * carried unchecked, exactly as before the HR boundary existed.
   */
  resolvePerson(t: Db, ref: { id: string; code: string } | undefined, at?: { station?: string; date: string }): Promise<{ id: string; code: string } | undefined>;
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

/** A stoppage of a line or station, derived from the append-only start/end facts of the oee module. */
export interface Stoppage {
  id: string;
  line: string;
  station: string | null;
  reason: string;
  productionDate: string;
  startedAt: string;
  startedBy: string;
  endedAt: string | null;
  endedBy: string | null;
  minutes: number;
}

/** OEE of a line for a production day (or one shift of it), ISO 22400. Minutes; percentages 0..100; null = not knowable. */
export interface OeeFigures {
  line: string;
  date: string;
  shift: string | null;
  shiftsWorked: string[];
  plannedMin: number;
  plannedStopMin: number;
  busyMin: number;
  downtimeMin: number;
  runMin: number;
  good: number;
  scrap: number;
  idealMin: number | null;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
  /** Stopped minutes by loss category (breakdown, setup, material, quality, planned, other). */
  losses: Record<string, number>;
  speedLossMin: number | null;
}

export interface OeeService {
  /** Stoppages of a production day and/or line, or only the open ones, newest first; open ones have endedAt = null. */
  stoppages(q: { date?: string; line?: string; openOnly?: boolean }): Promise<Stoppage[]>;
  oee(q: { line: string; date: string; shift?: string }): Promise<OeeFigures>;
}

/** One step of a routing (engineering). A unit performs it at the station `<line code>-<code>`. */
export interface RouteOp {
  seq: number;
  code: string;
  name_en: string;
  name_ar: string;
  kind: 'work' | 'test' | 'inspection' | 'pack';
  mandatory: number;
  /** Ideal cycle time of one unit, in milliseconds (OEE performance); null when not known. */
  cycle_ms: number | null;
}

export interface Routing {
  id: string;
  item_id: string;
  revision: number;
  status: 'draft' | 'approved' | 'obsolete';
  item: { code: string; name_en: string; name_ar: string } | null;
  operations: RouteOp[];
}

export interface BomLine {
  line_no: number;
  component_id: string;
  component_code: string;
  name_en: string;
  name_ar: string;
  tracking: 'none' | 'lot' | 'serial';
  base_uom: string;
  /** Thousandths per unit of the parent (ADR-018). */
  qty_per: number;
  /** The operation that consumes it. */
  op_code: string;
  /** What the station scans: the part's own serial, the lot loaded on the station, or nothing (backflushed). */
  scan: 'serial' | 'lot' | 'none';
}

export interface Bom {
  id: string;
  item_id: string;
  revision: number;
  status: 'draft' | 'approved' | 'obsolete';
  item: { code: string; name_en: string; name_ar: string } | null;
  lines: BomLine[];
}

/** A production shift of the plant's calendar (the plant's working time, not a person's roster: that is HR's). */
export interface ProdShift {
  code: string;
  name_en: string;
  name_ar: string;
  start_at: string;
  end_at: string;
  break_min: number;
  active: number;
  version: number;
}

export interface EngService {
  /** The approved (frozen) routing of an item, or undefined when it has none. */
  approvedRouting(itemId: string, t?: Db): Promise<Routing | undefined>;
  routing(id: string, t?: Db): Promise<Routing>;
  approvedBom(itemId: string, t?: Db): Promise<Bom | undefined>;
  bom(id: string, t?: Db): Promise<Bom>;
  shifts(t?: Db): Promise<ProdShift[]>;
  isWorkingDay(day: string, t?: Db): Promise<boolean>;
}

/** The facts of production other modules book on a work order, inside THEIR transaction (one command, one commit). */
export interface Booking {
  commandId: string;
  productionDate?: string;
  shift?: string;
  person?: { id: string; code: string };
  station?: string;
}

export interface WorkOrderView {
  id: string;
  code: string;
  item_id: string;
  warehouse_id: string;
  planned_qty: number;
  completed_qty: number;
  scrapped_qty: number;
  status: 'released' | 'completed' | 'closed';
  production_date: string;
  line_code: string | null;
  shift_code: string | null;
  priority: number;
  routing_id: string | null;
  bom_id: string | null;
  version: number;
}

export interface ExeService {
  workOrder(id: string, t?: Db): Promise<WorkOrderView>;
  workOrderByCode(code: string, t?: Db): Promise<WorkOrderView | undefined>;
  complete(t: Db, caller: Caller, woId: string, input: Booking & { qty: number; lotNo?: string }): Promise<{ ledgerSeq: number; status: string }>;
  scrap(t: Db, caller: Caller, woId: string, input: Booking & { qty: number; reasonCode: string }): Promise<{ ledgerSeq: number; status: string }>;
  consume(t: Db, caller: Caller, woId: string, input: Booking & { itemId: string; qty: number; warehouseId: string; lotNo?: string }): Promise<{ ledgerSeq: number }>;
  /** Release a work order (planning releases its firmed orders through this). */
  create(t: Db, caller: Caller, input: { commandId: string; itemId: string; qty: number; warehouseId: string; line?: string; productionDate?: string; dueDate?: string; priority?: number; plannedOrderId?: string; pegging?: unknown }): Promise<{ id: string; code: string }>;
}

/** A serial unit as the tracking module holds it (a projection of its unit events). */
export interface UnitRow {
  id: string;
  serial: string;
  item_id: string;
  work_order_id: string;
  line_code: string;
  status: 'wip' | 'repair' | 'completed' | 'scrapped' | 'consumed' | 'packed' | 'shipped';
  /** The next operation to perform (the failed one while in repair); null once completed. */
  op_seq: number | null;
  op_code: string | null;
  last_station: string | null;
  /** Number of quality holds on the unit (0 = free to move). */
  held: number;
  fail_op_seq: number | null;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  version: number;
}

export interface TrkService {
  unit(serial: string, t?: Db): Promise<UnitRow | undefined>;
  unitById(id: string, t?: Db): Promise<UnitRow | undefined>;
  /** Units of a work order (or of a lot / serial list) that a hold would stop; excludes scrapped and consumed units. */
  unitsOf(t: Db, target: { workOrderId?: string; serials?: string[] }): Promise<UnitRow[]>;
  hold(t: Db, caller: Caller, unitIds: string[], ref: { commandId: string; holdId: string; reason: string }): Promise<number>;
  release(t: Db, caller: Caller, unitIds: string[], ref: { commandId: string; holdId: string }): Promise<number>;
  /** Packing and shipping (the shipping module): the unit's status moves on, with a fact in its history. */
  markPacked(t: Db, caller: Caller, unitId: string, ref: { commandId: string; box: string; station?: string }): Promise<void>;
  markUnpacked(t: Db, caller: Caller, unitId: string, ref: { commandId: string; box: string; reason: string }): Promise<void>;
  markShipped(t: Db, caller: Caller, unitIds: string[], ref: { commandId: string; shipment: string; container: string }): Promise<void>;
  /** Quality dispositions: scrap a unit still in production, or send it back to repair. */
  scrapUnit(t: Db, caller: Caller, serial: string, ref: { commandId: string; reasonCode: string }): Promise<void>;
  toRepair(t: Db, caller: Caller, unitId: string, ref: { commandId: string; defectCode: string }): Promise<void>;
}

/** Where a finished unit is now: its box, pallet, shipment and container (the shipping module). */
export interface UnitWhereabouts {
  box: string | null;
  pallet: string | null;
  shipment: string | null;
  container: string | null;
}

export interface ShpService {
  whereIs(unitId: string, t?: Db): Promise<UnitWhereabouts | null>;
  /** The units packed on a pallet (a shipping lot), by id. */
  unitsIn(t: Db, pallet: string): Promise<string[]>;
}

/** The system module: electronic signatures and the audit trail of master data. */
export interface SysService {
  /** The signed-in person confirms a decision with their password; refused for machine keys and wrong passwords. */
  sign(caller: Caller, password: string): Promise<{ login: string; name: string }>;
  audit(t: Db, actor: string, action: string, target: string, details?: unknown): Promise<void>;
}

/** Quality (the qms module), as other modules need it. */
export interface QmsService {
  /** Refuses a defect code that is not in the list (or is inactive). */
  checkDefect(t: Db, code: string): Promise<void>;
  /** Refuses a repair cause / action code that is not in the list. */
  checkRepairCode(t: Db, kind: 'cause' | 'action', code: string): Promise<void>;
  /** The outgoing inspection of a shipping lot (a pallet): passed, failed, or not inspected yet. */
  oqcResult(t: Db, lot: string): Promise<'passed' | 'failed' | 'none'>;
}

declare module '../kernel/modules.js' {
  interface ServiceMap {
    mdm: MdmService;
    eco: EcoService;
    oee: OeeService;
    eng: EngService;
    exe: ExeService;
    trk: TrkService;
    qms: QmsService;
    sys: SysService;
    shp: ShpService;
  }
}
