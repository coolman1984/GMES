import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { openReadOnly, type Database } from './kernel/db.js';
import { conflict, fail, notFound } from './kernel/errors.js';
import type { AppModule, Ctx, RouteKit } from './kernel/modules.js';
import { ROLE_SCOPES, ROLES } from './modules/system/roles.js';

/**
 * Operations of the whole installation (not of one module): backups (SYS9070), the installation's settings (SYS9060),
 * the roles matrix (SYS9020) and the fact chains of every module (SYS9090). ADR-028 / ADR-037.
 *
 * A backup is a consistent copy of the committed database (VACUUM INTO on the reader: production does not stop), and
 * it is not called a backup until it has been REHEARSED: opened read-only elsewhere, integrity-checked, every module's
 * health checks (hash chains, units against the ledger, …) run against the copy, and its row counts written next to it.
 * "Verify" repeats the rehearsal later and compares the counts, so a copy that rotted on disk is found before the day
 * it is needed. Restoring is done with the server stopped (docs/operations), never from a web page, and nothing here
 * deletes a backup.
 */
export interface Rehearsal { ok: boolean; integrity: string; checks: { module: string; id: string; ok: boolean }[]; tables: Record<string, number>; mismatches: string[] }

export async function rehearse(file: string, ctx: Ctx, modules: AppModule[], expected?: Record<string, number>): Promise<Rehearsal> {
  const db = openReadOnly(file);
  try {
    const integrity = (await db.all<{ integrity_check: string }>('PRAGMA integrity_check')).map((r) => r.integrity_check).join('; ');
    const tables: Record<string, number> = {};
    for (const { name } of await db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)) {
      tables[name] = (await db.get<{ n: number }>(`SELECT COUNT(*) n FROM "${name.replace(/"/g, '""')}"`))!.n;
    }
    // the modules' own checks, against the copy: the same code that watches the live database
    const copy: Ctx = { ...ctx, db: { ...db, tx: () => Promise.reject(new Error('read-only')), close: () => undefined, file, snapshot: () => Promise.reject(new Error('read-only')) } as Database };
    const checks: Rehearsal['checks'] = [];
    for (const m of modules) {
      if (!m.health) continue;
      try { for (const c of await m.health(copy)) checks.push({ module: m.id, id: c.id, ok: c.ok }); }
      catch { checks.push({ module: m.id, id: 'health', ok: false }); }
    }
    const mismatches = expected ? Object.keys({ ...expected, ...tables }).filter((k) => expected[k] !== tables[k]).map((k) => `${k}: ${expected[k] ?? '—'} → ${tables[k] ?? '—'}`) : [];
    return { ok: integrity === 'ok' && checks.every((c) => c.ok) && mismatches.length === 0, integrity, checks, tables, mismatches };
  } finally { db.close(); }
}

export function opsRoutes({ http, require }: RouteKit, ctx: Ctx, modules: AppModule[], db: Database, backupDir: string, version: string) {
  const dir = resolve(backupDir);
  const manifest = (f: string) => join(dir, basename(f, '.db') + '.json');
  const list = () => (existsSync(dir) ? readdirSync(dir).filter((f) => /^gmes-.*\.db$/.test(f)).sort().reverse() : []).map((f) => {
    const m = existsSync(manifest(f)) ? JSON.parse(readFileSync(manifest(f), 'utf8')) : null;
    return { name: f, bytes: statSync(join(dir, f)).size, createdAt: m?.createdAt ?? null, by: m?.by ?? null, ok: m?.rehearsal?.ok ?? null,
      verifiedAt: m?.verifiedAt ?? m?.createdAt ?? null, rows: m ? Object.values(m.rehearsal.tables as Record<string, number>).reduce((a, n) => a + n, 0) : null };
  });

  http.get('/api/system/backups', async (req) => {
    require(req, 'system.backup');
    return { dir, backups: list() };
  });

  http.post('/api/system/backups', async (req) => {
    const caller = require(req, 'system.backup');
    mkdirSync(dir, { recursive: true });
    const now = ctx.clock.now();
    const name = `gmes-${ctx.config.node}-${now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}-${randomUUID()}.db`.replace(/[^A-Za-z0-9._-]/g, '_');
    const file = join(dir, name);
    if (existsSync(file)) conflict('backup.exists', `${name} exists: wait a second and try again`);
    await db.snapshot(file);
    const rehearsal = await rehearse(file, ctx, modules);
    writeFileSync(manifest(file), JSON.stringify({ name, createdAt: now.toISOString(), by: caller.name, version, rehearsal }, null, 2));
    await db.tx((t) => ctx.services.get('sys').audit(t, caller.name, 'backup.create', name, { ok: rehearsal.ok }));
    return { name, bytes: statSync(file).size, rehearsal };
  });

  http.post('/api/system/backups/:name/verify', async (req) => {
    const caller = require(req, 'system.backup');
    const { name } = z.object({ name: z.string().regex(/^gmes-[A-Za-z0-9._-]+\.db$/) }).parse(req.params);
    const file = join(dir, name);
    if (!existsSync(file)) return notFound('backup', name);
    if (!existsSync(manifest(file))) fail('backup.no_manifest', `${name} has no record of what it held; it cannot be verified`);
    const m = JSON.parse(readFileSync(manifest(file), 'utf8'));
    const rehearsal = await rehearse(file, ctx, modules, m.rehearsal.tables);
    writeFileSync(manifest(file), JSON.stringify({ ...m, verifiedAt: ctx.clock.now().toISOString(), lastVerify: rehearsal }, null, 2));
    await db.tx((t) => ctx.services.get('sys').audit(t, caller.name, 'backup.verify', name, { ok: rehearsal.ok }));
    return { name, rehearsal };
  });

  // SYS9060: what this installation is (read-only: it is set in data/config.json by the start script)
  http.get('/api/system/info', async (req) => {
    require(req, 'system.health.read');
    const migrations = await db.all<{ module: string; n: number; last: string }>('SELECT module, COUNT(*) n, MAX(applied_at) last FROM _migrations GROUP BY module');
    return { version, node: ctx.config.node, companyId: ctx.config.companyId, timeZone: ctx.config.timeZone, productionDayStart: ctx.config.productionDayStart,
      ownership: ctx.config.ownership, database: { file: basename(db.file), bytes: existsSync(db.file) ? statSync(db.file).size : null }, backupDir: dir,
      modules: modules.map((m) => ({ id: m.id, dependsOn: m.dependsOn ?? [], scopes: m.scopes ?? [], migrations: migrations.find((x) => x.module === m.id)?.n ?? 0 })) };
  });

  // SYS9020: the roles and what each may do (roles are defined in code; a person holds one)
  http.get('/api/system/roles', async (req) => {
    require(req, 'sys.users.read');
    const scopes = [...new Set(modules.flatMap((m) => m.scopes ?? []).concat(Object.values(ROLE_SCOPES).flat().filter((s) => s !== '*')))].sort();
    return { roles: ROLES.map((r) => ({ role: r, scopes: ROLE_SCOPES[r] })), scopes };
  });
}
