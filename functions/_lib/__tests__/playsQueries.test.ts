// covers plays.ts 里除 bulkReviewPlays / restoreBackupPlays / deletePlay 之外的读写函数：
// createPlay / listAdminPlays / getAdminPlayById / listPublicPlays / getPublicPlayById /
// listSubmissionFeedbackByIds / listReviewLogs / listAllReviewLogs / clearReviewLogs /
// updateAdminPlay / reviewPlay / parsePlayStatus / normalizeImportedSummary。
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearReviewLogs,
  createPlay,
  getAdminPlayById,
  getPublicPlayById,
  listAdminPlays,
  listAllReviewLogs,
  listPublicPlays,
  listReviewLogs,
  listSubmissionFeedbackByIds,
  normalizeImportedSummary,
  parsePlayStatus,
  reviewPlay,
  updateAdminPlay,
} from '../db';
import { CORE_SCHEMA_SQL, createTestD1 } from './test-d1';

const insertPlay = (
  db: ReturnType<typeof createTestD1>,
  overrides: Partial<{
    id: string;
    title: string;
    authorName: string;
    category: string;
    summary: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  }> = {},
) => {
  const id = overrides.id ?? `play_${Math.random().toString(36).slice(2, 8)}`;
  db.sqlite
    .prepare(
      `INSERT INTO plays (id, title, author_name, category, summary, content, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'content', ?, ?, ?)`,
    )
    .run(
      id,
      overrides.title ?? '标题',
      overrides.authorName ?? '作者',
      overrides.category ?? '未分类',
      overrides.summary ?? '',
      overrides.status ?? 'pending',
      overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
      overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
    );
  return id;
};

describe('normalizeImportedSummary', () => {
  it('把占位文案“导入数据”“无简介”归一化为空字符串', () => {
    expect(normalizeImportedSummary('导入数据')).toBe('');
    expect(normalizeImportedSummary('无简介')).toBe('');
    expect(normalizeImportedSummary('  导入数据  ')).toBe('');
  });

  it('其他文案原样保留（trim 后）', () => {
    expect(normalizeImportedSummary('  一句正常简介  ')).toBe('一句正常简介');
  });
});

describe('parsePlayStatus', () => {
  it('合法状态原样返回', () => {
    expect(parsePlayStatus('approved')).toBe('approved');
    expect(parsePlayStatus(' pending ')).toBe('pending');
  });

  it('非法或空值返回 undefined', () => {
    expect(parsePlayStatus('not-a-status')).toBeUndefined();
    expect(parsePlayStatus('')).toBeUndefined();
    expect(parsePlayStatus(undefined)).toBeUndefined();
    expect(parsePlayStatus(null)).toBeUndefined();
  });
});

describe('plays 读写函数', () => {
  let db: ReturnType<typeof createTestD1>;

  beforeEach(() => {
    db = createTestD1();
    db.sqlite.exec(CORE_SCHEMA_SQL);
  });

  it('createPlay 写入后可以按 id 读回，且初始状态为 pending', async () => {
    const play = await createPlay(db, {
      title: '标题',
      authorName: '作者',
      category: '未分类',
      summary: '简介',
      content: '正文',
    });

    expect(play.status).toBe('pending');
    expect(play.title).toBe('标题');

    const found = await getAdminPlayById(db, play.id);
    expect(found?.id).toBe(play.id);
  });

  it('listPublicPlays 只返回 approved 状态的内容', async () => {
    insertPlay(db, { status: 'approved', title: '已通过' });
    insertPlay(db, { status: 'pending', title: '待审核' });
    insertPlay(db, { status: 'rejected', title: '已拒绝' });

    const list = await listPublicPlays(db);
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('已通过');
  });

  it('getPublicPlayById 对非 approved 状态返回 null', async () => {
    const pendingId = insertPlay(db, { status: 'pending' });
    const approvedId = insertPlay(db, { status: 'approved' });

    expect(await getPublicPlayById(db, pendingId)).toBeNull();
    expect((await getPublicPlayById(db, approvedId))?.id).toBe(approvedId);
  });

  it('listAdminPlays 按 status 过滤，不传则返回全部', async () => {
    insertPlay(db, { status: 'approved' });
    insertPlay(db, { status: 'pending' });

    expect(await listAdminPlays(db)).toHaveLength(2);
    expect(await listAdminPlays(db, 'approved')).toHaveLength(1);
  });

  it('listSubmissionFeedbackByIds 对已删除的 id 返回 missing 占位', async () => {
    const id1 = insertPlay(db, { status: 'rejected' });

    const result = await listSubmissionFeedbackByIds(db, [id1, 'ghost_id']);
    const byId = new Map(result.map((item) => [item.playId, item]));

    expect(byId.get(id1)?.status).toBe('rejected');
    expect(byId.get('ghost_id')?.status).toBe('missing');
    expect(byId.get('ghost_id')?.reviewNote).toBe('该投稿已被删除');
  });

  it('listSubmissionFeedbackByIds 传空数组直接返回空数组，不查询数据库', async () => {
    expect(await listSubmissionFeedbackByIds(db, [])).toEqual([]);
  });

  it('updateAdminPlay 更新字段并在分类变化时自动创建标签', async () => {
    const id = insertPlay(db, { category: '未分类' });

    const updated = await updateAdminPlay(db, id, {
      title: '新标题',
      category: '悬疑/推理',
    });

    expect(updated?.title).toBe('新标题');
    expect(updated?.category).toBe('悬疑/推理');

    const tag = db.sqlite.prepare('SELECT * FROM tags WHERE name = ?').get('悬疑/推理');
    expect(tag).toBeTruthy();
  });

  it('updateAdminPlay 对标题/署名/正文为空时抛错', async () => {
    const id = insertPlay(db);
    await expect(updateAdminPlay(db, id, { title: '' })).rejects.toThrow('标题不能为空');
    await expect(updateAdminPlay(db, id, { authorName: '' })).rejects.toThrow('署名不能为空');
    await expect(updateAdminPlay(db, id, { content: '   ' })).rejects.toThrow('正文不能为空');
  });

  it('updateAdminPlay 对不存在的 id 返回 null', async () => {
    expect(await updateAdminPlay(db, 'ghost', { title: '新标题' })).toBeNull();
  });

  it('reviewPlay 通过时写入 approved 状态和一条审核日志', async () => {
    const id = insertPlay(db, { category: '现代/日常' });

    const result = await reviewPlay(db, {
      playId: id,
      action: 'approve',
      note: '写得不错',
      operator: 'admin',
    });

    expect(result?.status).toBe('approved');
    expect(result?.reviewNote).toBe('写得不错');

    const logs = await listReviewLogs(db, id);
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('approve');
    expect(logs[0].operator).toBe('admin');
  });

  it('reviewPlay 对不存在的 id 返回 null', async () => {
    expect(
      await reviewPlay(db, { playId: 'ghost', action: 'approve', note: '', operator: 'admin' }),
    ).toBeNull();
  });

  it('clearReviewLogs 清空日志但保留内容本身', async () => {
    const id = insertPlay(db);
    await reviewPlay(db, { playId: id, action: 'reject', note: '不合适', operator: 'admin' });
    expect(await listReviewLogs(db, id)).toHaveLength(1);

    const result = await clearReviewLogs(db, id);
    expect(result).toBe(true);
    expect(await listReviewLogs(db, id)).toHaveLength(0);
    expect(await getAdminPlayById(db, id)).toBeTruthy();
  });

  it('clearReviewLogs 对不存在的 id 返回 false', async () => {
    expect(await clearReviewLogs(db, 'ghost')).toBe(false);
  });

  it('listAllReviewLogs 汇总所有内容的审核日志，并按时间倒序', async () => {
    const id1 = insertPlay(db);
    const id2 = insertPlay(db);
    await reviewPlay(db, { playId: id1, action: 'approve', note: '', operator: 'admin' });
    await reviewPlay(db, { playId: id2, action: 'reject', note: '', operator: 'admin' });

    const logs = await listAllReviewLogs(db);
    expect(logs).toHaveLength(2);
  });
});
