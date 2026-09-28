import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../../kernel/errors.js';
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
  scopes: ['sys.users.read', 'sys.users.write', 'sys.audit.read'],
  setup(ctx) {
    ctx.services.provide('sys', {
      sign: (caller, password) => signature(ctx, caller, password),
      audit: (t, actor, action, target, details) => audit(t, ctx, actor, action, target, details),
    });
  },
  routes(kit, ctx) {
    userRoutes(kit, ctx, kit.caller as (req: object) => Caller | null);
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
