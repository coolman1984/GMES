/**
 * Roles of the people who sign in to the screens, and the scopes each role grants. A person holds one role; the
 * server checks the scope of every request (the screens only hide what the role cannot do).
 * API keys (links, devices) keep their own scope lists (sys_key).
 */
export const ROLES = ['ADMIN', 'PLANNER', 'SUPERVISOR', 'OPERATOR', 'QUALITY', 'MAINT', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number];

const READ = ['exe.orders.read', 'exe.ledger.read', 'mdm.items.read', 'mdm.plant.read', 'oee.stops.read', 'eng.read', 'trk.units.read'];

export const ROLE_SCOPES: Record<Role, readonly string[]> = {
  ADMIN: ['*'],
  PLANNER: [...READ, 'exe.orders.write', 'mdm.items.write', 'mdm.plant.write', 'eng.write', 'eng.approve'],
  SUPERVISOR: [...READ, 'exe.orders.write', 'oee.stops.write', 'mdm.stations.write', 'trk.units.write', 'trk.materials.write', 'trk.repair.write'],
  OPERATOR: [...READ, 'exe.orders.write', 'oee.stops.write', 'trk.units.write', 'trk.materials.write'],
  QUALITY: [...READ, 'trk.repair.write'],
  MAINT: [...READ, 'oee.stops.write', 'trk.repair.write'],
  VIEWER: [...READ],
};
