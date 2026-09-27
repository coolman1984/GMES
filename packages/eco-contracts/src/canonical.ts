import { createHash } from 'node:crypto';

/**
 * Eco canonical JSON v1 and journal-line hashing (docs/ecosystem/08 F1, ADR-026).
 *
 * One definition for every app in every language: UTF-8, keys sorted by code point, no whitespace,
 * INTEGERS ONLY (a float's text differs between languages, so it is refused), standard JSON escapes,
 * non-ASCII characters written as themselves. This is what BAMS already does in Python
 * (json.dumps(sort_keys=True, separators=(',', ':'), ensure_ascii=False)); the shared vectors in
 * vectors/canonical-v1.json prove the TypeScript and Python implementations agree byte for byte.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error(`canonical JSON carries integers only, got ${value}`);
    return String(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort(byCodePoint);
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(o[k])).join(',') + '}';
  }
  throw new Error(`not representable in canonical JSON: ${typeof value}`);
}

/** Python sorts str by code point; JS default sort is by UTF-16 unit — they differ above U+FFFF. */
function byCodePoint(a: string, b: string): number {
  const x = [...a].map((c) => c.codePointAt(0)!);
  const y = [...b].map((c) => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return x.length - y.length;
}

export const GENESIS_HASH = '0'.repeat(64);

/** SHA-256(domain + "\n" + canonical(line)); the line itself carries `prev`. Domains keep journals of different apps apart. */
export function lineHash(domain: string, line: Record<string, unknown>): string {
  return createHash('sha256').update(domain + '\n' + canonicalJson(line), 'utf8').digest('hex');
}
