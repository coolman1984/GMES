import type { LayoutSnapshotV1, PlantNodeV1 } from '@eco/contracts';
import type { SnapshotResult } from '../../contracts/services.js';
import type { Db } from '../../kernel/db.js';
import type { Ctx, RouteKit } from '../../kernel/modules.js';

/**
 * Where the plant is on the drawing (plan 20-GMES WP-G8, flow F9). Space Planner owns geometry; manufacturing keeps only
 * the position of the plant nodes a layout is tagged with (`eco_ref.type = plant_node`). Lengths are integers in 0.1 mm as
 * Space Planner sends them; nothing is converted or rounded. A newer revision of the same layout replaces the older one.
 * The other direction: `GET /api/plant/export` gives Space Planner the plant tree as eco.plant_node.v1 records.
 */
export const spatialMigration = {
  id: '006_spatial',
  up: `
    CREATE TABLE mdm_layout (id TEXT PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL, revision INTEGER NOT NULL, version INTEGER NOT NULL, applied_at TEXT NOT NULL);
    CREATE TABLE mdm_spatial_ref (
      node_id      TEXT NOT NULL REFERENCES mdm_plant_node(id),
      layout_id    TEXT NOT NULL REFERENCES mdm_layout(id),
      item_id      TEXT NOT NULL,
      kind         TEXT NOT NULL CHECK (kind IN ('item', 'zone')),
      x            INTEGER NOT NULL,
      y            INTEGER NOT NULL,
      rotation_mdeg INTEGER NOT NULL DEFAULT 0,
      w            INTEGER NOT NULL DEFAULT 0,
      d            INTEGER NOT NULL DEFAULT 0,
      revision     INTEGER NOT NULL,
      PRIMARY KEY (node_id, layout_id, item_id)
    );
    CREATE INDEX mdm_spatial_layout ON mdm_spatial_ref(layout_id);
  `,
};

/** The plant node as the contract carries it. `crew` is planning's figure and is read when the planning module is installed. */
export async function plantNodeRecord(db: Db, company: string, id: string): Promise<PlantNodeV1 | null> {
  const n = await db.get<{ id: string; code: string; type: PlantNodeV1['type']; parent_id: string | null; name_en: string; name_ar: string; active: number; capacity_per_shift: number | null; version: number }>(
    'SELECT id, code, type, parent_id, name_en, name_ar, active, capacity_per_shift, version FROM mdm_plant_node WHERE id = ?', [id]);
  if (!n) return null;
  const parent = n.parent_id ? await db.get<{ id: string; code: string }>('SELECT id, code FROM mdm_plant_node WHERE id = ?', [n.parent_id]) : undefined;
  const crew = await db.get<{ crew: number }>('SELECT crew FROM pln_node_crew WHERE node_code = ?', [n.code]).catch(() => undefined);
  return {
    id: n.id, code: n.code, version: n.version, origin: { app: 'gmes', type: 'plant_node', key: n.code },
    name: { en: n.name_en, ar: n.name_ar }, type: n.type, ...(parent ? { parent } : {}), active: !!n.active,
    ...(n.capacity_per_shift ? { capacity_per_shift: n.capacity_per_shift } : {}), ...(crew ? { crew: crew.crew } : {}),
  } as PlantNodeV1;
}

/** Publishes the node inside the caller's transaction (no change without its event). */
export async function publishPlantNode(ctx: Ctx, t: Db, id: string): Promise<void> {
  if (!ctx.services.has('eco')) return;
  const rec = await plantNodeRecord(t, ctx.config.companyId, id);
  if (!rec) return;
  await ctx.services.get('eco').publish(t, { type: 'eco.plant_node.v1', subject: `plant_node/${id}`, correlation: `plant_node/${id}`, data: rec as unknown as Record<string, unknown> });
}

export async function applyLayoutSnapshot(ctx: Ctx, t: Db, s: LayoutSnapshotV1): Promise<SnapshotResult> {
  const cur = await t.get<{ version: number }>('SELECT version FROM mdm_layout WHERE id = ?', [s.id]);
  if (cur && s.version < cur.version) return 'stale';
  if (cur && s.version === cur.version) return 'unchanged';
  const now = ctx.clock.now().toISOString();
  await t.run(`INSERT INTO mdm_layout (id, code, name, revision, version, applied_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET code = excluded.code, name = excluded.name, revision = excluded.revision, version = excluded.version, applied_at = excluded.applied_at`,
    [s.id, s.code, s.name, s.revision, s.version, now]);
  await t.run('DELETE FROM mdm_spatial_ref WHERE layout_id = ?', [s.id]);
  const known = async (id: string) => !!(await t.get('SELECT 1 FROM mdm_plant_node WHERE id = ?', [id]));
  for (const it of s.items) {
    if (it.eco_ref?.type !== 'plant_node' || !(await known(it.eco_ref.id))) continue;
    await t.run(`INSERT OR REPLACE INTO mdm_spatial_ref (node_id, layout_id, item_id, kind, x, y, rotation_mdeg, w, d, revision) VALUES (?, ?, ?, 'item', ?, ?, ?, ?, ?, ?)`,
      [it.eco_ref.id, s.id, it.item_id, it.x, it.y, it.rotation_mdeg, it.w, it.d, s.revision]);
  }
  for (const z of s.zones) {
    if (z.eco_ref?.type !== 'plant_node' || !(await known(z.eco_ref.id))) continue;
    const xs = z.polygon.map((p) => p[0]), ys = z.polygon.map((p) => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    await t.run(`INSERT OR REPLACE INTO mdm_spatial_ref (node_id, layout_id, item_id, kind, x, y, rotation_mdeg, w, d, revision) VALUES (?, ?, ?, 'zone', ?, ?, 0, ?, ?, ?)`,
      [z.eco_ref.id, s.id, z.id, x, y, Math.max(...xs) - x, Math.max(...ys) - y, s.revision]);
  }
  return 'applied';
}

export function spatialRoutes({ http, require }: RouteKit, ctx: Ctx) {
  // Space Planner's "Fetch from GMES" / file export: the whole tree as eco.plant_node.v1 records
  http.get('/api/plant/export', async (req) => {
    require(req, 'eco.feed.read');
    const ids = await ctx.db.all<{ id: string }>('SELECT id FROM mdm_plant_node ORDER BY code');
    const out: PlantNodeV1[] = [];
    for (const { id } of ids) { const r = await plantNodeRecord(ctx.db, ctx.config.companyId, id); if (r) out.push(r); }
    return { company_id: ctx.config.companyId, nodes: out };
  });

  http.get('/api/plant/spatial', async (req) => {
    require(req, 'mdm.plant.read');
    return ctx.db.all(`SELECT n.code, n.type, s.kind, s.x, s.y, s.rotation_mdeg, s.w, s.d, s.revision, l.name layout, l.applied_at
      FROM mdm_spatial_ref s JOIN mdm_plant_node n ON n.id = s.node_id JOIN mdm_layout l ON l.id = s.layout_id ORDER BY n.code`);
  });
}
