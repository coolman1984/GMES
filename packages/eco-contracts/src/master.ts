import { z } from 'zod';
import { zCode, zDate, zDecimal, zName, zOrigin, zRef, zUuid } from './common.js';

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
  /**
   * How the item is planned and bought (added 2026-09-29, optional: older snapshots have none). Quantities and days only,
   * never a price. OWNER: accounting (Mizan) unless manufacturing is the fallback owner of items.
   */
  planning: z.object({
    material_type: z.enum(['raw', 'semi', 'finished', 'packaging', 'service']),
    procurement: z.enum(['buy', 'make']),
    /** Planned days from placing the order to the goods in the plant warehouse (buy items). */
    lead_time_days: z.number().int().min(0).max(730),
    /** Minimum order quantity; "0" = none. */
    moq: zDecimal,
    lot_rule: z.enum(['lot_for_lot', 'fixed', 'multiple']),
    lot_size: zDecimal,
    safety_stock: zDecimal,
    default_supplier: zRef.optional(),
    /** Days for the fast alternative (air freight); planning uses it to say what would still make the date. */
    expedite_lead_time_days: z.number().int().min(0).max(730).optional(),
  }).optional(),
});
export type ItemV1 = z.infer<typeof zItemV1>;

export const zWarehouseV1 = z.object({
  ...snapshotBase,
  is_default: z.boolean(),
});
export type WarehouseV1 = z.infer<typeof zWarehouseV1>;

/**
 * Workforce master data. OWNER: the HR system (coolman1984/HR-System). Nobody else creates or
 * edits employees; manufacturing, accounting and 3D keep read-only mirrors keyed by this id.
 *
 * Deliberately NO personal data (birth date, national id, gender, pay, contacts): other apps
 * need to know WHO did something and whether they may work, not who they are privately.
 * Identity: UUIDv5(company id, "hr:employee:<Employee_ID>").
 */
export const zEmployeeV1 = z.object({
  id: zUuid,
  /** The HR employee number (e.g. "E000001"), unique per company and never reused. */
  code: zCode,
  display_name: z.string().min(1).max(200).optional(),
  /** The owner's own vocabulary ("Active", "Suspended", "Terminated" …), carried as is. */
  employment_status: z.string().min(1).max(40),
  /** The owner's decision whether this person may be booked on work now. */
  active: z.boolean(),
  hire_date: zDate.optional(),
  termination_date: zDate.optional(),
  department_code: zCode.optional(),
  position_code: zCode.optional(),
  plant_code: zCode.optional(),
  version: z.number().int().positive(),
  origin: zOrigin,
});
export type EmployeeV1 = z.infer<typeof zEmployeeV1>;

/**
 * One employee's attendance for one work day, as HR finally decided it (after corrections).
 * OWNER: HR. Manufacturing reads it to know who was actually at work in a shift; it never edits it.
 * Identity: UUIDv5(company id, "hr:attendance:<Attendance_ID>").
 */
export const zAttendanceDayV1 = z.object({
  id: zUuid,
  code: zCode,
  employee: zRef,
  work_date: zDate,
  /** Owner's vocabulary: "Present", "Absent", "Leave" … */
  status: z.string().min(1).max(40),
  scheduled_shift_code: zCode.optional(),
  roster: z.object({ shift_code: zCode.optional(), status: z.string().min(1).max(40).optional() }).optional(),
  leave: z.object({ request_code: zCode.optional(), type: z.string().min(1).max(60).optional() }).optional(),
  worked_minutes: z.number().int().min(0).optional(),
  version: z.number().int().positive(),
  origin: zOrigin,
});
export type AttendanceDayV1 = z.infer<typeof zAttendanceDayV1>;

/**
 * One employee's PLANNED day (phase 3 of HR-System: shifts, calendars, assignments, day changes), as HR resolved it.
 * OWNER: HR. Manufacturing mirrors it to know who is expected on which shift; it never plans people itself.
 * The mirror keeps working when HR is unreachable and shows how old it is (last-known-good, not a second truth).
 * An overnight shift has ONE work date, the day it starts; `start`/`end` are local plant times.
 * Identity: UUIDv5(company id, "hr:schedule:<Employee_ID>:<work date>").
 */
export const zScheduleDayV1 = z.object({
  id: zUuid,
  employee: zRef,
  work_date: zDate,
  status: z.enum(['work', 'rest', 'holiday', 'unscheduled']),
  shift_code: zCode.optional(),
  /** The line (HR work centre = manufacturing's line code) the person works on that day, when HR knows it (added 2026-09-29). */
  line: zCode.optional(),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(),
  paid_minutes: z.number().int().min(0).max(1440),
  /** Where the plan came from: a day change, a temporary or a regular assignment. */
  source: z.enum(['override', 'temporary', 'regular']).optional(),
  version: z.number().int().positive(),
  origin: zOrigin,
});
export type ScheduleDayV1 = z.infer<typeof zScheduleDayV1>;

/**
 * A person's qualification for a skill (phase 5 of HR-System). OWNER: HR (who is qualified). Which skill a station
 * needs is MANUFACTURING's configuration; manufacturing refuses to book a person on a station without a valid
 * qualification at the required level. `active` false = withdrawn (moved to HR's Recycle Bin): refuse from now on.
 * Identity: UUIDv5(company id, "hr:qualification:<Employee_ID>-<skill code>").
 */
export const zQualificationV1 = z.object({
  id: zUuid,
  employee: zRef,
  skill_code: zCode,
  skill_name: z.string().min(1).max(200).optional(),
  /** 1 learner, 2 works with help, 3 independent, 4 can train others. */
  level: z.number().int().min(1).max(4),
  certified_on: zDate,
  expires_on: zDate.optional(),
  active: z.boolean(),
  version: z.number().int().positive(),
  origin: zOrigin,
});
export type QualificationV1 = z.infer<typeof zQualificationV1>;
