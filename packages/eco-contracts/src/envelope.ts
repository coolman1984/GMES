import { z } from 'zod';
import { zTime, zUuid } from './common.js';

/**
 * The one envelope every ecosystem event travels in. Attribute names follow CloudEvents 1.0
 * (specversion, id, source, type, subject, time, datacontenttype) so any standard tool can read
 * it, with three extension attributes (lower-case letters only, as CloudEvents requires):
 *
 * - ecoseq:          position in the producer's feed, gap-free — the consumer's cursor
 * - ecocorrelation:  events with the same value are applied strictly in order; a parked event
 *                    holds back only its own correlation (one work order), not the whole feed
 * - ecocausation:    the command that produced the event (idempotency key of the command)
 */
export const zEnvelope = z.object({
  specversion: z.literal('1.0'),
  id: zUuid,
  source: z.string().regex(/^eco:\/\/[0-9a-f-]{36}\/[a-z0-9-]+(\/[A-Za-z0-9._-]+)?$/, 'eco://<company-id>/<app>[/<node>]'),
  type: z.string().regex(/^[a-z]+(\.[a-z_]+)+\.v[0-9]+$/, 'e.g. mes.production.completed.v1'),
  subject: z.string().min(1).max(200),
  time: zTime,
  datacontenttype: z.literal('application/json'),
  ecoseq: z.number().int().positive(),
  ecocorrelation: z.string().min(1).max(200),
  ecocausation: z.string().min(1).max(100).optional(),
  data: z.unknown(),
});
export type Envelope<T = unknown> = Omit<z.infer<typeof zEnvelope>, 'data'> & { data: T };

export const sourceOf = (companyId: string, app: string, node?: string) => `eco://${companyId}/${app}${node ? '/' + node : ''}`;

/** Company id is the root namespace of every derived id; it is embedded in the source. */
export function companyOfSource(source: string): string | null {
  const m = /^eco:\/\/([0-9a-f-]{36})\//.exec(source);
  return m ? m[1]! : null;
}

export { zUuid };
