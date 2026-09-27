import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * The link's own small database. It is a CACHE of progress, not a source of truth: every
 * document the link wrote carries the event id as its Mizan reference, so deleting this file
 * and replaying the feed from zero rebuilds it exactly without writing anything twice
 * (tested: "state lost").
 */
export class LinkState {
  readonly db: DatabaseSync;
  constructor(file: string) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS applied (
        event_id TEXT PRIMARY KEY, seq INTEGER NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL,
        target_ref TEXT, value INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS parked (
        event_id TEXT PRIMARY KEY, seq INTEGER NOT NULL, correlation TEXT NOT NULL, envelope TEXT NOT NULL,
        code TEXT NOT NULL, message TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 1, last_try TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS parked_corr ON parked(correlation, seq);
      -- Work-in-progress value per work order, in Mizan minor units (what was issued vs. relieved).
      CREATE TABLE IF NOT EXISTS wip (work_order_id TEXT PRIMARY KEY, consumed INTEGER NOT NULL DEFAULT 0, relieved INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS master (entity_id TEXT PRIMARY KEY, hash TEXT NOT NULL, version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS pending_acks (event_id TEXT PRIMARY KEY, ack TEXT NOT NULL);
    `);
  }

  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  get cursor(): number {
    return Number((this.db.prepare("SELECT value FROM meta WHERE key = 'cursor'").get() as { value: string } | undefined)?.value ?? 0);
  }
  setCursor(seq: number) {
    this.db.prepare("INSERT INTO meta (key, value) VALUES ('cursor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(seq));
  }
  isDone(eventId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM applied WHERE event_id = ?').get(eventId);
  }
  wip(wo: string): { consumed: number; relieved: number } {
    return (this.db.prepare('SELECT consumed, relieved FROM wip WHERE work_order_id = ?').get(wo) as { consumed: number; relieved: number } | undefined) ?? { consumed: 0, relieved: 0 };
  }
  addWip(wo: string, consumed: number, relieved: number) {
    this.db.prepare(
      'INSERT INTO wip (work_order_id, consumed, relieved) VALUES (?, ?, ?) ON CONFLICT(work_order_id) DO UPDATE SET consumed = consumed + excluded.consumed, relieved = relieved + excluded.relieved',
    ).run(wo, consumed, relieved);
  }
  heldCorrelations(): Set<string> {
    return new Set((this.db.prepare('SELECT DISTINCT correlation FROM parked').all() as { correlation: string }[]).map((r) => r.correlation));
  }
  parked(): { event_id: string; seq: number; correlation: string; envelope: string; code: string; attempts: number }[] {
    return this.db.prepare('SELECT * FROM parked ORDER BY seq').all() as any;
  }
  close() {
    this.db.close();
  }
}
