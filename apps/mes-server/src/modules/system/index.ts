import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, conflict, notFound } from '../../kernel/errors.js';
import type { AppModule, Caller, Ctx } from '../../kernel/modules.js';
import { audit, sessionCaller, signature, userRoutes, usersMigration } from './users.js';

/**
 * Keys for links (other apps' connectors), station devices and administrators.
 * Only a SHA-256 of a key is stored; the key itself is shown once when it is created.
 * Every request's scope is checked here, on the server.
 */
const hash = (key: string) => createHash('sha256').update(key).digest();

export function newKey(): string {
  return 'gk_' + randomBytes(24).toString('base64url');
}

export async function addKey(ctx: Ctx, name: string, scopes: string[], key = newKey()): Promise<string> {
  await ctx.db.run('INSERT INTO sys_key (name, key_hash, scopes, created_at) VALUES (?, ?, ?, ?)', [
    name, hash(key), scopes.join(' '), ctx.clock.now().toISOString(),
  ]);
  return key;
}

/** An API key (x-eco-key) when one is sent, else the session of a person signed in through the screens. */
export async function resolveCaller(ctx: Ctx, req: FastifyRequest): Promise<Caller | null> {
  const header = req.headers['x-eco-key'];
  if (header === undefined) return sessionCaller(ctx, req);
  if (typeof header !== 'string' || !header.startsWith('gk_')) return null;
  const h = hash(header);
  const row = await ctx.db.get<{ name: string; key_hash: Uint8Array; scopes: string; active: number }>(
    'SELECT name, key_hash, scopes, active FROM sys_key WHERE key_hash = ?', [h],
  );
  if (!row || !row.active || !timingSafeEqual(Buffer.from(row.key_hash), h)) return null;
  return { name: row.name, scopes: new Set(row.scopes.split(' ')) };
}

export function requireScope(caller: Caller | null, scope: string): Caller {
  if (!caller) throw new AppError(401, 'auth.required', 'Sign in, or send a valid x-eco-key header');
  const [mod] = scope.split('.');
  if (!caller.scopes.has(scope) && !caller.scopes.has(`${mod}.*`) && !caller.scopes.has('*')) {
    throw new AppError(403, 'auth.forbidden', `This key may not ${scope}`);
  }
  return caller;
}

export const systemModule: AppModule = {
  id: 'system',
  scopes: ['sys.users.read', 'sys.users.write', 'sys.audit.read', 'sys.keys.read', 'sys.keys.write', 'system.health.read', 'system.backup'],
  setup(ctx) {
    ctx.services.provide('sys', {
      sign: (caller, password) => signature(ctx, caller, password),
      audit: (t, actor, action, target, details) => audit(t, ctx, actor, action, target, details),
    });
  },
  routes(kit, ctx) {
    userRoutes(kit, ctx, kit.caller as (req: object) => Caller | null);
    keyRoutes(kit, ctx);
  },
  migrations: [
    {
      id: '001_keys',
      up: `
        CREATE TABLE sys_key (
          id         INTEGER PRIMARY KEY,
          name       TEXT NOT NULL UNIQUE,
          key_hash   BLOB NOT NULL UNIQUE,
          scopes     TEXT NOT NULL,
          active     INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL
        );
        -- Idempotency of commands: the same command id is executed once, whatever the network does.
        CREATE TABLE sys_command (
          command_id   TEXT PRIMARY KEY,
          command_type TEXT NOT NULL,
          request_hash TEXT NOT NULL,
          result       TEXT NOT NULL,
          caller       TEXT NOT NULL,
          created_at   TEXT NOT NULL
        );
      `,
    },
    usersMigration,
  ],
};

/** SYS9030: the keys of links and devices. The key is shown once, at creation; the list never carries a key or its hash. */
function keyRoutes({ http, require }: Parameters<NonNullable<AppModule['routes']>>[0], ctx: Ctx) {
  http.get('/api/keys', async (req) => {
    require(req, 'sys.keys.read');
    return (await ctx.db.all<{ id: number; name: string; scopes: string; active: number; created_at: string }>('SELECT id, name, scopes, active, created_at FROM sys_key ORDER BY active DESC, name'))
      .map((k) => ({ ...k, scopes: k.scopes.split(' ') }));
  });
  http.post('/api/keys', async (req) => {
    const caller = require(req, 'sys.keys.write');
    const input = z.object({ name: z.string().trim().regex(/^[A-Za-z0-9._-]{3,60}$/, '3 to 60 letters, digits, . _ -'),
      scopes: z.array(z.string().regex(/^(\*|[a-z]+\.(\*|[a-z_]+(\.[a-z_*]+)?))$/, 'a scope like exe.orders.read or trk.*')).min(1).max(40) }).parse(req.body);
    if (await ctx.db.get('SELECT 1 FROM sys_key WHERE name = ?', [input.name])) conflict('key.name_taken', `a key named ${input.name} exists; keys are never renamed or reused`);
    const key = await addKey(ctx, input.name, input.scopes);
    await ctx.db.tx((t) => audit(t, ctx, caller.name, 'key.create', input.name, { scopes: input.scopes }));
    return { name: input.name, key, note: 'shown once: store it in the device or link now' };
  });
  http.post('/api/keys/:name/revoke', async (req) => {
    const caller = require(req, 'sys.keys.write');
    const { name } = req.params as { name: string };
    await ctx.db.tx(async (t) => {
      const k = (await t.get<{ active: number }>('SELECT active FROM sys_key WHERE name = ?', [name])) ?? notFound('key', name);
      if (!k.active) conflict('key.revoked', `key ${name} is already revoked`);
      await t.run('UPDATE sys_key SET active = 0 WHERE name = ?', [name]);
      await audit(t, ctx, caller.name, 'key.revoke', name);
    });
    return { name, active: false };
  });
}
