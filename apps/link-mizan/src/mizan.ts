import { businessError, jsonFetch, type JsonResponse } from './http.js';

/**
 * Mizan through its EXISTING public HTTP API, as a dedicated user (e.g. "mes-link") whose role
 * holds only what the link needs. Nothing in Mizan is changed or read behind its back.
 */
export interface MizanItem {
  id: number;
  sku: string;
  name_en: string;
  name_ar: string;
  kind: 'service' | 'product';
  unit: string | null;
  is_active: number;
  track_stock: number;
  tracking: 'none' | 'batch' | 'serial';
}
export interface MizanWarehouse {
  id: number;
  code: string;
  name_en: string;
  name_ar: string;
  is_active: number;
  is_default: number;
}
export interface MizanAccount {
  id: number;
  code: string;
  type: string;
  subtype: string;
  is_group: number;
  is_active: number;
}

export class MizanClient {
  private cookie: string | null = null;
  constructor(
    private readonly base: string,
    private readonly username: string,
    private readonly password: string,
  ) {}

  private async login(): Promise<void> {
    const r = await jsonFetch(`${this.base}/api/auth/login`, { method: 'POST', body: { username: this.username, password: this.password } });
    if (r.status !== 200) businessError(r, 'Mizan login');
    const sid = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith('mizan_sid='));
    if (!sid) throw new Error('Mizan login returned no session cookie');
    this.cookie = sid;
  }

  async call(method: string, path: string, body?: unknown): Promise<JsonResponse> {
    if (!this.cookie) await this.login();
    let r = await jsonFetch(`${this.base}/api${path}`, { method, body, headers: { cookie: this.cookie! } });
    if (r.status === 401) {
      await this.login();
      r = await jsonFetch(`${this.base}/api${path}`, { method, body, headers: { cookie: this.cookie! } });
    }
    return r;
  }

  async ok<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await this.call(method, path, body);
    if (r.status >= 400) businessError(r, `${method} ${path}`);
    return r.body as T;
  }

  items = () => this.ok<MizanItem[]>('GET', '/items');
  warehouses = () => this.ok<MizanWarehouse[]>('GET', '/inventory/warehouses');
  accounts = () => this.ok<MizanAccount[]>('GET', '/accounts');

  /** The stock document carrying exactly this reference, if one exists (idempotency across crashes). */
  async operationByReference(ref: string): Promise<{ id: number } | null> {
    const r = await this.ok<{ rows: { id: number; reference: string | null; status: string }[] }>('GET', `/inventory/operations?q=${encodeURIComponent(ref)}&limit=50`);
    const hit = r.rows.filter((x) => x.reference === ref && x.status !== 'draft');
    if (hit.length > 1) throw new Error(`more than one Mizan document carries ${ref}: ${hit.map((h) => h.id).join(', ')}`);
    return hit[0] ?? null;
  }

  async journalByReference(ref: string): Promise<{ id: number; number: string } | null> {
    const r = await this.ok<{ rows: { id: number; number: string; reference: string | null; status: string }[] }>('GET', `/journal?q=${encodeURIComponent(ref)}&limit=50`);
    const hit = r.rows.filter((x) => x.reference === ref && x.status === 'posted');
    if (hit.length > 1) throw new Error(`more than one journal entry carries ${ref}`);
    return hit[0] ?? null;
  }

  operation = (id: number) =>
    this.ok<{ id: number; number: string; status: string; lines: { value: number; qty: number }[] }>('GET', `/inventory/operations/${id}`);
  journal = (id: number) => this.ok<{ id: number; number: string; lines: { account_id: number; debit: number; credit: number }[] }>('GET', `/journal/${id}`);
}
