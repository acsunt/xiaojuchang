import { beforeEach, describe, expect, it } from 'vitest';
import { bulkReviewPlays } from '../db';
import { CORE_SCHEMA_SQL, createTestD1 } from './test-d1';

const insertPlay = (
  db: ReturnType<typeof createTestD1>,
  overrides: Partial<{
    id: string;
    title: string;
    authorName: string;
    category: string;
    status: string;
  }> = {},
) => {
  const id = overrides.id ?? `play_${Math.random().toString(36).slice(2, 8)}`;
  db.sqlite
    .prepare(
      `INSERT INTO plays (id, title, author_name, category, summary, content, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, '', 'content', ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    )
    .run(
      id,
      overrides.title ?? '标题',
      overrides.authorName ?? '作者',
      overrides.category ?? '未分类',
      overrides.status ?? 'pending',
    );
  return id;
};

describe('bulkReviewPlays', () => {
  let db: ReturnType<typeof createTestD1>;

  beforeEach(() => {
    db = createTestD1();
    db.sqlite.exec(CORE_SCHEMA_SQL);
  });

  it('批量通过：把存在的内容状态改为 approved，并各写一条审核日志', async () => {
    const id1 = insertPlay(db, { category: '现代/日常' });
    const id2 = insertPlay(db, { category: '现代/日常' });

    const result = await bulkReviewPlays(db, {
      playIds: [id1, id2],
      action: 'approve',
      note: '内容不错',
      operator: 'admin',
    });

    expect(result.updatedIds.sort()).toEqual([id1, id2].sort());
    expect(result.skippedIds).toEqual([]);
    expect(result.updatedCount).toBe(2);

    const rows = db.sqlite.prepare('SELECT id, status, review_note FROM plays ORDER BY id').all();
    expect(rows.every((row: any) => row.status === 'approved')).toBe(true);
    expect(rows.every((row: any) => row.review_note === '内容不错')).toBe(true);

    const logs = db.sqlite.prepare('SELECT * FROM review_logs').all();
    expect(logs).toHaveLength(2);
    expect(logs.every((log: any) => log.action === 'approve' && log.operator === 'admin')).toBe(
      true,
    );
  });

  it('批量通过时会自动创建审核动作对应的分类标签（首次出现的分类）', async () => {
    const id1 = insertPlay(db, { category: '悬疑/推理' });

    await bulkReviewPlays(db, {
      playIds: [id1],
      action: 'approve',
      note: '',
      operator: 'admin',
    });

    const tag = db.sqlite.prepare('SELECT * FROM tags WHERE name = ?').get('悬疑/推理');
    expect(tag).toBeTruthy();
  });

  it('拒绝或下线操作不需要新建标签', async () => {
    const id1 = insertPlay(db, { category: '悬疑/推理' });

    await bulkReviewPlays(db, {
      playIds: [id1],
      action: 'reject',
      note: '不符合要求',
      operator: 'admin',
    });

    const tag = db.sqlite.prepare('SELECT * FROM tags WHERE name = ?').get('悬疑/推理');
    expect(tag).toBeFalsy();

    const play = db.sqlite
      .prepare('SELECT status, review_note FROM plays WHERE id = ?')
      .get(id1) as any;
    expect(play.status).toBe('rejected');
    expect(play.review_note).toBe('不符合要求');
  });

  it('没有备注时会落一条“无备注”的审核记录', async () => {
    const id1 = insertPlay(db);

    await bulkReviewPlays(db, {
      playIds: [id1],
      action: 'approve',
      note: '',
      operator: 'admin',
    });

    const log = db.sqlite.prepare('SELECT note FROM review_logs WHERE play_id = ?').get(id1) as any;
    expect(log.note).toBe('无备注');
  });

  it('传入不存在的 id 会被跳过，不影响其余合法 id 的处理', async () => {
    const id1 = insertPlay(db);

    const result = await bulkReviewPlays(db, {
      playIds: [id1, 'play_not_exist'],
      action: 'approve',
      note: '',
      operator: 'admin',
    });

    expect(result.updatedIds).toEqual([id1]);
    expect(result.skippedIds).toEqual(['play_not_exist']);
    expect(result.updatedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
  });

  it('传入的 id 全部重复或为空白时会被去重和过滤', async () => {
    const id1 = insertPlay(db);

    const result = await bulkReviewPlays(db, {
      playIds: [id1, id1, '  ', ''],
      action: 'approve',
      note: '',
      operator: 'admin',
    });

    expect(result.updatedIds).toEqual([id1]);
    expect(result.updatedCount).toBe(1);
  });

  it('playIds 为空数组时直接返回空结果，不访问数据库', async () => {
    const result = await bulkReviewPlays(db, {
      playIds: [],
      action: 'approve',
      note: '',
      operator: 'admin',
    });

    expect(result).toEqual({
      action: 'approve',
      updatedIds: [],
      skippedIds: [],
      updatedCount: 0,
      skippedCount: 0,
    });
  });

  it('全部 id 都不存在时返回 updatedCount 为 0，且不产生任何日志', async () => {
    const result = await bulkReviewPlays(db, {
      playIds: ['ghost_1', 'ghost_2'],
      action: 'approve',
      note: '',
      operator: 'admin',
    });

    expect(result.updatedCount).toBe(0);
    expect(result.skippedCount).toBe(2);

    const logs = db.sqlite.prepare('SELECT * FROM review_logs').all();
    expect(logs).toHaveLength(0);
  });
});
