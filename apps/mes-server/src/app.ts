import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { systemClock, type Clock } from './kernel/clock.js';
import { openSqlite, type Database } from './kernel/db.js';
import { AppError } from './kernel/errors.js';
import { Services, type AppModule, type Config, type Ctx } from './kernel/modules.js';
import { ecoModule } from './modules/eco/index.js';
import { exeModule } from './modules/exe/index.js';
import { mdmModule } from './modules/mdm/index.js';
import { requireScope, resolveCaller, systemModule } from './modules/system/index.js';
import { serveScreens } from './web.js';

/** Installed modules. Removing one (and what depends on it) must leave a working app. */
export const MODULES: AppModule[] = [systemModule, mdmModule, ecoModule, exeModule];

export interface App {
  http: FastifyInstance;
  ctx: Ctx;
  close(): Promise<void>;
}

export async function buildApp(opts: { dbFile: string; config: Config; clock?: Clock; logger?: boolean }): Promise<App> {
  const db = openSqlite(opts.dbFile);
  const ctx: Ctx = { db, clock: opts.clock ?? systemClock, config: opts.config, services: new Services() };
  const modules = ordered(MODULES);
  await migrate(db, modules);
  for (const m of modules) m.setup?.(ctx);

  const http = Fastify({ logger: opts.logger ?? false, bodyLimit: 5 * 1024 * 1024 });
  // Resolve the caller once per request; routes then require the scope they need.
  const callers = new WeakMap<object, Awaited<ReturnType<typeof resolveCaller>>>();
  http.addHook('preHandler', async (req) => {
    callers.set(req, await resolveCaller(ctx, req));
  });
  const kit = { http, require: (req: object, scope: string) => requireScope(callers.get(req) ?? null, scope) };
  for (const m of modules) m.routes?.(kit, ctx);

  // the screens: the shell and its screen templates (UX phase), same origin as the API
  serveScreens(http);
  http.get('/api/health', async () => ({ ok: true, name: 'gmes', company: ctx.config.companyId }));
  http.get('/api/system/health', async (req) => {
    kit.require(req, 'system.health.read');
    const out: Record<string, unknown> = {};
    for (const m of modules) if (m.health) out[m.id] = await m.health(ctx);
    return out;
  });

  http.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code, message: err.message, ...(err.details ?? {}) } });
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: { code: 'validation', message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: { code: 'request', message: (err as Error).message } });
    http.log.error(err);
    return reply.status(500).send({ error: { code: 'internal', message: 'Internal error' } });
  });

  return { http, ctx, close: async () => { await http.close(); db.close(); } };
}

/** Dependencies first; a module whose dependency is missing is a build error, not a runtime surprise. */
export function ordered(mods: AppModule[]): AppModule[] {
  const byId = new Map(mods.map((m) => [m.id, m]));
  const out: AppModule[] = [];
  const seen = new Set<string>();
  const visit = (m: AppModule, path: string[]) => {
    if (seen.has(m.id)) return;
    if (path.includes(m.id)) throw new Error(`module cycle: ${[...path, m.id].join(' -> ')}`);
    for (const d of m.dependsOn ?? []) {
      const dep = byId.get(d);
      if (!dep) throw new Error(`module ${m.id} needs ${d}, which is not installed`);
      visit(dep, [...path, m.id]);
    }
    seen.add(m.id);
    out.push(m);
  };
  for (const m of mods) visit(m, []);
  return out;
}

async function migrate(db: Database, modules: AppModule[]) {
  await db.exec('CREATE TABLE IF NOT EXISTS _migrations (module TEXT NOT NULL, id TEXT NOT NULL, applied_at TEXT NOT NULL, PRIMARY KEY (module, id))');
  for (const m of modules) {
    for (const mig of m.migrations ?? []) {
      await db.tx(async (t) => {
        if (await t.get('SELECT 1 FROM _migrations WHERE module = ? AND id = ?', [m.id, mig.id])) return;
        await t.exec(mig.up);
        await t.run('INSERT INTO _migrations (module, id, applied_at) VALUES (?, ?, ?)', [m.id, mig.id, new Date().toISOString()]);
      });
    }
  }
}
