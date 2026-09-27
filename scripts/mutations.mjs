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
  { name: 'the HR person check is skipped', file: 'apps/mes-server/src/modules/mdm/index.ts', from: "if ((ctx.config.ownership.person ?? 'none') !== 'hr' || !ref) return ref;", to: 'if (true) return ref;', suite: 'apps/mes-server' },
  { name: 'employee snapshots accepted from any app', file: 'apps/mes-server/src/modules/mdm/index.ts', from: "if (s.origin.app !== 'hr') fail(", to: "if (false) fail(", suite: 'apps/mes-server' },
  { name: 'link posts without looking for its reference first', file: 'apps/link-mizan/src/link.ts', from: 'if (found) return found;', to: 'void found;', suite: 'apps/link-mizan' },
  { name: 'a parked event no longer holds back its work order', file: 'apps/link-mizan/src/link.ts', from: 'if (held.has(env.ecocorrelation)) {', to: 'if (held.has(env.ecocorrelation) && false) {', suite: 'apps/link-mizan' },
  { name: 'the cost share of a completion ignores scrap', file: 'apps/link-mizan/src/link.ts', from: 'const remaining = planned - completedBefore - scrapped;', to: 'const remaining = planned - completedBefore;', suite: 'apps/link-mizan' },
  { name: 'transient failures advance the cursor', file: 'apps/link-mizan/src/link.ts', from: 'if (!(err instanceof BusinessError)) throw err;', to: 'if (!(err instanceof BusinessError) && !(err instanceof TransientError)) throw err;', suite: 'apps/link-mizan' },
];

let survived = 0;
for (const m of MUTATIONS) {
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
