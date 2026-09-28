import { z } from 'zod';
import type { PlantNode } from '../../contracts/services.js';
import type { Db } from '../../kernel/db.js';
import { conflict, fail, notFound } from '../../kernel/errors.js';
import type { Ctx, RouteKit } from '../../kernel/modules.js';

/**
 * The plant model: plant -> area -> line -> station -> equipment. Manufacturing owns it (docs/ecosystem/02).
 * A code never changes once created (the ledger, the requirements and the boards refer to it); a node is
 * deactivated, never deleted, and only after everything under it is inactive.
 */
const PARENT: Record<PlantNode['type'], PlantNode['type'] | null> = { plant: null, area: 'plant', line: 'area', station: 'line', equipment: 'station' };
const TYPES = ['plant', 'area', 'line', 'station', 'equipment'] as const;

export const plantMigration = {
  id: '004_plant_model',
  up: `
    CREATE TABLE mdm_plant_node (
      id                 TEXT PRIMARY KEY,
      code               TEXT NOT NULL UNIQUE,
      type               TEXT NOT NULL CHECK (type IN ('plant', 'area', 'line', 'station', 'equipment')),
      parent_id          TEXT REFERENCES mdm_plant_node(id),
      name_en            TEXT NOT NULL,
      name_ar            TEXT NOT NULL,
      active             INTEGER NOT NULL DEFAULT 1,
      capacity_per_shift INTEGER CHECK (capacity_per_shift IS NULL OR capacity_per_shift > 0),
      serial             TEXT,
      vendor             TEXT,
      installed_on       TEXT,
      version            INTEGER NOT NULL DEFAULT 1,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL
    );
    CREATE INDEX mdm_plant_parent ON mdm_plant_node(parent_id);
  `,
};

const zCode = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{0,39}$/, 'code: letters, digits, dash or underscore (up to 40)');
const zDetails = {
  nameEn: z.string().trim().min(1).max(120),
  nameAr: z.string().trim().max(120).optional(),
  capacityPerShift: z.number().int().positive().max(10_000_000).nullable().optional(),
  serial: z.string().trim().max(60).nullable().optional(),
  vendor: z.string().trim().max(80).nullable().optional(),
  installedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
};

export const plantNode = async (db: Db, code: string) => db.get<PlantNode>('SELECT * FROM mdm_plant_node WHERE code = ?', [code]);
export const plantNodes = async (db: Db, type: PlantNode['type']) => db.all<PlantNode>('SELECT * FROM mdm_plant_node WHERE type = ? ORDER BY code', [type]);

export function plantRoutes({ http, require }: RouteKit, ctx: Ctx) {
  http.get('/api/plant', async (req) => {
    require(req, 'mdm.plant.read');
    return ctx.db.all('SELECT id, code, type, parent_id, name_en, name_ar, active, capacity_per_shift, serial, vendor, installed_on, version FROM mdm_plant_node ORDER BY code');
  });

  http.post('/api/plant', async (req) => {
    require(req, 'mdm.plant.write');
    const input = z.object({ code: zCode, type: z.enum(TYPES), parentId: z.string().nullable().optional(), ...zDetails }).parse(req.body);
    return ctx.db.tx(async (t) => {
      if (await t.get('SELECT 1 FROM mdm_plant_node WHERE code = ?', [input.code])) conflict('plant.code_taken', `code ${input.code} is already used`);
      const want = PARENT[input.type];
      if (want === null && input.parentId) fail('plant.parent', 'a plant has no parent');
      if (want !== null) {
        if (!input.parentId) fail('plant.parent', `a ${input.type} belongs to a ${want}`);
        const parent = (await t.get<PlantNode>('SELECT * FROM mdm_plant_node WHERE id = ?', [input.parentId!])) ?? notFound('plant_node', input.parentId!);
        if (parent.type !== want) fail('plant.parent', `a ${input.type} belongs to a ${want}, not to a ${parent.type}`);
        if (!parent.active) conflict('plant.parent_inactive', `${parent.code} is inactive`);
      }
      const id = ctx.clock.newId();
      const now = ctx.clock.now().toISOString();
      await t.run(
        `INSERT INTO mdm_plant_node (id, code, type, parent_id, name_en, name_ar, capacity_per_shift, serial, vendor, installed_on, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, input.code, input.type, input.parentId ?? null, input.nameEn, input.nameAr || input.nameEn, input.capacityPerShift ?? null,
          input.serial ?? null, input.vendor ?? null, input.installedOn ?? null, now, now],
      );
      return { id, code: input.code };
    });
  });

  http.patch('/api/plant/:id', async (req) => {
    require(req, 'mdm.plant.write');
    const { id } = req.params as { id: string };
    const input = z.object({ ...zDetails, nameEn: zDetails.nameEn.optional(), active: z.boolean().optional(), version: z.number().int().positive() }).parse(req.body);
    return ctx.db.tx(async (t) => {
      const n = (await t.get<PlantNode & { version: number; serial: string | null; vendor: string | null; installed_on: string | null }>('SELECT * FROM mdm_plant_node WHERE id = ?', [id])) ?? notFound('plant_node', id);
      if (n.version !== input.version) conflict('plant.changed', `${n.code} was changed by someone else meanwhile: reload it`);
      if (input.active === false && n.active) {
        const kids = (await t.get<{ n: number }>('SELECT COUNT(*) n FROM mdm_plant_node WHERE parent_id = ? AND active = 1', [id]))!.n;
        if (kids) conflict('plant.has_active_children', `deactivate the ${kids} active nodes under ${n.code} first`);
      }
      if (input.active === true && !n.active && n.parent_id) {
        const p = (await t.get<PlantNode>('SELECT * FROM mdm_plant_node WHERE id = ?', [n.parent_id]))!;
        if (!p.active) conflict('plant.parent_inactive', `activate ${p.code} first`);
      }
      const pick = <K extends keyof typeof input>(k: K, cur: unknown) => (input[k] === undefined ? cur : input[k]);
      await t.run(
        `UPDATE mdm_plant_node SET name_en = ?, name_ar = ?, active = ?, capacity_per_shift = ?, serial = ?, vendor = ?, installed_on = ?, version = version + 1, updated_at = ? WHERE id = ?`,
        [pick('nameEn', n.name_en) as string, (input.nameAr === undefined ? n.name_ar : input.nameAr || (input.nameEn ?? n.name_en)) as string,
          input.active === undefined ? n.active : input.active ? 1 : 0, pick('capacityPerShift', n.capacity_per_shift) as number | null,
          pick('serial', n.serial) as string | null, pick('vendor', n.vendor) as string | null, pick('installedOn', n.installed_on) as string | null,
          ctx.clock.now().toISOString(), id],
      );
      return { id, version: n.version + 1 };
    });
  });
}
