import { z } from 'zod';
import { zUuid } from './common.js';

/**
 * A consumer tells the producer what became of each event, so nothing fails silently:
 * the producer can show, per event, where it landed (a document number in the other app)
 * or why it is parked.
 */
export const zAckV1 = z.object({
  event_id: zUuid,
  consumer: z.string().min(1).max(60),
  status: z.enum(['applied', 'parked', 'skipped']),
  detail: z
    .object({
      code: z.string().max(80).optional(),
      message: z.string().max(1000).optional(),
      /** The document the event became in the consumer (e.g. "ADJ-00012"). */
      target_ref: z.string().max(100).optional(),
      /** Free figures the consumer wants to show (e.g. value posted, rounding residue). */
      figures: z.record(z.string(), z.string()).optional(),
    })
    .default({}),
});
export type AckV1 = z.infer<typeof zAckV1>;
