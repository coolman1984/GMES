import { z } from 'zod';
import { zCode, zDate, zName, zOrigin, zRef, zUuid } from './common.js';

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
