import { beforeEach, describe, expect, it } from 'vitest';
import { restoreBackupPlays } from '../db';
import { CORE_SCHEMA_SQL, createTestD1 } from './test-d1';

const makeDraft = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'play_1',
  title: '标题',
  authorName: '作者',
  category: '现代/日常',
  summary: '简介',
  content: '正文内容',
  status: 'approved',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  reviewedAt: '2026-01-02T00:00:00.000Z',
  reviewNote: '通过',
  ...overrides,
});

describe('restoreBackupPlays', () => {
  let db: ReturnType<typeof createTestD1>;

  beforeEach(() => {
    db = createTestD1();
    db.sqlite.exec(CORE_SCHEMA_SQL);
  });

  it('会清空现有内容和审核日志，再整体导入备份数据', async () => {
    // 先放一条“旧数据”，验证恢复操作会把它清掉。
    db.sqlite
      .prepare(
        `INSERT INTO plays (id, title, author_name, category, summary, content, status, created_at, updated_at)
         VALUES ('old_play', '旧标题', '旧作者', '未分类', '', 'x', 'pending', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')`,
      )
      .run();
    db.sqlite
      .prepare(
        `INSERT INTO review_logs (id, play_id, action, operator, note, created_at)
         VALUES ('log_old', 'old_play', 'approve', 'admin', '', '2025-01-01T00:00:00.000Z')`,
      )
      .run();

    const result = await restoreBackupPlays(db, [makeDraft()] as any);

    expect(result.restoredCount).toBe(1);

    const oldPlay = db.sqlite.prepare('SELECT * FROM plays WHERE id = ?').get('old_play');
    expect(oldPlay).toBeFalsy();

    const oldLog = db.sqlite.prepare('SELECT * FROM review_logs WHERE id = ?').get('log_old');
    expect(oldLog).toBeFalsy();

    const restoredPlay = db.sqlite.prepare('SELECT * FROM plays WHERE id = ?').get('play_1') as any;
    expect(restoredPlay).toBeTruthy();
    expect(restoredPlay.title).toBe('标题');
    expect(restoredPlay.status).toBe('approved');
  });

  it('备份里出现重复 id 时应整体拒绝导入，且不清空现有数据', async () => {
    db.sqlite
      .prepare(
        `INSERT INTO plays (id, title, author_name, category, summary, content, status, created_at, updated_at)
         VALUES ('keep_play', '保留标题', '保留作者', '未分类', '', 'x', 'pending', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')`,
      )
      .run();

    await expect(
      restoreBackupPlays(db, [makeDraft({ id: 'dup' }), makeDraft({ id: 'dup' })] as any),
    ).rejects.toThrow('重复 id');

    // 校验现有的合法数据没有被误删（因为校验在清空数据之前完成）。
    const keepPlay = db.sqlite.prepare('SELECT * FROM plays WHERE id = ?').get('keep_play');
    expect(keepPlay).toBeTruthy();
  });

  it('备份里 id 为空时，会自动生成新 id 而不是拒绝导入', async () => {
    const result = await restoreBackupPlays(db, [makeDraft({ id: '' })] as any);
    expect(result.restoredCount).toBe(1);

    const rows = db.sqlite.prepare('SELECT id FROM plays').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBeTruthy();
  });

  it('标题、署名或正文为空时应整体拒绝导入', async () => {
    await expect(restoreBackupPlays(db, [makeDraft({ title: '' })] as any)).rejects.toThrow(
      '标题、署名或正文为空',
    );
    await expect(restoreBackupPlays(db, [makeDraft({ authorName: '' })] as any)).rejects.toThrow(
      '标题、署名或正文为空',
    );
    await expect(restoreBackupPlays(db, [makeDraft({ content: '   ' })] as any)).rejects.toThrow(
      '标题、署名或正文为空',
    );
  });

  it('pending 状态的内容会自动丢弃 reviewedAt / reviewNote', async () => {
    await restoreBackupPlays(db, [makeDraft({ status: 'pending' })] as any);

    const play = db.sqlite.prepare('SELECT * FROM plays WHERE id = ?').get('play_1') as any;
    expect(play.status).toBe('pending');
    expect(play.reviewed_at).toBeFalsy();
    expect(play.review_note).toBeFalsy();
  });

  it('非法或缺失的时间戳会回退成当前时间，不会导致导入失败', async () => {
    const result = await restoreBackupPlays(
      db,
      [makeDraft({ createdAt: 'not-a-date', updatedAt: '' })] as any,
    );

    expect(result.restoredCount).toBe(1);
    const play = db.sqlite.prepare('SELECT created_at, updated_at FROM plays WHERE id = ?').get('play_1') as any;
    expect(Number.isNaN(Date.parse(play.created_at))).toBe(false);
    expect(Number.isNaN(Date.parse(play.updated_at))).toBe(false);
  });

  it('空数组恢复时会清空现有全部内容，返回 restoredCount 为 0', async () => {
    db.sqlite
      .prepare(
        `INSERT INTO plays (id, title, author_name, category, summary, content, status, created_at, updated_at)
         VALUES ('to_be_cleared', '标题', '作者', '未分类', '', 'x', 'pending', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')`,
      )
      .run();

    const result = await restoreBackupPlays(db, []);

    expect(result.restoredCount).toBe(0);
    const remaining = db.sqlite.prepare('SELECT * FROM plays').all();
    expect(remaining).toHaveLength(0);
  });
});
