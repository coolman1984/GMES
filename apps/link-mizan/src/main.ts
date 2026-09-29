/**
 * link-mizan — runs next to Mizan and keeps it in step with manufacturing.
 *
 * Environment: LINK_COMPANY_ID, LINK_MIZAN_URL (http://127.0.0.1:4800), LINK_MIZAN_USER, LINK_MIZAN_PASSWORD,
 * LINK_MES_URL (http://127.0.0.1:4700), LINK_MES_KEY, LINK_WIP_ACCOUNT (1145), LINK_VARIANCE_ACCOUNT (5170),
 * LINK_STATE (./data/link-mizan.db), LINK_INTERVAL_SECONDS (10), LINK_HEARTBEAT (a file rewritten after every cycle;
 * manufacturing's health page reads it).
 * Secrets come from the environment (or the OS secret store in the installer), never from logs or files in git.
 */
import { resolve } from 'node:path';
import { nextHeartbeat, writeHeartbeat, type Heartbeat } from './heartbeat.js';
import { Link } from './link.js';
import { MesClient } from './mes.js';
import { MizanClient } from './mizan.js';
import { LinkState } from './state.js';

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) {
    console.error(`missing ${k}`);
    process.exit(2);
  }
  return v;
};

const link = new Link(
  { companyId: env('LINK_COMPANY_ID'), consumer: 'link-mizan', accounts: { wip: env('LINK_WIP_ACCOUNT', '1145'), variance: env('LINK_VARIANCE_ACCOUNT', '5170') } },
  new MizanClient(env('LINK_MIZAN_URL', 'http://127.0.0.1:4800'), env('LINK_MIZAN_USER'), env('LINK_MIZAN_PASSWORD')),
  new MesClient(env('LINK_MES_URL', 'http://127.0.0.1:4700'), env('LINK_MES_KEY')),
  new LinkState(resolve(env('LINK_STATE', 'data/link-mizan.db'))),
);

const interval = Number(env('LINK_INTERVAL_SECONDS', '10')) * 1000;
const heartbeatFile = process.env.LINK_HEARTBEAT ? resolve(process.env.LINK_HEARTBEAT) : undefined;
let beat: Heartbeat | null = null;
for (;;) {
  let outcome: { error?: string; stoppedBy?: string } = {};
  try {
    const r = await link.runOnce();
    outcome = { stoppedBy: r.stoppedBy };
    if (r.applied || r.parked || r.stoppedBy || r.mirrored.sent) console.log(new Date().toISOString(), JSON.stringify(r));
  } catch (err) {
    outcome = { error: (err as Error).message };
    console.error(new Date().toISOString(), 'link-mizan stopped a cycle:', (err as Error).message);
  }
  if (heartbeatFile) {
    beat = nextHeartbeat(beat, new Date(), outcome);
    try { writeHeartbeat(heartbeatFile, beat); } catch (err) { console.error('link-mizan could not write its heartbeat:', (err as Error).message); }
  }
  await new Promise((r) => setTimeout(r, interval));
}
