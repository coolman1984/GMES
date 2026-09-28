import { createHash } from 'node:crypto';
import { stable } from './commands.js';
import type { Db } from './db.js';

/**
 * An append-only, hash-chained fact table (the pattern of the production ledger, docs/design/04 §4.4), for modules
 * that keep facts of their own: every row carries SHA-256(previous hash | canonical row), so changing or deleting an
 * old row breaks every hash after it and `verifyChain` names the first row that no longer matches. The table must
 * have `seq INTEGER PRIMARY KEY`, `prev_hash` and `hash` columns and refuse UPDATE/DELETE by trigger.
 */
export const GENESIS = '0'.repeat(64);

export const chainHash = (prev: string, fields: readonly string[], row: Record<string, unknown>) =>
  createHash('sha256').update(prev + '|' + stable(Object.fromEntries(fields.map((f) => [f, row[f] ?? null])))).digest('hex');

/** Appends one row (inside the caller's transaction) and returns its sequence number. */
export async function chainAppend(t: Db, table: string, fields: readonly string[], row: Record<string, unknown>): Promise<number> {
  const last = await t.get<{ seq: number; hash: string }>(`SELECT seq, hash FROM ${table} ORDER BY seq DESC LIMIT 1`);
  const seq = (last?.seq ?? 0) + 1;
  const prev = last?.hash ?? GENESIS;
  const full = { ...row, seq };
  const cols = [...fields, 'prev_hash', 'hash'];
  await t.run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    [...fields.map((f) => (full[f as keyof typeof full] ?? null) as string | number | null), prev, chainHash(prev, fields, full)]);
  return seq;
}

export interface ChainCheck { ok: boolean; rows: number; firstBadSeq: number | null; lastHash: string }

export async function verifyChain(db: Db, table: string, fields: readonly string[]): Promise<ChainCheck> {
  const rows = await db.all<Record<string, unknown> & { seq: number; prev_hash: string; hash: string }>(`SELECT * FROM ${table} ORDER BY seq`);
  let prev = GENESIS;
  let expect = 1;
  for (const r of rows) {
    if (r.seq !== expect || r.prev_hash !== prev || chainHash(prev, fields, r) !== r.hash) return { ok: false, rows: rows.length, firstBadSeq: r.seq, lastHash: prev };
    prev = r.hash;
    expect++;
  }
  return { ok: true, rows: rows.length, firstBadSeq: null, lastHash: prev };
}
