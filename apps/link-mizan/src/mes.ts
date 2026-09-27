import type { AckV1 } from '@eco/contracts';
import { businessError, jsonFetch } from './http.js';

export class MesClient {
  constructor(
    private readonly base: string,
    private readonly key: string,
  ) {}

  private async ok<T>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await jsonFetch(`${this.base}${path}`, { method, body, headers: { 'x-eco-key': this.key } });
    if (r.status >= 400) businessError(r, `${method} ${path}`);
    return r.body as T;
  }

  feed = (after: number, limit = 100) => this.ok<{ head: number; events: unknown[] }>('GET', `/eco/v1/feed?after=${after}&limit=${limit}`);
  inbox = (events: unknown[]) => this.ok<{ results: { id: string; result: string; code?: string; message?: string }[] }>('POST', '/eco/v1/inbox', { events });
  acks = (acks: AckV1[]) => this.ok<{ recorded: number; unknown: number }>('POST', '/eco/v1/acks', { acks });
}
