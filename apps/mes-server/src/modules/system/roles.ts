/**
 * Roles of the people who sign in to the screens, and the scopes each role grants. A person holds one role; the
 * server checks the scope of every request (the screens only hide what the role cannot do).
 * API keys (links, devices) keep their own scope lists (sys_key).
 */
export const ROLES = ['ADMIN', 'PLANNER', 'SUPERVISOR', 'OPERATOR', 'QUALITY', 'MAINT', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number];

const READ = ['exe.orders.read', 'exe.ledger.read', 'mdm.items.read', 'mdm.plant.read', 'oee.stops.read', 'eng.read', 'trk.units.read', 'qms.read', 'shp.read', 'rpt.read', 'lbl.read', 'pln.read', 'lab.read'];

export const ROLE_SCOPES: Record<Role, readonly string[]> = {
  ADMIN: ['*'],
  PLANNER: [...READ, 'exe.orders.write', 'mdm.items.write', 'mdm.plant.write', 'eng.write', 'eng.approve', 'shp.orders.write', 'lbl.write', 'pln.run', 'pln.plan', 'pln.admin', 'lab.run'],
  SUPERVISOR: [...READ, 'exe.orders.write', 'oee.stops.write', 'oee.reasons.write', 'mdm.stations.write', 'trk.units.write', 'trk.materials.write', 'trk.repair.write', 'qms.inspect', 'qms.hold', 'shp.pack', 'shp.load', 'rpt.notes.write', 'lbl.print', 'lbl.reprint', 'lbl.write'],
  OPERATOR: [...READ, 'exe.orders.write', 'oee.stops.write', 'trk.units.write', 'trk.materials.write', 'shp.pack', 'shp.load', 'rpt.notes.write', 'lbl.print'],
  QUALITY: [...READ, 'trk.repair.write', 'qms.write', 'qms.inspect', 'qms.hold', 'qms.release', 'rpt.notes.write', 'lbl.print', 'lbl.reprint'],
  MAINT: [...READ, 'oee.stops.write', 'trk.repair.write', 'rpt.notes.write'],
  VIEWER: [...READ],
};
