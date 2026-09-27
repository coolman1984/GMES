import { z } from 'zod';
import { parseQty, QuantityError } from './quantity.js';

/** Patterns (not refinements) so the generated JSON Schemas carry them for non-TypeScript apps. */
export const zUuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'must be a lower-case UUID');
export const zCode = z.string().trim().min(1).max(64);
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
export const zTime = z.string().datetime({ offset: true });
export const zName = z.object({ en: z.string().min(1).max(200), ar: z.string().min(1).max(200) });

/** An exact decimal string that fits the x1000 integer scale (ADR-018). */
export const zDecimal = z
  .string()
  .regex(/^-?(0|[1-9][0-9]*)(\.[0-9]{1,3}0*)?$/, 'exact decimal string with at most 3 significant decimals')
  .refine(
  (v) => {
    try {
      parseQty(v);
      return true;
    } catch (e) {
      if (e instanceof QuantityError) return false;
      throw e;
    }
  },
  'exact decimal string with at most 3 decimals',
);
export const zPositiveDecimal = zDecimal.refine((v) => parseQty(v) > 0, 'must be greater than zero');

export const zQuantity = z.object({ value: zPositiveDecimal, uom: zCode });

/** Where an entity came from in its owner's own database (for support and tracing only; never a foreign key). */
export const zOrigin = z.object({ app: z.string().min(1).max(40), type: z.string().min(1).max(40), key: z.string().min(1).max(100) });

/** A reference to an entity as carried inside an event: global id + human code. */
export const zRef = z.object({ id: zUuid, code: zCode });

export const zPerformedBy = z.object({
  /** Login name in the producing app, for display only (users are never shared between apps). */
  user: z.string().min(1).max(100),
  /** Global person id when one is known (eco.person), else absent. */
  person: zRef.optional(),
});
