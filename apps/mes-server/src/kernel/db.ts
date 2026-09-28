import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type SqlValue = string | number | bigint | null | Uint8Array;
export type Params = SqlValue[] | Record<string, SqlValue>;

/**
 * The database port. Every module talks to storage only through this interface.
 *
 * It is asynchronous on purpose even though SQLite answers synchronously: the PostgreSQL
 * adapter (ADR-002, exit gate of phase 1) will be asynchronous, and a synchronous port would
 * force every module to be rewritten on that day.
 *
 * Writes go through `tx()`, which runs ONE transaction at a time (single writer, ADR-003) and
 * starts it with BEGIN IMMEDIATE so it never has to upgrade a read lock into a write lock
 * (the classic cause of "database is locked" even with a busy timeout). Rule for callers: do no
 * outside I/O inside a transaction.
 */
export interface Db {
  get<T = Record<string, unknown>>(sql: string, params?: Params): Promise<T | undefined>;
  all<T = Record<string, unknown>>(sql: string, params?: Params): Promise<T[]>;
  run(sql: string, params?: Params): Promise<{ changes: number; lastId: number }>;
  exec(sql: string): Promise<void>;
}

export interface Database extends Db {
  /** Run `fn` as one write transaction; everything inside commits together or not at all. */
  tx<T>(fn: (t: Db) => Promise<T>): Promise<T>;
  close(): void;
  readonly file: string;
  /** A consistent copy of the committed database into a new file (VACUUM INTO on the reader: writers are not stopped). */
  snapshot(to: string): Promise<void>;
}

class Conn implements Db {
  private cache = new Map<string, StatementSync>();
  constructor(readonly raw: DatabaseSync) {}
  private stmt(sql: string) {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }
  async get<T>(sql: string, params: Params = []) {
    const s = this.stmt(sql);
    return (Array.isArray(params) ? s.get(...params) : s.get(params)) as T | undefined;
  }
  async all<T>(sql: string, params: Params = []) {
    const s = this.stmt(sql);
    return (Array.isArray(params) ? s.all(...params) : s.all(params)) as T[];
  }
  async run(sql: string, params: Params = []) {
    const s = this.stmt(sql);
    const r = Array.isArray(params) ? s.run(...params) : s.run(params);
    return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
  }
  async exec(sql: string) {
    this.raw.exec(sql);
  }
}

function open(file: string, readOnly: boolean): DatabaseSync {
  const raw = new DatabaseSync(file, readOnly ? { readOnly: true } : {});
  raw.exec(`PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;`);
  if (!readOnly) raw.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;`);
  return raw;
}

/**
 * SQLite through node:sqlite: one writer connection, and one reader connection that only ever
 * sees committed data (WAL). A request that reads while a transaction is in flight therefore
 * never observes half of it.
 */
export function openSqlite(file: string): Database {
  if (file === ':memory:') throw new Error('use a file: the reader connection must see what the writer committed');
  mkdirSync(dirname(file), { recursive: true });
  const writer = new Conn(open(file, false));
  const reader = new Conn(open(file, true));
  let queue: Promise<unknown> = Promise.resolve();

  const tx = <T>(fn: (t: Db) => Promise<T>): Promise<T> => {
    const run = async () => {
      writer.raw.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn(writer);
        writer.raw.exec('COMMIT');
        return result;
      } catch (err) {
        writer.raw.exec('ROLLBACK');
        throw err;
      }
    };
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  };

  return {
    file,
    get: (s, p) => reader.get(s, p),
    all: (s, p) => reader.all(s, p),
    run: (s, p) => tx((t) => t.run(s, p)),
    exec: (s) => tx((t) => t.exec(s)),
    tx,
    async snapshot(to: string) {
      reader.raw.prepare('VACUUM INTO ?').run(to);
    },
    close() {
      reader.raw.close();
      writer.raw.close();
    },
  };
}

/** A database file opened read-only, for checking a backup without ever writing to it. */
export function openReadOnly(file: string): Db & { close(): void } {
  const c = new Conn(new DatabaseSync(file, { readOnly: true }));
  return { get: (s, p) => c.get(s, p), all: (s, p) => c.all(s, p), run: () => Promise.reject(new Error('read-only')), exec: () => Promise.reject(new Error('read-only')), close: () => c.raw.close() };
}
