import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';

export class SqliteStore {
  private db!: DatabaseSync;
  private dbPath: string;
  private walTimer: ReturnType<typeof setInterval> | null = null;

  constructor(dataDir: string = './data') {
    this.dbPath = path.join(dataDir, 'animachat.db');
  }

  /** Open the database and apply the schema. Must be called before any operations. */
  init(): void {
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath);

    const schemaPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    this.db.exec(schema);

    // Periodic WAL checkpoint — keeps the WAL file from growing unbounded.
    // CHECKPOINT PASSIVE is non-blocking; TRUNCATE runs every 5th tick to
    // actually shrink the file.
    let ticks = 0;
    this.walTimer = setInterval(() => {
      try {
        ticks++;
        this.db.exec(ticks % 5 === 0 ? 'PRAGMA wal_checkpoint(TRUNCATE)' : 'PRAGMA wal_checkpoint(PASSIVE)');
      } catch { /* DB may be closed */ }
    }, 60_000);
    if (this.walTimer.unref) this.walTimer.unref();
  }

  // Raw access
  exec(sql: string, ...params: any[]): void {
    const stmt = this.db.prepare(sql);
    stmt.run(...params);
  }

  get<T = Record<string, any>>(sql: string, ...params: any[]): T | undefined {
    const stmt = this.db.prepare(sql);
    return stmt.get(...params) as T | undefined;
  }

  all<T = Record<string, any>>(sql: string, ...params: any[]): T[] {
    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as T[];
  }

  run(sql: string, ...params: any[]): { changes: number } {
    const stmt = this.db.prepare(sql);
    const result = stmt.run(...params);
    return { changes: result.changes as number };
  }

  /** Execute fn inside a single SQLite transaction. */
  transaction<T>(fn: () => T): T {
    this.exec('BEGIN');
    try {
      const result = fn();
      this.exec('COMMIT');
      return result;
    } catch (e) {
      this.exec('ROLLBACK');
      throw e;
    }
  }

  /** Force an immediate WAL checkpoint (useful before close). */
  checkpoint(): void {
    try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
  }

  close(): void {
    if (this.walTimer) { clearInterval(this.walTimer); this.walTimer = null; }
    try { this.checkpoint(); } catch {}
    this.db.close();
  }

  /** Create an in-memory store for testing. */
  static memory(): SqliteStore {
    const store = Object.create(SqliteStore.prototype) as SqliteStore;
    store.dbPath = ':memory:';
    store.walTimer = null;
    return store;
  }
}
