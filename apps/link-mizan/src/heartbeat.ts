import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * The link's pulse: one small file, rewritten after every cycle, that manufacturing's health page reads
 * (it never opens the link's own database). A cycle that threw, or stopped early (Mizan down, network error),
 * is NOT healthy; `lastOkAt` keeps the time of the last cycle that ran to the end.
 */
export interface Heartbeat {
  at: string;
  ok: boolean;
  lastOkAt: string | null;
  note: string;
}

export function nextHeartbeat(prev: Heartbeat | null, now: Date, outcome: { error?: string; stoppedBy?: string }): Heartbeat {
  const problem = outcome.error ?? outcome.stoppedBy;
  const at = now.toISOString();
  return { at, ok: !problem, lastOkAt: problem ? (prev?.lastOkAt ?? null) : at, note: problem ?? 'ok' };
}

/** Written to a temporary file and renamed, so a reader never sees half a file. */
export function writeHeartbeat(file: string, hb: Heartbeat): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(hb));
  renameSync(tmp, file);
}
