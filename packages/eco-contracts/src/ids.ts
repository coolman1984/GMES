import { createHash, randomBytes } from 'node:crypto';

/**
 * Identities (ADR-017).
 *
 * - The OWNER of an entity mints its global id once; nobody else ever does.
 * - Manufacturing mints UUIDv7 (time-ordered, good for indexes).
 * - An owner whose own keys are integers (Mizan) is represented by a deterministic UUIDv5 of
 *   (company id, "mizan:<type>:<id>"): the same input always gives the same id, so no mapping
 *   table can be lost and Mizan never has to change.
 */

const HEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isUuid(s: unknown): s is string {
  return typeof s === 'string' && HEX.test(s);
}

function format(bytes: Uint8Array): string {
  const h = Buffer.from(bytes).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function parse(uuid: string): Buffer {
  if (!isUuid(uuid)) throw new Error(`not a UUID: ${uuid}`);
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

/** RFC 9562 UUIDv5 (SHA-1 name-based). */
export function uuidv5(namespace: string, name: string): string {
  const hash = createHash('sha1').update(parse(namespace)).update(Buffer.from(name, 'utf8')).digest();
  const b = hash.subarray(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  return format(b);
}

/**
 * RFC 9562 UUIDv7. `ms` and `random` are parameters so callers that must be deterministic
 * (tests, pure logic) can supply them; `newUuidv7()` is the everyday form.
 */
export function uuidv7(ms: number, random: Uint8Array): string {
  if (random.length < 10) throw new Error('uuidv7 needs 10 random bytes');
  const b = new Uint8Array(16);
  let t = BigInt(ms);
  for (let i = 5; i >= 0; i--) {
    b[i] = Number(t & 0xffn);
    t >>= 8n;
  }
  b.set(random.subarray(0, 10), 6);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  return format(b);
}

export const newUuidv7 = (): string => uuidv7(Date.now(), randomBytes(10));

/** Global id of an entity owned by Mizan (integer keys). */
export const mizanId = (companyId: string, type: 'item' | 'warehouse' | 'lot' | 'party' | 'account', localId: number): string =>
  uuidv5(companyId, `mizan:${type}:${localId}`);

/** Global id of an entity owned by the HR system, whose own keys are stable text codes (E000001, TIM02-00001). */
export const hrId = (companyId: string, type: 'employee' | 'attendance' | 'shift' | 'org_unit' | 'schedule' | 'qualification' | 'skill', code: string): string =>
  uuidv5(companyId, `hr:${type}:${code}`);
