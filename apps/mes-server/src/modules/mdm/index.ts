import { z } from 'zod';
import type { ItemV1, WarehouseV1 } from '@eco/contracts';
import type { MdmService, MirrorItem, MirrorWarehouse, SnapshotResult } from '../../contracts/services.js';
import type { Db } from '../../kernel/db.js';
import { conflict, fail, notFound } from '../../kernel/errors.js';
import type { AppModule, Ctx } from '../../kernel/modules.js';

/**
 * Master data manufacturing READS: items and warehouses.
 *
 * Their owner is accounting (Mizan) when it is installed; then these tables are read-only
 * mirrors fed by the owner's snapshots, and creating an item here is refused. When the company
 * bought manufacturing alone, manufacturing is the fallback owner and creates them itself
 * (docs/ecosystem/02-truth-ownership.md). A snapshot is applied only when its version is newer,
 * so re-delivery and reordering are harmless.
 */
const zLocalItem = z.object({
  code: z.string().trim().min(1).max(64),
  nameEn: z.string().trim().min(1).max(200),
  nameAr: z.string().trim().min(1).max(200),
  kind: z.enum(['product', 'service']).default('product'),
  tracking: z.enum(['none', 'lot', 'serial']).default('none'),
  baseUom: z.string().trim().min(1).max(20).default('PCS'),
});
const zLocalWarehouse = z.object({ code: z.string().trim().min(1).max(20), nameEn: z.string().trim().min(1), nameAr: z.string().trim().min(1) });

export const mdmModule: AppModule = {
  id: 'mdm',
  dependsOn: ['system'],
  scopes: ['mdm.items.read', 'mdm.items.write'],
  migrations: [
    {
      id: '001_mirrors',
      up: `
        CREATE TABLE mdm_item (
          id            TEXT PRIMARY KEY,           -- the OWNER's global id (ADR-017)
          code          TEXT NOT NULL,
          name_en       TEXT NOT NULL,
          name_ar       TEXT NOT NULL,
          kind          TEXT NOT NULL CHECK (kind IN ('product', 'service')),
          stock_tracked INTEGER NOT NULL,
          tracking      TEXT NOT NULL CHECK (tracking IN ('none', 'lot', 'serial')),
          base_uom      TEXT NOT NULL,
          active        INTEGER NOT NULL,
          version       INTEGER NOT NULL,
          owner         TEXT NOT NULL,              -- 'mizan' (mirror) | 'gmes' (fallback owner)
          origin_app    TEXT NOT NULL,
          origin_key    TEXT NOT NULL,
          mirrored_at   TEXT NOT NULL
        );
        CREATE INDEX mdm_item_code ON mdm_item(code);
        CREATE TABLE mdm_warehouse (
          id          TEXT PRIMARY KEY,
          code        TEXT NOT NULL,
          name_en     TEXT NOT NULL,
          name_ar     TEXT NOT NULL,
          active      INTEGER NOT NULL,
          is_default  INTEGER NOT NULL,
          version     INTEGER NOT NULL,
          owner       TEXT NOT NULL,
          origin_app  TEXT NOT NULL,
          origin_key  TEXT NOT NULL,
          mirrored_at TEXT NOT NULL
        );
      `,
    },
  ],

  setup(ctx) {
    const service: MdmService = {
      async item(id, t) {
        const row = await (t ?? ctx.db).get<MirrorItem>('SELECT * FROM mdm_item WHERE id = ?', [id]);
        return row ?? notFound('item', id);
      },
      async warehouse(id, t) {
        const row = await (t ?? ctx.db).get<MirrorWarehouse>('SELECT * FROM mdm_warehouse WHERE id = ?', [id]);
        return row ?? notFound('warehouse', id);
      },
      applyItem: (t, s) => apply(ctx, t, 'item', s),
      applyWarehouse: (t, s) => apply(ctx, t, 'warehouse', s),
    };
    ctx.services.provide('mdm', service);
  },

  routes({ http, require }, ctx) {
    http.get('/api/items', async (req) => {
      require(req, 'mdm.items.read');
      return ctx.db.all('SELECT * FROM mdm_item ORDER BY code');
    });
    http.get('/api/warehouses', async (req) => {
      require(req, 'mdm.items.read');
      return ctx.db.all('SELECT * FROM mdm_warehouse ORDER BY code');
    });
    // Fallback owner only: with Mizan installed these are Mizan's to create.
    http.post('/api/items', async (req) => {
      require(req, 'mdm.items.write');
      if (ctx.config.ownership.item !== 'gmes') {
        conflict('mdm.not_owner', 'Items are owned by accounting (Mizan) in this installation: create the item there and it will appear here');
      }
      const input = zLocalItem.parse(req.body);
      return ctx.db.tx(async (t) => {
        if (await t.get('SELECT 1 FROM mdm_item WHERE code = ?', [input.code])) conflict('item.code_taken', `item code ${input.code} exists`);
        const id = ctx.clock.newId();
        await t.run(
          `INSERT INTO mdm_item (id, code, name_en, name_ar, kind, stock_tracked, tracking, base_uom, active, version, owner, origin_app, origin_key, mirrored_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'gmes', 'gmes', ?, ?)`,
          [id, input.code, input.nameEn, input.nameAr, input.kind, input.kind === 'product' ? 1 : 0, input.tracking, input.baseUom, id, ctx.clock.now().toISOString()],
        );
        return { id };
      });
    });
    http.post('/api/warehouses', async (req) => {
      require(req, 'mdm.items.write');
      if (ctx.config.ownership.warehouse !== 'gmes') conflict('mdm.not_owner', 'Warehouses are owned by accounting (Mizan) in this installation');
      const input = zLocalWarehouse.parse(req.body);
      const id = ctx.clock.newId();
      await ctx.db.run(
        `INSERT INTO mdm_warehouse (id, code, name_en, name_ar, active, is_default, version, owner, origin_app, origin_key, mirrored_at)
         VALUES (?, ?, ?, ?, 1, 0, 1, 'gmes', 'gmes', ?, ?)`,
        [id, input.code, input.nameEn, input.nameAr, id, ctx.clock.now().toISOString()],
      );
      return { id };
    });
  },

  async health(ctx) {
    const foreign = await ctx.db.get<{ n: number }>(
      `SELECT (SELECT COUNT(*) FROM mdm_item WHERE owner <> ?) + (SELECT COUNT(*) FROM mdm_warehouse WHERE owner <> ?) n`,
      [ctx.config.ownership.item, ctx.config.ownership.warehouse],
    );
    // Rows owned by someone other than the configured owner mean an ownership change skipped the adoption wizard.
    return [{ id: 'ownership', ok: foreign!.n === 0, details: { rowsWithAnotherOwner: foreign!.n } }];
  },
};

async function apply(ctx: Ctx, t: Db, kind: 'item' | 'warehouse', s: ItemV1 | WarehouseV1): Promise<SnapshotResult> {
  const owner = kind === 'item' ? ctx.config.ownership.item : ctx.config.ownership.warehouse;
  if (owner === 'gmes') fail('mdm.not_mirror', `${kind}s are owned by manufacturing here; snapshots from ${s.origin.app} are refused (use the adoption wizard)`);
  if (s.origin.app !== owner) fail('mdm.wrong_owner', `${kind} snapshot from ${s.origin.app}, but the owner is ${owner}`);
  const table = kind === 'item' ? 'mdm_item' : 'mdm_warehouse';
  const cur = await t.get<{ version: number; owner: string }>(`SELECT version, owner FROM ${table} WHERE id = ?`, [s.id]);
  if (cur && cur.owner !== owner) fail('mdm.not_mirror', `${kind} ${s.code} is owned locally`);
  if (cur && cur.version >= s.version) return cur.version === s.version ? 'unchanged' : 'stale';
  const now = ctx.clock.now().toISOString();
  if (kind === 'item') {
    const i = s as ItemV1;
    await t.run(
      `INSERT INTO mdm_item (id, code, name_en, name_ar, kind, stock_tracked, tracking, base_uom, active, version, owner, origin_app, origin_key, mirrored_at)
       VALUES (:id, :code, :en, :ar, :kind, :st, :tr, :uom, :active, :v, :owner, :oapp, :okey, :now)
       ON CONFLICT(id) DO UPDATE SET code = :code, name_en = :en, name_ar = :ar, kind = :kind, stock_tracked = :st, tracking = :tr,
         base_uom = :uom, active = :active, version = :v, mirrored_at = :now`,
      { id: i.id, code: i.code, en: i.name.en, ar: i.name.ar, kind: i.kind, st: i.stock_tracked ? 1 : 0, tr: i.tracking, uom: i.base_uom,
        active: i.active ? 1 : 0, v: i.version, owner, oapp: i.origin.app, okey: i.origin.key, now },
    );
  } else {
    const w = s as WarehouseV1;
    await t.run(
      `INSERT INTO mdm_warehouse (id, code, name_en, name_ar, active, is_default, version, owner, origin_app, origin_key, mirrored_at)
       VALUES (:id, :code, :en, :ar, :active, :def, :v, :owner, :oapp, :okey, :now)
       ON CONFLICT(id) DO UPDATE SET code = :code, name_en = :en, name_ar = :ar, active = :active, is_default = :def, version = :v, mirrored_at = :now`,
      { id: w.id, code: w.code, en: w.name.en, ar: w.name.ar, active: w.active ? 1 : 0, def: w.is_default ? 1 : 0, v: w.version, owner,
        oapp: w.origin.app, okey: w.origin.key, now },
    );
  }
  return 'applied';
}
