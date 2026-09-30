/**
 * Manufacturing server.
 *
 *   node src/main.ts                         start (port GMES_PORT, default 4700)
 *   node src/main.ts key add <name> <scopes> create a key; it is printed ONCE and stored only as a hash
 *
 * Configuration (environment): GMES_DATA_DIR (./data), GMES_PORT (4700), GMES_HOST (0.0.0.0),
 * GMES_COMPANY_ID (required: the company's ecosystem id), GMES_NODE (plant-1), GMES_TZ (Africa/Cairo),
 * GMES_DAY_START (07:00), GMES_OWNER (mizan | gmes: who owns items and warehouses),
 * GMES_PERSON_OWNER (hr | none: whether HR-System owns people; default none),
 * GMES_BACKUP_DIR (<data dir>/backups; a second disk is better, ADR-028).
 */
import { resolve } from 'node:path';
import { isUuid } from '@eco/contracts';
import { buildApp } from './app.js';
import { addKey } from './modules/system/index.js';
import { startPusher } from './modules/eco/index.js';
import { startPlanner } from './modules/pln/index.js';
import { startLabour } from './modules/lab/index.js';

const dataDir = resolve(process.env.GMES_DATA_DIR ?? 'data');
const companyId = process.env.GMES_COMPANY_ID ?? '';
if (!isUuid(companyId)) {
  console.error('GMES_COMPANY_ID must be the company ecosystem id (a lower-case UUID).');
  process.exit(2);
}
const owner = process.env.GMES_OWNER === 'gmes' ? 'gmes' : 'mizan';
// People are owned by HR-System when it is connected; 'none' keeps the pre-HR behaviour (and is the rollback switch).
const person = process.env.GMES_PERSON_OWNER === 'hr' ? 'hr' : 'none';
const app = await buildApp({
  dbFile: resolve(dataDir, 'gmes.db'),
  backupDir: resolve(process.env.GMES_BACKUP_DIR ?? resolve(dataDir, 'backups')),
  logger: process.env.GMES_LOG === '1',
  config: {
    companyId,
    node: process.env.GMES_NODE ?? 'plant-1',
    timeZone: process.env.GMES_TZ ?? 'Africa/Cairo',
    productionDayStart: process.env.GMES_DAY_START ?? '07:00',
    ownership: { item: owner, warehouse: owner, person },
  },
});

const [cmd, sub, name, scopes] = process.argv.slice(2);
if (cmd === 'key' && sub === 'add' && name && scopes) {
  const key = await addKey(app.ctx, name, scopes.split(','), process.env.GMES_KEY_VALUE);
  console.log(key);
  await app.close();
} else {
  const port = Number(process.env.GMES_PORT ?? 4700);
  await app.http.listen({ port, host: process.env.GMES_HOST ?? '0.0.0.0' });
  console.log(`gmes listening on ${port}`);
  // manufacturing's events go to the peers configured in /api/eco/peers (HR, accounting)
  const stopPusher = process.env.GMES_PUSH_LOOP === 'off' ? () => undefined : startPusher(app.ctx);
  // planning runs by itself every night (02:00 plant time or the first check after it)
  const stopPlanner = process.env.GMES_PLAN_LOOP === 'off' ? () => undefined : startPlanner(app.ctx);
  // labour facts for HR are closed once a production day is over (26 hours after it starts)
  const stopLabour = process.env.GMES_PLAN_LOOP === 'off' ? () => undefined : startLabour(app.ctx);
  const stop = async () => {
    stopPusher();
    stopPlanner();
    stopLabour();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
