import { createHash } from 'node:crypto';
import type { Db } from './db.js';
import { conflict, fail } from './errors.js';
import type { Caller, Ctx } from './modules.js';

/**
 * Every change to production state is a named command with a client-made id (idempotency).
 * A scanner on weak Wi-Fi that sends the same scan twice gets the first answer back, and the
 * ledger holds ONE line — the classic source of "85 rows too many" never gets a chance.
 * Reusing an id for a different request is refused, not silently answered.
 */
export async function runCommand<T>(
  ctx: Ctx,
  caller: Caller,
  command: { id: unknown; type: string; request: unknown },
  fn: (t: Db) => Promise<T>,
): Promise<{ replayed: boolean; result: T }> {
  if (typeof command.id !== 'string' || !/^[A-Za-z0-9._:-]{8,100}$/.test(command.id)) {
    fail('command.id_required', 'commandId (8-100 letters, digits or . _ : -) is required so a retry cannot run twice');
  }
  const requestHash = createHash('sha256').update(stable(command.request)).digest('hex');
  return ctx.db.tx(async (t) => {
    const prev = await t.get<{ command_type: string; request_hash: string; result: string }>(
      'SELECT command_type, request_hash, result FROM sys_command WHERE command_id = ?', [command.id as string],
    );
    if (prev) {
      if (prev.command_type !== command.type || prev.request_hash !== requestHash) {
        conflict('command.id_reused', `command id ${command.id} was already used for a different request`);
      }
      return { replayed: true, result: JSON.parse(prev.result) as T };
    }
    const result = await fn(t);
    await t.run('INSERT INTO sys_command (command_id, command_type, request_hash, result, caller, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
      command.id as string, command.type, requestHash, JSON.stringify(result), caller.name, ctx.clock.now().toISOString(),
    ]);
    return { replayed: false, result };
  });
}

/** JSON with sorted keys, so the same request always hashes the same. */
export function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}';
}
