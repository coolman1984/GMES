import { createHash } from 'node:crypto';
import type { Db } from '../../kernel/db.js';
import { stable } from '../../kernel/commands.js';

/**
 * The production ledger: every fact is appended, never updated or deleted (triggers refuse it),
 * and each line carries SHA-256(previous hash | canonical line). Changing any old line breaks
 * every hash after it, and verify() names the first line that no longer matches.
 * Tamper-EVIDENT, not tamper-proof: whoever holds the file can delete it all — that is what
 * backups and the daily anchor are for (docs/design/04-data-model.md §4.4).
 */
export const GENESIS = '0'.repeat(64);

export type TxnType = 'RELEASE' | 'CONSUME' | 'COMPLETE' | 'SCRAP' | 'CLOSE';

export interface TxnInput {
  txn_type: TxnType;
  command_id: string;
  work_order_id: string;
  item_id: string | null;
  warehouse_id: string | null;
  qty: number;
  lot_no: string | null;
  reason_code: string | null;
  user_name: string;
  person_id: string | null;
  production_date: string;
  shift_code: string | null;
  occurred_at: string;
}

const FIELDS = ['seq', 'id', 'txn_type', 'command_id', 'work_order_id', 'item_id', 'warehouse_id', 'qty', 'lot_no', 'reason_code',
  'user_name', 'person_id', 'production_date', 'shift_code', 'occurred_at'] as const;

export const lineHash = (prev: string, row: Record<string, unknown>) =>
  createHash('sha256').update(prev + '|' + stable(Object.fromEntries(FIELDS.map((f) => [f, row[f] ?? null])))).digest('hex');

export async function append(t: Db, id: string, input: TxnInput): Promise<number> {
  const last = await t.get<{ seq: number; hash: string }>('SELECT seq, hash FROM exe_ledger ORDER BY seq DESC LIMIT 1');
  const seq = (last?.seq ?? 0) + 1;
  const prev = last?.hash ?? GENESIS;
  const row = { seq, id, ...input };
  await t.run(
    `INSERT INTO exe_ledger (seq, id, txn_type, command_id, work_order_id, item_id, warehouse_id, qty, lot_no, reason_code, user_name,
       person_id, production_date, shift_code, occurred_at, prev_hash, hash)
     VALUES (:seq, :id, :txn_type, :command_id, :work_order_id, :item_id, :warehouse_id, :qty, :lot_no, :reason_code, :user_name,
       :person_id, :production_date, :shift_code, :occurred_at, :prev_hash, :hash)`,
    { ...row, prev_hash: prev, hash: lineHash(prev, row) },
  );
  return seq;
}

export interface VerifyResult {
  ok: boolean;
  lines: number;
  firstBadSeq: number | null;
  lastHash: string;
}

export async function verify(db: Db): Promise<VerifyResult> {
  const rows = await db.all<Record<string, unknown> & { seq: number; prev_hash: string; hash: string }>('SELECT * FROM exe_ledger ORDER BY seq');
  let prev = GENESIS;
  let expectSeq = 1;
  for (const r of rows) {
    if (r.seq !== expectSeq || r.prev_hash !== prev || lineHash(prev, r) !== r.hash) return { ok: false, lines: rows.length, firstBadSeq: r.seq, lastHash: prev };
    prev = r.hash;
    expectSeq++;
  }
  return { ok: true, lines: rows.length, firstBadSeq: null, lastHash: prev };
}
