import { BusinessError, TransientError } from './errors.js';

export interface JsonResponse {
  status: number;
  body: any;
  headers: Headers;
}

/** fetch + JSON, mapping failures to Transient/Business errors. Never logs request bodies (they may carry secrets). */
export async function jsonFetch(url: string, init: { method: string; body?: unknown; headers?: Record<string, string>; timeoutMs?: number }): Promise<JsonResponse> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method,
      headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
    });
  } catch (err) {
    throw new TransientError(`${init.method} ${new URL(url).pathname}: ${(err as Error).message}`);
  }
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  if (res.status >= 500 || res.status === 429) throw new TransientError(`${init.method} ${new URL(url).pathname} -> ${res.status}`);
  return { status: res.status, body, headers: res.headers };
}

export function businessError(r: JsonResponse, what: string): never {
  const e = r.body?.error;
  throw new BusinessError(e?.code ?? `http.${r.status}`, `${what}: ${e?.message ?? JSON.stringify(r.body)}`);
}
