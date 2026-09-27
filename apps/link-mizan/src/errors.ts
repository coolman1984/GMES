/**
 * Two kinds of failure, handled in opposite ways:
 * - Transient (network down, 5xx, Mizan restarting): stop this cycle, advance nothing, try again later.
 * - Business (Mizan answered "no": insufficient stock, closed period, unknown item): park the event
 *   with the reason, tell manufacturing, hold back later events of the same work order only.
 */
export class TransientError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class BusinessError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
