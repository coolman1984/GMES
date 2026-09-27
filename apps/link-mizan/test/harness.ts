import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp, type App } from '../../mes-server/src/app.js';
import { addKey } from '../../mes-server/src/modules/system/index.js';

/** Where the real Mizan lives: MIZAN_DIR, else .cache/mizan (scripts/fetch-mizan.sh), else a sibling checkout. */
export function mizanDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [process.env.MIZAN_DIR, resolve(here, '../../../.cache/mizan'), resolve(here, '../../../../coolman1984/accounting-sys')];
  return candidates.find((d) => d && existsSync(join(d, 'apps/server/src/main.ts')) && existsSync(join(d, 'node_modules'))) ?? null;
}

async function freePort(): Promise<number> {
  return new Promise((ok) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => ok(p));
    });
  });
}

/** A real Mizan process on its own data folder; stop() and start() keep the data (outage tests). */
export class MizanProcess {
  private child: ChildProcess | null = null;
  readonly dataDir = mkdtempSync(join(tmpdir(), 'mizan-e2e-'));
  url = '';
  private port = 0;
  constructor(private readonly dir: string) {}

  async start() {
    this.port ||= await freePort();
    this.url = `http://127.0.0.1:${this.port}`;
    this.child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', 'src/main.ts'], {
      cwd: join(this.dir, 'apps/server'),
      env: { ...process.env, MIZAN_PORT: String(this.port), MIZAN_HOST: '127.0.0.1', MIZAN_DATA_DIR: this.dataDir, MIZAN_LOG_LEVEL: 'silent' },
      stdio: 'ignore',
    });
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try {
        if ((await fetch(`${this.url}/api/health`)).ok) return;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('Mizan did not start');
  }

  async stop() {
    if (!this.child) return;
    const c = this.child;
    this.child = null;
    await new Promise<void>((ok) => {
      c.once('exit', () => ok());
      c.kill('SIGTERM');
    });
  }
}

/** Admin session on Mizan for the test's own setup and checks (the link uses its own restricted user). */
export class MizanAdmin {
  private cookie = '';
  constructor(private readonly url: string) {}
  async setup() {
    const r = await this.req('POST', '/api/setup', {
      company: { name: 'Nile Chairs', baseCurrency: 'EGP', moneyScale: 2 }, fiscalYearStart: '2026-01-01',
      admin: { username: 'admin', displayName: 'Admin', password: 'password123' }, locale: 'en', seedChartOfAccounts: true, vatRateBp: 1400,
    });
    if (r.status !== 200) throw new Error('setup ' + JSON.stringify(r.body));
    await this.login('admin', 'password123');
  }
  async login(u: string, p: string) {
    const res = await fetch(`${this.url}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
    this.cookie = res.headers.getSetCookie().map((c) => c.split(';')[0] ?? '').find((c) => c.startsWith('mizan_sid='))!;
  }
  async req(method: string, path: string, body?: unknown) {
    const res = await fetch(this.url + path, {
      method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), cookie: this.cookie }, body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
  async ok(method: string, path: string, body?: unknown) {
    const r = await this.req(method, path, body);
    if (r.status >= 400) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }
}

export async function mesServer(companyId: string): Promise<{ app: App; url: string; linkKey: string; opKey: string; adminKey: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'gmes-e2e-'));
  const app = await buildApp({
    dbFile: join(dir, 'gmes.db'),
    config: { companyId, node: 'plant-1', timeZone: 'Africa/Cairo', productionDayStart: '07:00', ownership: { item: 'mizan', warehouse: 'mizan' } },
  });
  const linkKey = await addKey(app.ctx, 'link-mizan', ['eco.feed.read', 'eco.inbox.write', 'eco.acks.write']);
  const opKey = await addKey(app.ctx, 'station-3', ['exe.orders.write', 'exe.orders.read', 'mdm.items.read']);
  const adminKey = await addKey(app.ctx, 'admin', ['*']);
  const port = await freePort();
  await app.http.listen({ port, host: '127.0.0.1' });
  return { app, url: `http://127.0.0.1:${port}`, linkKey, opKey, adminKey };
}
