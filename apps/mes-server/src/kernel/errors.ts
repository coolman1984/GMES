/** Errors carry a stable code (for programs and tests) and a message (for people). */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const fail = (code: string, message: string, details?: Record<string, unknown>): never => {
  throw new AppError(400, code, message, details);
};
export const conflict = (code: string, message: string, details?: Record<string, unknown>): never => {
  throw new AppError(409, code, message, details);
};
export const notFound = (what: string, id: string): never => {
  throw new AppError(404, `${what}.not_found`, `${what} ${id} was not found`);
};
export const forbidden = (code: string, message: string): never => {
  throw new AppError(403, code, message);
};
