/**
 * Quantities and money on the wire are exact decimal strings ("12.5"), never JSON numbers:
 * a float cannot carry 0.1 exactly, and every app stores its own integer scale.
 *
 * Inside manufacturing (and Mizan) a quantity is an integer in thousandths (ADR-018).
 * A value that cannot be represented at that scale is REFUSED, never rounded: silently
 * rounding a consumed quantity would break quantity conservation between two systems.
 */
export const QTY_SCALE = 1000;
const QTY_DECIMALS = 3;

const DECIMAL = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;

export class QuantityError extends Error {
  constructor(
    readonly code: 'qty.format' | 'qty.precision' | 'qty.range',
    message: string,
  ) {
    super(message);
  }
}

/** "12.5" -> 12500. Throws QuantityError on bad format, too many decimals or an unsafe size. */
export function parseQty(text: string, decimals: number = QTY_DECIMALS): number {
  if (typeof text !== 'string' || !DECIMAL.test(text)) throw new QuantityError('qty.format', `not a decimal string: ${JSON.stringify(text)}`);
  const negative = text.startsWith('-');
  const [whole, frac = ''] = (negative ? text.slice(1) : text).split('.') as [string, string?];
  const trimmed = frac.replace(/0+$/, '');
  if (trimmed.length > decimals) throw new QuantityError('qty.precision', `${text} has more than ${decimals} decimals`);
  const scaled = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(trimmed.padEnd(decimals, '0') || '0');
  if (scaled > BigInt(Number.MAX_SAFE_INTEGER)) throw new QuantityError('qty.range', `${text} is too large`);
  const n = Number(scaled);
  return negative ? -n : n;
}

/** 12500 -> "12.5" (canonical: no trailing zeros, no "-0"). */
export function formatQty(scaled: number, decimals: number = QTY_DECIMALS): string {
  if (!Number.isSafeInteger(scaled)) throw new QuantityError('qty.range', `not a safe integer: ${scaled}`);
  const negative = scaled < 0;
  const abs = BigInt(Math.abs(scaled));
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  const body = frac ? `${whole}.${frac}` : `${whole}`;
  return negative && body !== '0' ? `-${body}` : body;
}
