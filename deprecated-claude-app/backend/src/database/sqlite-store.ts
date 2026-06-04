import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';

export class SqliteStore {
  private db: DatabaseSync;
  private dbPath: string;

  constructor(dataDir: string = './data') {
    this.dbPath = path.join(dataDir, 'animachat.db');
    this.db = new DatabaseSync(this.dbPath);
  }

  init(): void {
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    const schemaPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    this.db.exec(schema);
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

  close(): void {
    this.db.close();
  }
}

