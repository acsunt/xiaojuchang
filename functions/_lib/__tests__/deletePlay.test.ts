import { beforeEach, describe, expect, it } from 'vitest';
import { deletePlay } from '../db';
import { CORE_SCHEMA_SQL, createTestD1 } from './test-d1';

const insertPlay = (db: ReturnType<typeof createTestD1>, id: string) => {
  db.sqlite
    .prepare(
      `INSERT INTO plays (id, title, author_name, category, summary, content, status, created_at, updated_at)
       VALUES (?, '标题', '作者', '未分类', '', 'content', 'approved', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    )
    .run(id);
};

const insertReviewLog = (db: ReturnType<typeof createTestD1>, id: string, playId: string) => {
  db.sqlite
    .prepare(
      `INSERT INTO review_logs (id, play_id, action, operator, note, created_at)
       VALUES (?, ?, 'approve', 'admin', '', '2026-01-01T00:00:00.000Z')`,
    )
    .run(id, playId);
};

describe('deletePlay', () => {
  let db: ReturnType<typeof createTestD1>;

  beforeEach(() => {
    db = createTestD1();
    db.sqlite.exec(CORE_SCHEMA_SQL);
  });

  it('删除存在的内容：返回 true，并连带清空它的审核日志', async () => {
    insertPlay(db, 'play_1');
    insertReviewLog(db, 'log_1', 'play_1');
    insertReviewLog(db, 'log_2', 'play_1');

    const result = await deletePlay(db, 'play_1');

    expect(result).toBe(true);
    expect(db.sqlite.prepare('SELECT * FROM plays WHERE id = ?').get('play_1')).toBeFalsy();
    expect(db.sqlite.prepare('SELECT * FROM review_logs WHERE play_id = ?').all('play_1')).toHaveLength(0);
  });

  it('删除不存在的内容时返回 false，不影响其他数据', async () => {
    insertPlay(db, 'play_keep');
    insertReviewLog(db, 'log_keep', 'play_keep');

    const result = await deletePlay(db, 'play_ghost');

    expect(result).toBe(false);
    expect(db.sqlite.prepare('SELECT * FROM plays WHERE id = ?').get('play_keep')).toBeTruthy();
    expect(db.sqlite.prepare('SELECT * FROM review_logs WHERE id = ?').get('log_keep')).toBeTruthy();
  });

  it('删除一篇内容不会影响其他内容及其审核日志', async () => {
    insertPlay(db, 'play_1');
    insertPlay(db, 'play_2');
    insertReviewLog(db, 'log_1', 'play_1');
    insertReviewLog(db, 'log_2', 'play_2');

    await deletePlay(db, 'play_1');

    expect(db.sqlite.prepare('SELECT * FROM plays WHERE id = ?').get('play_2')).toBeTruthy();
    expect(db.sqlite.prepare('SELECT * FROM review_logs WHERE id = ?').get('log_2')).toBeTruthy();
  });
});
