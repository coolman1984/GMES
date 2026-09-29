#!/usr/bin/env node
/**
 * "A green test proves nothing until it has been made to fail" (lesson carried over from the
 * G-MES automation project). Each mutation plants one realistic bug, runs the suite that must
 * catch it, expects it to FAIL, and restores the file in a finally block.
 *
 *   node scripts/mutations.mjs            (needs a Mizan checkout for the link mutations: MIZAN_DIR)
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MUTATIONS = [
  { name: 'commands are no longer idempotent', file: 'apps/mes-server/src/kernel/commands.ts', from: 'if (prev) {', to: 'if (prev && false) {', suite: 'apps/mes-server' },
  { name: 'completion may exceed the open quantity', file: 'apps/mes-server/src/modules/exe/index.ts', from: 'if (qty > room) {', to: 'if (qty > room && false) {', suite: 'apps/mes-server' },
  { name: 'ledger hash ignores the quantity', file: 'apps/mes-server/src/modules/exe/ledger.ts', from: "'warehouse_id', 'qty',", to: "'warehouse_id',", suite: 'apps/mes-server' },
  { name: 'inbox forgets duplicates', file: 'apps/mes-server/src/modules/eco/index.ts', from: "return 'duplicate';", to: "void 0;", suite: 'apps/mes-server' },
  { name: 'canonical JSON writes floats instead of refusing them', file: 'packages/eco-contracts/src/canonical.ts', from: 'if (!Number.isSafeInteger(value)) throw', to: 'if (false) throw', suite: 'packages/eco-contracts' },
  { name: 'journal hash drops the domain separation', file: 'packages/eco-contracts/src/canonical.ts', from: ".update(domain + '\\n' + canonicalJson(line), 'utf8')", to: ".update(canonicalJson(line), 'utf8')", suite: 'packages/eco-contracts' },
  { name: 'the HR person check is skipped', file: 'apps/mes-server/src/modules/mdm/index.ts', from: "if ((ctx.config.ownership.person ?? 'none') !== 'hr' || !ref) return ref;", to: 'if (true) return ref;', suite: 'apps/mes-server' },
  { name: 'employee snapshots accepted from any app', file: 'apps/mes-server/src/modules/mdm/index.ts', from: "if (s.origin.app !== 'hr') fail(", to: "if (false) fail(", suite: 'apps/mes-server' },
  { name: 'link posts without looking for its reference first', file: 'apps/link-mizan/src/link.ts', from: 'if (found) return found;', to: 'void found;', suite: 'apps/link-mizan' },
  { name: 'a parked event no longer holds back its work order', file: 'apps/link-mizan/src/link.ts', from: 'if (held.has(env.ecocorrelation)) {', to: 'if (held.has(env.ecocorrelation) && false) {', suite: 'apps/link-mizan' },
  { name: 'the cost share of a completion ignores scrap', file: 'apps/link-mizan/src/link.ts', from: 'const remaining = planned - completedBefore - scrapped;', to: 'const remaining = planned - completedBefore;', suite: 'apps/link-mizan' },
  { name: 'the station ignores the qualification level', file: 'apps/mes-server/src/modules/mdm/index.ts', from: ': q.level < n.min_level ?', to: ': false ?', suite: 'apps/mes-server' },
  { name: 'an expired qualification still admits a person', file: 'apps/mes-server/src/modules/mdm/index.ts', from: ': q.expires_on && q.expires_on < at.date ?', to: ': false ?', suite: 'apps/mes-server' },
  { name: 'a withdrawn qualification still admits a person', file: 'apps/mes-server/src/modules/mdm/index.ts', from: "const why = !q || !q.active ? 'has no qualification'", to: "const why = !q ? 'has no qualification'", suite: 'apps/mes-server' },
  { name: 'a screen parses text as HTML', file: 'apps/mes-web/screens/exe3010.js', from: 'ui.clear(detailBody, head,', to: 'detailBody.innerHTML = ""; ui.clear(detailBody, head,', suite: 'apps/mes-server' },
  { name: 'the screens allow scripts from anywhere', file: 'apps/mes-server/src/web.ts', from: "script-src 'self'; style-src", to: "script-src 'self' 'unsafe-inline'; style-src", suite: 'apps/mes-server' },
  { name: 'an Arabic text of the screens is missing', file: 'apps/mes-web/i18n/ar.json', from: '"cancel": "إلغاء",\n', to: '', suite: 'apps/mes-server' },
  { name: 'a screen goes back to invented data', file: 'apps/mes-web/screens/home.js', from: 'import * as ui from "/eco-ui/eco-ui.js";', to: 'import * as ui from "/eco-ui/eco-ui.js";\nimport { lines } from "../data.js";', suite: 'apps/mes-server' },
  { name: 'a locked account can still sign in', file: 'apps/mes-server/src/modules/system/users.ts', from: "if (u.status === 'locked') throw", to: "if (false) throw", suite: 'apps/mes-server' },
  { name: 'the failed-password count is rolled back with the refusal', file: 'apps/mes-server/src/modules/system/users.ts', from: '        return lock;\n      });', to: '        if (!lock) wrong();\n        return lock;\n      });', suite: 'apps/mes-server' },
  { name: 'an operator is given every permission', file: 'apps/mes-server/src/modules/system/roles.ts', from: "OPERATOR: [...READ, 'exe.orders.write', 'oee.stops.write', 'trk.units.write', 'trk.materials.write', 'shp.pack', 'shp.load', 'rpt.notes.write', 'lbl.print'],", to: "OPERATOR: ['*'],", suite: 'apps/mes-server' },
  { name: 'a line may be stopped twice at the same time', file: 'apps/mes-server/src/modules/oee/index.ts', from: 'if (same) conflict(', to: 'if (false) conflict(', suite: 'apps/mes-server' },
  { name: 'a work order may run on a line that does not exist', file: 'apps/mes-server/src/modules/exe/index.ts', from: "if (!line || line.type !== 'line') fail('line.unknown'", to: "if (false) fail('line.unknown'", suite: 'apps/mes-server' },
  { name: 'the ledger forgets the station', file: 'apps/mes-server/src/modules/exe/index.ts', from: 'station_code: input.station ?? null,', to: 'station_code: null,', suite: 'apps/mes-server' },
  { name: 'the published fact forgets the station', file: 'apps/mes-server/src/modules/exe/index.ts', from: "...(input.station ? { station: input.station } : {}),", to: '', suite: 'apps/mes-server' },
  { name: 'a later ledger field changes the hash of older lines', file: 'apps/mes-server/src/modules/exe/ledger.ts', from: '...LATER_FIELDS.filter((f) => row[f] != null).map((f) => [f, row[f]]),', to: '...LATER_FIELDS.map((f) => [f, row[f] ?? null]),', suite: 'apps/mes-server' },
  { name: 'a screen hears "activated" twice when it opens', file: 'packages/eco-ui/src/eco-ui.js', from: 'if (e && e.ready && e.inst.onActivate)', to: 'if (e && e.inst && e.inst.onActivate)', suite: 'apps/mes-server' },
  { name: 'transient failures advance the cursor', file: 'apps/link-mizan/src/link.ts', from: 'if (!(err instanceof BusinessError)) throw err;', to: 'if (!(err instanceof BusinessError) && !(err instanceof TransientError)) throw err;', suite: 'apps/link-mizan' },
  { name: 'a unit may skip a required operation', file: 'apps/mes-server/src/modules/trk/flow.ts', from: "if (must) conflict('unit.wrong_step'", to: "if (false) conflict('unit.wrong_step'", suite: 'apps/mes-server' },
  { name: 'a held unit still moves', file: 'apps/mes-server/src/modules/trk/flow.ts', from: "if (u.held > 0) conflict('unit.held', `${u.serial} is on quality hold: it moves nowhere", to: "if (false) conflict('unit.held', `${u.serial} is on quality hold: it moves nowhere", suite: 'apps/mes-server' },
  { name: 'a unit in repair skips its repair', file: 'apps/mes-server/src/modules/trk/flow.ts', from: "if (u.status === 'repair') conflict('unit.in_repair'", to: "if (false) conflict('unit.in_repair'", suite: 'apps/mes-server' },
  { name: 'more units are started than the order plans', file: 'apps/mes-server/src/modules/trk/flow.ts', from: 'if ((n + 1) * 1000 > wo.planned_qty)', to: 'if (false)', suite: 'apps/mes-server' },
  { name: 'a key part still in production can be fitted', file: 'apps/mes-server/src/modules/trk/flow.ts', from: "if (child.status !== 'completed') conflict('part.not_available'", to: "if (false) conflict('part.not_available'", suite: 'apps/mes-server' },
  { name: 'backflushed material is counted in thousands of thousandths', file: 'apps/mes-server/src/modules/trk/flow.ts', from: 'const due = units * l.qty_per - done;', to: 'const due = Math.round((units * l.qty_per) / 1000) - done;', suite: 'apps/mes-server' },
  { name: 'the final unit is booked before its material', file: 'apps/mes-server/src/modules/trk/flow.ts', from: "if (wo.completed_qty + wo.scrapped_qty + 1000 === wo.planned_qty) await flushOrder(ctx, t, caller, wo.id, base);\n  const booked = await ctx.services.get('exe').scrap(", to: "const booked = await ctx.services.get('exe').scrap(", suite: 'apps/mes-server' },
  { name: 'the unit history hash ignores the station', file: 'apps/mes-server/src/modules/trk/store.ts', from: "'line_code', 'station', 'op_seq',", to: "'line_code', 'op_seq',", suite: 'apps/mes-server' },
  { name: 'an approved routing can be edited', file: 'apps/mes-server/src/modules/eng/index.ts', from: "if (r.status !== 'draft') conflict('routing.frozen', `revision ${r.revision} is ${r.status}: make a new revision to change it`);", to: '', suite: 'apps/mes-server' },
  { name: 'a routed serial order can be completed by quantity', file: 'apps/mes-server/src/modules/exe/index.ts', from: "if (wo.routing_id && ctx.services.has('trk')", to: "if (false && wo.routing_id && ctx.services.has('trk')", suite: 'apps/mes-server' },
  { name: 'the AQL acceptance number is one too many', file: 'apps/mes-server/src/modules/qms/aql.ts', from: 'const accept = AC[l + a]!;', to: 'const accept = AC[l + a]! + 1;', suite: 'apps/mes-server' },
  { name: 'a failed outgoing inspection does not hold the lot', file: 'apps/mes-server/src/modules/qms/index.ts', from: "if (result === 'fail' && stage === 'oqc'", to: "if (false && result === 'fail' && stage === 'oqc'", suite: 'apps/mes-server' },
  { name: 'a hold is released without a signature', file: 'apps/mes-server/src/modules/qms/index.ts', from: 'const signer = await sys().sign(caller, input.password);', to: 'const signer = { login: caller.name, name: caller.name };', suite: 'apps/mes-server' },
  { name: 'a wrong password still signs', file: 'apps/mes-server/src/modules/system/users.ts', from: "if (!(await checkPassword(password ?? '', u!.password_hash))) {", to: 'if (false) {', suite: 'apps/mes-server' },
  { name: 'finished units are scrapped by a hold decision', file: 'apps/mes-server/src/modules/qms/index.ts', from: "if (finished.length) conflict('hold.finished_units'", to: "if (false) conflict('hold.finished_units'", suite: 'apps/mes-server' },
  { name: 'measurements outside their limits pass', file: 'apps/mes-server/src/modules/qms/index.ts', from: 'ok: (lo === null || v >= lo) && (hi === null || v <= hi) });', to: 'ok: true });', suite: 'apps/mes-server' },
  { name: 'a defect code outside the plant list is accepted', file: 'apps/mes-server/src/modules/qms/index.ts', from: "if (!d) fail('defect.unknown'", to: "if (false) fail('defect.unknown'", suite: 'apps/mes-server' },
  { name: 'a replaced part stays in the genealogy', file: 'apps/mes-server/src/modules/trk/flow.ts', from: "await t.run('UPDATE trk_genealogy SET removed_seq = ? WHERE rowid = ?', [seq, row.rowid]);", to: '', suite: 'apps/mes-server' },
  { name: 'a screen file with a syntax error is served', file: 'apps/mes-web/screens/qms4010.js', from: 'return { el: sc.el };', to: 'return { el: sc.el ;', suite: 'apps/mes-server' },
  { name: 'a pallet without a passed OQC is loaded', file: 'apps/mes-server/src/modules/shp/index.ts', from: "if (r === 'none') conflict('pallet.no_oqc'", to: "if (false) conflict('pallet.no_oqc'", suite: 'apps/mes-server' },
  { name: 'a pallet with held units is loaded', file: 'apps/mes-server/src/modules/shp/index.ts', from: "if (held!.n) conflict('pallet.held'", to: "if (false) conflict('pallet.held'", suite: 'apps/mes-server' },
  { name: 'a container is loaded beyond its capacity', file: 'apps/mes-server/src/modules/shp/index.ts', from: 'if (mine && used + 1 / mine > 1 + 1e-9)', to: 'if (false)', suite: 'apps/mes-server' },
  { name: 'more is loaded than the order asks', file: 'apps/mes-server/src/modules/shp/index.ts', from: 'if (already + p.units > line!.qty)', to: 'if (false)', suite: 'apps/mes-server' },
  { name: 'the container check digit is not checked', file: 'apps/mes-server/src/modules/shp/index.ts', from: "return (sum % 11) % 10 === Number(no[10]);", to: 'return true;', suite: 'apps/mes-server' },
  { name: 'dispatch does not tell accounting', file: 'apps/mes-server/src/modules/shp/index.ts', from: "type: 'mes.shipment.dispatched.v1', subject:", to: "type: 'mes.shipment.dispatched.v0', subject:", suite: 'apps/mes-server' },
  { name: 'an open pallet is loaded', file: 'apps/mes-server/src/modules/shp/index.ts', from: "if (p.status === 'open') conflict('pallet.open'", to: "if (false) conflict('pallet.open'", suite: 'apps/mes-server' },
  { name: 'overlapping stoppages are counted twice in OEE', file: 'apps/mes-server/src/modules/oee/calc.ts', from: 'downtime += (length(union(unplanned))', to: 'downtime += (length(unplanned)', suite: 'apps/mes-server' },
  { name: 'a planned break lowers availability', file: 'apps/mes-server/src/modules/oee/calc.ts', from: '(r?.planned ? planned : unplanned).push([a, b]);', to: 'unplanned.push([a, b]);', suite: 'apps/mes-server' },
  { name: 'a stop reason outside the plant list is accepted', file: 'apps/mes-server/src/modules/oee/index.ts', from: "if (!reason) fail('stop.reason_unknown'", to: "if (false) fail('stop.reason_unknown'", suite: 'apps/mes-server' },
  { name: 'a label is reprinted without a reason', file: 'apps/mes-server/src/modules/lbl/index.ts', from: "if (!input.reason) fail('label.reason_required'", to: "if (false) fail('label.reason_required'", suite: 'apps/mes-server' },
  { name: 'a retried print command prints again', file: 'apps/mes-server/src/modules/lbl/index.ts', from: 'if (!replayed) {', to: 'if (true) {', suite: 'apps/mes-server' },
  { name: 'a ZPL control character reaches the printer', file: 'apps/mes-server/src/modules/lbl/index.ts', from: "if (/[\\^~]/.test(x)) fail('label.unsafe_value'", to: "if (false) fail('label.unsafe_value'", suite: 'apps/mes-server' },
  { name: 'a backup is called good without its rehearsal', file: 'apps/mes-server/src/ops.ts', from: "return { ok: integrity === 'ok' && checks.every((c) => c.ok) && mismatches.length === 0,", to: 'return { ok: true,', suite: 'apps/mes-server' },
  { name: 'a revoked key still works', file: 'apps/mes-server/src/modules/system/index.ts', from: 'if (!row || !row.active ||', to: 'if (!row ||', suite: 'apps/mes-server' },
  { name: 'the Code 128 check character is wrong', file: 'apps/mes-web/barcode.js', from: 'vals.push(sum % 103);', to: 'vals.push(sum % 101);', suite: 'apps/mes-server' },
  { name: 'a handover note can be edited', file: 'apps/mes-server/src/modules/rpt/index.ts', from: "CREATE TRIGGER rpt_note_immutable BEFORE UPDATE ON rpt_note BEGIN SELECT RAISE(ABORT, 'rpt: handover notes are append-only'); END;", to: '', suite: 'apps/mes-server' },
];

let survived = 0;
// MUT_ONLY=<text> runs only the planted bugs whose name contains the text (while writing a test); the full run is the gate
const only = (process.env.MUT_ONLY || '').toLowerCase();
for (const m of MUTATIONS.filter((x) => !only || x.name.toLowerCase().includes(only))) {
  const path = join(root, m.file);
  const original = readFileSync(path, 'utf8');
  if (!original.includes(m.from)) throw new Error(`mutation "${m.name}": anchor not found in ${m.file}`);
  writeFileSync(path, original.replace(m.from, m.to));
  let failed = false;
  try {
    execSync('npm test', { cwd: join(root, m.suite), stdio: 'ignore', env: { ...process.env, ECO_E2E_REQUIRED: m.suite === 'apps/link-mizan' ? '1' : '' } });
  } catch {
    failed = true;
  } finally {
    writeFileSync(path, original);
  }
  console.log(`${failed ? 'caught  ' : 'SURVIVED'}  ${m.name}`);
  if (!failed) survived++;
}
if (survived) {
  console.error(`${survived} mutation(s) survived: a test is missing.`);
  process.exit(1);
}
console.log('every planted bug was caught');
