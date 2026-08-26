import { beforeEach, describe, expect, it } from 'vitest';
import { deleteRepo } from '../db';
import { CORE_SCHEMA_SQL, createTestD1 } from './test-d1';

const insertPlay = (db: ReturnType<typeof createTestD1>, id: string) => {
  db.sqlite
    .prepare(
      `INSERT INTO plays (id, title, author_name, category, summary, content, status, created_at, updated_at)
       VALUES (?, '标题', '作者', '未分类', '', 'content', 'approved', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    )
    .run(id);
};

// deleteRepo 内部会自建 repo_review_logs 表，但 repos 表本身需要测试提前建好，
// 因为 ensureReposSchema 只在真正被调用时才会执行（deleteRepo 内部会调用它，
// 但测试里的 insertRepo 发生在 deleteRepo 调用之前，所以这里显式建表）。
const REPOS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS repos (
    id TEXT PRIMARY KEY,
    play_id TEXT NOT NULL,
    parent_id TEXT,
    root_id TEXT,
    nickname TEXT NOT NULL,
    visitor_id TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    reviewed_at TEXT,
    review_note TEXT,
    FOREIGN KEY (play_id) REFERENCES plays(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES repos(id) ON DELETE CASCADE
  );
`;

describe('deleteRepo', () => {
  let db: ReturnType<typeof createTestD1>;

  beforeEach(() => {
    db = createTestD1();
    db.sqlite.exec(CORE_SCHEMA_SQL);
    db.sqlite.exec(REPOS_TABLE_SQL);
    insertPlay(db, 'play_1');
  });

  const insertRepo = (id: string, playId = 'play_1') => {
    db.sqlite
      .prepare(
        `INSERT INTO repos (id, play_id, parent_id, root_id, nickname, visitor_id, content, status, created_at, updated_at)
         VALUES (?, ?, NULL, NULL, '匿名', 'visitor_1', '内容', 'approved', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
      .run(id, playId);
  };

  it('删除存在的 repo：返回 true，记录真正被删除，并写入一条 delete 审核日志', async () => {
    insertRepo('repo_1');

    const result = await deleteRepo(db, 'repo_1', 'admin');

    expect(result).toBe(true);

    const repo = db.sqlite.prepare('SELECT * FROM repos WHERE id = ?').get('repo_1');
    expect(repo).toBeFalsy();

    const log = db.sqlite.prepare('SELECT * FROM repo_review_logs WHERE repo_id = ?').get('repo_1') as any;
    expect(log).toBeTruthy();
    expect(log.action).toBe('delete');
    expect(log.operator).toBe('admin');
  });

  it('删除不存在的 repo 时返回 false，且不产生审核日志', async () => {
    const result = await deleteRepo(db, 'repo_ghost', 'admin');

    expect(result).toBe(false);

    const logs = db.sqlite.prepare('SELECT * FROM repo_review_logs').all();
    expect(logs).toHaveLength(0);
  });

  it('删除一条 repo 不会影响同一小剧场下的其他 repo', async () => {
    insertRepo('repo_1');
    insertRepo('repo_2');

    await deleteRepo(db, 'repo_1', 'admin');

    const remaining = db.sqlite.prepare('SELECT id FROM repos').all();
    expect(remaining).toEqual([{ id: 'repo_2' }]);
  });
});
