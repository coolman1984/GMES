import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { productionDate } from '../../kernel/clock.js';
import type { Db } from '../../kernel/db.js';
import { AppError, conflict, fail, forbidden, notFound } from '../../kernel/errors.js';
import type { Caller, Ctx, RouteKit } from '../../kernel/modules.js';
import { ROLES, ROLE_SCOPES, type Role } from './roles.js';

/**
 * People who sign in to the screens: local accounts with a password, one role each, and a session cookie.
 *
 * - Passwords are stored only as scrypt hashes (salted); a session token only as its SHA-256.
 * - The cookie is HttpOnly and SameSite=Strict: another site cannot make the browser use it.
 * - Five wrong passwords lock the account; an administrator unlocks it.
 * - The first account (an administrator) is created from the screen when there is none (`/api/setup`).
 * - Every change to an account is written to sys_audit (who, what, when); nothing there is ever updated.
 */
export const COOKIE = 'gmes_sid';
const SESSION_HOURS = 12;
const MAX_FAILED = 5;

const scrypt = (password: string, salt: Buffer, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((ok, ko) => scryptCb(password, salt, keylen, opts, (err, key) => (err ? ko(err) : ok(key))));

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = await scrypt(password, Buffer.from(salt, 'base64'), want.length, { N: Number(n), r: Number(r), p: Number(p) });
  return got.length === want.length && timingSafeEqual(got, want);
}
// compared against when the login does not exist, so an unknown login takes as long as a wrong password
const DUMMY = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

const tokenHash = (token: string) => createHash('sha256').update(token).digest();

export interface UserRow {
  id: string;
  login: string;
  name: string;
  role: Role;
  area: string | null;
  language: 'ar' | 'en';
  status: 'active' | 'locked' | 'inactive';
  password_hash: string;
  must_change: number;
  failed: number;
  created_at: string;
  last_sign_in_at: string | null;
}

const zLogin = z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,50}$/, 'login: 3-50 lower-case letters, digits, dot, dash or underscore');
const zPassword = z.string().min(8, 'password: at least 8 characters').max(200);
const zName = z.string().trim().min(1).max(120);
const zRole = z.enum(ROLES);
const zLang = z.enum(['ar', 'en']);
const zArea = z.string().trim().max(40).nullable().optional();

export const usersMigration = {
  id: '002_users',
  up: `
    CREATE TABLE sys_user (
      id              TEXT PRIMARY KEY,
      login           TEXT NOT NULL UNIQUE,
      name            TEXT NOT NULL,
      role            TEXT NOT NULL,
      area            TEXT,
      language        TEXT NOT NULL DEFAULT 'ar',
      status          TEXT NOT NULL CHECK (status IN ('active', 'locked', 'inactive')),
      password_hash   TEXT NOT NULL,
      must_change     INTEGER NOT NULL DEFAULT 1,
      failed          INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL,
      last_sign_in_at TEXT
    );
    CREATE TABLE sys_session (
      token_hash BLOB PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES sys_user(id),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX sys_session_user ON sys_session(user_id);
    -- who changed which account, when: append-only
    CREATE TABLE sys_audit (
      seq     INTEGER PRIMARY KEY,
      at      TEXT NOT NULL,
      actor   TEXT NOT NULL,
      action  TEXT NOT NULL,
      target  TEXT NOT NULL,
      details TEXT
    );
    CREATE TRIGGER sys_audit_immutable BEFORE UPDATE ON sys_audit BEGIN SELECT RAISE(ABORT, 'sys: the audit log is append-only'); END;
    CREATE TRIGGER sys_audit_no_delete BEFORE DELETE ON sys_audit BEGIN SELECT RAISE(ABORT, 'sys: the audit log is append-only'); END;
  `,
};

function cookieToken(req: FastifyRequest): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=') || null;
  }
  return null;
}

/** The person behind a session cookie, or null (no cookie, unknown, expired, or the account is no longer active). */
export async function sessionCaller(ctx: Ctx, req: FastifyRequest): Promise<Caller | null> {
  const token = cookieToken(req);
  if (!token) return null;
  const row = await ctx.db.get<UserRow & { expires_at: string }>(
    `SELECT u.*, s.expires_at FROM sys_session s JOIN sys_user u ON u.id = s.user_id WHERE s.token_hash = ?`, [tokenHash(token)],
  );
  if (!row || row.status !== 'active' || row.expires_at <= ctx.clock.now().toISOString()) return null;
  return { name: row.login, scopes: new Set(ROLE_SCOPES[row.role] ?? []), user: { id: row.id, login: row.login, role: row.role } };
}

async function audit(t: Db, ctx: Ctx, actor: string, action: string, target: string, details?: unknown) {
  await t.run('INSERT INTO sys_audit (at, actor, action, target, details) VALUES (?, ?, ?, ?, ?)', [
    ctx.clock.now().toISOString(), actor, action, target, details === undefined ? null : JSON.stringify(details),
  ]);
}

async function startSession(t: Db, ctx: Ctx, reply: FastifyReply, userId: string) {
  const token = randomBytes(32).toString('base64url');
  const now = ctx.clock.now();
  const expires = new Date(now.getTime() + SESSION_HOURS * 3600_000);
  await t.run('INSERT INTO sys_session (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', [tokenHash(token), userId, now.toISOString(), expires.toISOString()]);
  reply.header('set-cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}`);
}

const present = (u: UserRow) => ({
  id: u.id, login: u.login, name: u.name, role: u.role, area: u.area, language: u.language, status: u.status,
  mustChangePassword: !!u.must_change, createdAt: u.created_at, lastSignInAt: u.last_sign_in_at,
});

/** The screens' view of the installation: what the start page and every screen need before the first query. */
function plantInfo(ctx: Ctx) {
  const c = ctx.config;
  return {
    companyId: c.companyId, node: c.node, timeZone: c.timeZone, productionDayStart: c.productionDayStart,
    today: productionDate(ctx.clock.now(), c.timeZone, c.productionDayStart),
    itemOwner: c.ownership.item, personOwner: c.ownership.person ?? 'none',
  };
}

export function userRoutes({ http, require }: RouteKit, ctx: Ctx, callerOf: (req: object) => Caller | null) {
  const countUsers = async () => (await ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM sys_user'))!.n;

  // Anyone may ask whether the installation is set up and who they are; nothing else is readable without a session.
  http.get('/api/auth/state', async (req) => {
    const c = callerOf(req);
    const me = c?.user ? await ctx.db.get<UserRow>('SELECT * FROM sys_user WHERE id = ?', [c.user.id]) : undefined;
    return { needsSetup: (await countUsers()) === 0, user: me ? { ...present(me), scopes: [...(ROLE_SCOPES[me.role] ?? [])] } : null, plant: plantInfo(ctx) };
  });

  // The first administrator, from the screen, only while there is no account at all.
  http.post('/api/setup', async (req, reply) => {
    const input = z.object({ login: zLogin, name: zName, password: zPassword, language: zLang.default('ar') }).parse(req.body);
    const hash = await hashPassword(input.password);
    return ctx.db.tx(async (t) => {
      if ((await t.get<{ n: number }>('SELECT COUNT(*) n FROM sys_user'))!.n > 0) conflict('setup.done', 'This installation already has accounts: sign in');
      const id = ctx.clock.newId();
      const now = ctx.clock.now().toISOString();
      await t.run(
        `INSERT INTO sys_user (id, login, name, role, language, status, password_hash, must_change, created_at, last_sign_in_at) VALUES (?, ?, ?, 'ADMIN', ?, 'active', ?, 0, ?, ?)`,
        [id, input.login, input.name, input.language, hash, now, now],
      );
      await audit(t, ctx, input.login, 'setup', input.login, { role: 'ADMIN' });
      await startSession(t, ctx, reply, id);
      return { ok: true };
    });
  });

  http.post('/api/auth/login', async (req, reply) => {
    const input = z.object({ login: z.string().trim().toLowerCase().min(1).max(50), password: z.string().min(1).max(200) }).parse(req.body);
    const u = await ctx.db.get<UserRow>('SELECT * FROM sys_user WHERE login = ?', [input.login]);
    const ok = await checkPassword(input.password, u?.password_hash ?? DUMMY);
    const wrong = () => { throw new AppError(401, 'auth.invalid', 'Wrong login or password'); };
    if (!u) return wrong();
    if (u.status === 'inactive') throw new AppError(403, 'auth.inactive', 'This account is deactivated: ask an administrator');
    if (u.status === 'locked') throw new AppError(403, 'auth.locked', 'This account is locked: ask an administrator to unlock it');
    if (!ok) {
      // the count is committed BEFORE the refusal is thrown: an error inside the transaction would roll it back
      const locked = await ctx.db.tx(async (t) => {
        const failed = (await t.get<{ failed: number }>('SELECT failed FROM sys_user WHERE id = ?', [u.id]))!.failed + 1;
        const lock = failed >= MAX_FAILED;
        await t.run(`UPDATE sys_user SET failed = ?, status = CASE WHEN ? THEN 'locked' ELSE status END WHERE id = ?`, [failed, lock ? 1 : 0, u.id]);
        if (lock) await audit(t, ctx, 'system', 'lock', u.login, { reason: `${MAX_FAILED} wrong passwords` });
        return lock;
      });
      return locked ? forbidden('auth.locked', `Wrong password ${MAX_FAILED} times: the account is now locked; ask an administrator`) : wrong();
    }
    return ctx.db.tx(async (t) => {
      await t.run('UPDATE sys_user SET failed = 0, last_sign_in_at = ? WHERE id = ?', [ctx.clock.now().toISOString(), u.id]);
      await startSession(t, ctx, reply, u.id);
      return { ok: true, mustChangePassword: !!u.must_change };
    });
  });

  http.post('/api/auth/logout', async (req, reply) => {
    const token = cookieToken(req);
    if (token) await ctx.db.run('DELETE FROM sys_session WHERE token_hash = ?', [tokenHash(token)]);
    reply.header('set-cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    return { ok: true };
  });

  http.post('/api/auth/password', async (req) => {
    const c = callerOf(req);
    if (!c?.user) throw new AppError(401, 'auth.required', 'Sign in first');
    const input = z.object({ current: z.string().min(1), next: zPassword }).parse(req.body);
    const u = (await ctx.db.get<UserRow>('SELECT * FROM sys_user WHERE id = ?', [c.user.id]))!;
    if (!(await checkPassword(input.current, u.password_hash))) fail('auth.wrong_password', 'The current password is not right');
    if (input.current === input.next) fail('auth.same_password', 'Choose a password different from the current one');
    const hash = await hashPassword(input.next);
    await ctx.db.tx(async (t) => {
      await t.run('UPDATE sys_user SET password_hash = ?, must_change = 0 WHERE id = ?', [hash, u.id]);
      await audit(t, ctx, u.login, 'password', u.login);
    });
    return { ok: true };
  });

  // ---------------------------------------------------------------- administration of accounts
  http.get('/api/users', async (req) => {
    require(req, 'sys.users.read');
    const q = z.object({ text: z.string().optional(), role: zRole.optional().or(z.literal('')), status: z.enum(['active', 'locked', 'inactive']).optional().or(z.literal('')), area: z.string().optional() }).parse(req.query);
    const rows = await ctx.db.all<UserRow>('SELECT * FROM sys_user ORDER BY login');
    const text = (q.text ?? '').trim().toLowerCase();
    return rows.filter((u) => (!text || (u.login + ' ' + u.name).toLowerCase().includes(text)) && (!q.role || u.role === q.role) && (!q.status || u.status === q.status) && (!q.area || u.area === q.area)).map(present);
  });

  http.post('/api/users', async (req) => {
    const caller = require(req, 'sys.users.write');
    const input = z.object({ login: zLogin, name: zName, role: zRole, area: zArea, language: zLang.default('ar'), password: zPassword }).parse(req.body);
    const hash = await hashPassword(input.password);
    return ctx.db.tx(async (t) => {
      if (await t.get('SELECT 1 FROM sys_user WHERE login = ?', [input.login])) conflict('user.login_taken', `login ${input.login} exists`);
      const id = ctx.clock.newId();
      await t.run(
        `INSERT INTO sys_user (id, login, name, role, area, language, status, password_hash, must_change, created_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 1, ?)`,
        [id, input.login, input.name, input.role, input.area || null, input.language, hash, ctx.clock.now().toISOString()],
      );
      await audit(t, ctx, caller.name, 'create', input.login, { role: input.role });
      return { id };
    });
  });

  http.patch('/api/users/:id', async (req) => {
    const caller = require(req, 'sys.users.write');
    const { id } = req.params as { id: string };
    const input = z.object({ name: zName.optional(), role: zRole.optional(), area: zArea, language: zLang.optional(), status: z.enum(['active', 'locked', 'inactive']).optional() }).parse(req.body);
    return ctx.db.tx(async (t) => {
      const u = (await t.get<UserRow>('SELECT * FROM sys_user WHERE id = ?', [id])) ?? notFound('user', id);
      if (caller.user?.id === u.id && ((input.status && input.status !== 'active') || (input.role && input.role !== u.role))) {
        conflict('user.self', 'You cannot lock, deactivate or change the role of your own account');
      }
      const next = { ...u, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) } as UserRow;
      if (u.role === 'ADMIN' && u.status === 'active' && (next.role !== 'ADMIN' || next.status !== 'active')) {
        const admins = (await t.get<{ n: number }>(`SELECT COUNT(*) n FROM sys_user WHERE role = 'ADMIN' AND status = 'active'`))!.n;
        if (admins <= 1) conflict('user.last_admin', 'This is the last active administrator');
      }
      await t.run('UPDATE sys_user SET name = ?, role = ?, area = ?, language = ?, status = ?, failed = ? WHERE id = ?', [
        next.name, next.role, input.area === undefined ? u.area : input.area || null, next.language, next.status, next.status === 'active' ? 0 : u.failed, id,
      ]);
      if (next.status !== 'active') await t.run('DELETE FROM sys_session WHERE user_id = ?', [id]);  // a locked person is signed out now
      await audit(t, ctx, caller.name, 'update', u.login, input);
      return present({ ...next, area: input.area === undefined ? u.area : input.area || null });
    });
  });

  http.post('/api/users/:id/password', async (req) => {
    const caller = require(req, 'sys.users.write');
    const { id } = req.params as { id: string };
    const input = z.object({ password: zPassword }).parse(req.body);
    const hash = await hashPassword(input.password);
    await ctx.db.tx(async (t) => {
      const u = (await t.get<UserRow>('SELECT * FROM sys_user WHERE id = ?', [id])) ?? notFound('user', id);
      await t.run('UPDATE sys_user SET password_hash = ?, must_change = 1, failed = 0 WHERE id = ?', [hash, id]);
      await t.run('DELETE FROM sys_session WHERE user_id = ?', [id]);
      await audit(t, ctx, caller.name, 'reset_password', u.login);
    });
    return { ok: true };
  });

  http.get('/api/audit', async (req) => {
    require(req, 'sys.audit.read');
    return ctx.db.all('SELECT seq, at, actor, action, target, details FROM sys_audit ORDER BY seq DESC LIMIT 500');
  });
}
