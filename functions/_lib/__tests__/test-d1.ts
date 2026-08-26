// 测试专用：把 db.ts 依赖的 D1Database 接口，适配到 Node 内置的 node:sqlite 上。
// 目的是让单元测试跑在真实的 SQLite 引擎上（包括外键级联删除等行为），
// 而不是用手写的假数据结构去猜测数据库行为。
import { DatabaseSync } from 'node:sqlite';

type SqlValue = string | number | bigint | null | Uint8Array;

class FakeD1PreparedStatement implements D1PreparedStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    private readonly sql: string,
    private readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new FakeD1PreparedStatement(this.sqlite, this.sql, values as SqlValue[]);
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const statement = this.sqlite.prepare(this.sql);
    const row = statement.get(...this.params);
    return (row as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const statement = this.sqlite.prepare(this.sql);
    const rows = statement.all(...this.params);
    return { results: rows as T[], success: true };
  }

  async run(): Promise<D1ExecResult> {
    const statement = this.sqlite.prepare(this.sql);
    const result = statement.run(...this.params);
    return {
      last_row_id: Number(result.lastInsertRowid ?? 0),
      changed_db: true,
    };
  }
}

export const createTestD1 = (): D1Database & { sqlite: DatabaseSync } => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');

  return {
    sqlite,
    prepare(sql: string) {
      return new FakeD1PreparedStatement(sqlite, sql);
    },
    async batch<T = D1ExecResult>(statements: D1PreparedStatement[]): Promise<T[]> {
      // 模拟 D1 的批量原子提交：全部成功才提交，任意一条失败就整体回滚。
      this.sqlite.exec('BEGIN');
      try {
        const results: T[] = [];
        for (const statement of statements) {
          results.push((await statement.run()) as T);
        }
        this.sqlite.exec('COMMIT');
        return results;
      } catch (reason) {
        this.sqlite.exec('ROLLBACK');
        throw reason;
      }
    },
  };
};

// 与 schema.sql 保持一致的核心表结构，测试库按需建表即可，不用整份加载。
export const CORE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS plays (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    author_name TEXT NOT NULL,
    category TEXT NOT NULL,
    summary TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'offline')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    reviewed_at TEXT,
    review_note TEXT
  );

  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS review_logs (
    id TEXT PRIMARY KEY,
    play_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('approve', 'reject', 'offline')),
    operator TEXT NOT NULL,
    note TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (play_id) REFERENCES plays(id) ON DELETE CASCADE
  );
`;
