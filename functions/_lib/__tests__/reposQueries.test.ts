// covers repos.ts 里除 deleteRepo 之外的函数：createRepo / listAdminRepos /
// listPublicReposByPlayId / listReposByVisitorId / listReceivedRepos /
// listRepoCountsByPlayIds / getRepoNoticeSummary / reviewRepo /
// deleteRejectedReposByVisitor / listAllRepoAuditLogs / parseRepoStatus。
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createRepo,
  deleteRejectedReposByVisitor,
  getRepoNoticeSummary,
  listAdminRepos,
  listAllRepoAuditLogs,
  listPublicReposByPlayId,
  listReceivedRepos,
  listRepoCountsByPlayIds,
  listReposByVisitorId,
  parseRepoStatus,
  reviewRepo,
} from '../db';
import { CORE_SCHEMA_SQL, createTestD1 } from './test-d1';

const insertPlay = (db: ReturnType<typeof createTestD1>, id: string, title = '标题') => {
  db.sqlite
    .prepare(
      `INSERT INTO plays (id, title, author_name, category, summary, content, status, created_at, updated_at)
       VALUES (?, ?, '作者', '未分类', '', 'content', 'approved', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    )
    .run(id, title);
};

describe('parseRepoStatus', () => {
  it('合法状态原样返回，非法或空值返回 undefined', () => {
    expect(parseRepoStatus('approved')).toBe('approved');
    expect(parseRepoStatus('not-a-status')).toBeUndefined();
    expect(parseRepoStatus('')).toBeUndefined();
    expect(parseRepoStatus(undefined)).toBeUndefined();
  });
});

describe('repos 读写函数', () => {
  let db: ReturnType<typeof createTestD1>;

  beforeEach(() => {
    db = createTestD1();
    db.sqlite.exec(CORE_SCHEMA_SQL);
    insertPlay(db, 'play_1', '第一篇');
    insertPlay(db, 'play_2', '第二篇');
  });

  it('createRepo 写入一条一级评论，parentId / rootId 均为空', async () => {
    const repo = await createRepo(db, {
      playId: 'play_1',
      nickname: '访客甲',
      visitorId: 'visitor_1',
      content: '很喜欢这个故事',
    });

    expect(repo.status).toBe('pending');
    expect(repo.parentId).toBeUndefined();
    expect(repo.rootId).toBeUndefined();
    expect(repo.playTitle).toBe('第一篇');
  });

  it('createRepo 回复已有评论时会继承 rootId', async () => {
    const root = await createRepo(db, {
      playId: 'play_1',
      nickname: '访客甲',
      visitorId: 'visitor_1',
      content: '楼主内容',
    });

    const reply = await createRepo(db, {
      playId: 'play_1',
      parentId: root.id,
      nickname: '访客乙',
      visitorId: 'visitor_2',
      content: '回复内容',
    });

    expect(reply.parentId).toBe(root.id);
    expect(reply.rootId).toBe(root.id);
  });

  it('listPublicReposByPlayId 只返回 approved 状态的评论', async () => {
    const repo = await createRepo(db, {
      playId: 'play_1',
      nickname: '访客甲',
      visitorId: 'visitor_1',
      content: '待审核评论',
    });
    await reviewRepo(db, repo.id, 'approve', '', 'admin');
    await createRepo(db, {
      playId: 'play_1',
      nickname: '访客乙',
      visitorId: 'visitor_2',
      content: '仍待审核',
    });

    const list = await listPublicReposByPlayId(db, 'play_1');
    expect(list).toHaveLength(1);
    expect(list[0].content).toBe('待审核评论');
  });

  it('listAdminRepos 按 status 过滤，不传则返回全部', async () => {
    const repo1 = await createRepo(db, {
      playId: 'play_1',
      nickname: 'a',
      visitorId: 'v1',
      content: 'c1',
    });
    await createRepo(db, { playId: 'play_1', nickname: 'b', visitorId: 'v2', content: 'c2' });
    await reviewRepo(db, repo1.id, 'approve', '', 'admin');

    expect(await listAdminRepos(db)).toHaveLength(2);
    expect(await listAdminRepos(db, 'approved')).toHaveLength(1);
    expect(await listAdminRepos(db, 'pending')).toHaveLength(1);
  });

  it('listReposByVisitorId 只返回该访客发出的评论', async () => {
    await createRepo(db, { playId: 'play_1', nickname: 'a', visitorId: 'visitor_1', content: 'c1' });
    await createRepo(db, { playId: 'play_1', nickname: 'b', visitorId: 'visitor_2', content: 'c2' });

    const list = await listReposByVisitorId(db, 'visitor_1');
    expect(list).toHaveLength(1);
    expect(list[0].content).toBe('c1');
  });

  it('reviewRepo 通过后再驳回，返回最新状态并写入两条审核日志', async () => {
    const repo = await createRepo(db, {
      playId: 'play_1',
      nickname: 'a',
      visitorId: 'v1',
      content: 'c1',
    });

    const approved = await reviewRepo(db, repo.id, 'approve', '不错', 'admin');
    expect(approved?.status).toBe('approved');

    const rejected = await reviewRepo(db, repo.id, 'reject', '改主意了', 'admin');
    expect(rejected?.status).toBe('rejected');

    const logs = await listAllRepoAuditLogs(db);
    expect(logs.filter((log) => log.repoId === repo.id)).toHaveLength(2);
  });

  it('reviewRepo 对不存在的 repo 返回 null', async () => {
    expect(await reviewRepo(db, 'ghost', 'approve', '', 'admin')).toBeNull();
  });

  it('listReceivedRepos 收集“回复我的评论”和“我小剧场下收到的评论”，且排除自己发的', async () => {
    // visitor_1 在 play_1 下发表了一条根评论
    const root = await createRepo(db, {
      playId: 'play_1',
      nickname: '楼主',
      visitorId: 'visitor_1',
      content: '楼主发言',
    });
    await reviewRepo(db, root.id, 'approve', '', 'admin');

    // visitor_2 回复了 visitor_1 的评论
    const reply = await createRepo(db, {
      playId: 'play_1',
      parentId: root.id,
      nickname: '路人',
      visitorId: 'visitor_2',
      content: '回复楼主',
    });
    await reviewRepo(db, reply.id, 'approve', '', 'admin');

    const received = await listReceivedRepos(db, ['play_1'], 'visitor_1');
    expect(received.map((repo) => repo.content)).toContain('回复楼主');
    expect(received.every((repo) => repo.visitorId !== 'visitor_1')).toBe(true);
  });

  it('listRepoCountsByPlayIds 只统计 approved 状态的评论数', async () => {
    const repo1 = await createRepo(db, {
      playId: 'play_1',
      nickname: 'a',
      visitorId: 'v1',
      content: 'c1',
    });
    await createRepo(db, { playId: 'play_1', nickname: 'b', visitorId: 'v2', content: 'c2' });
    await reviewRepo(db, repo1.id, 'approve', '', 'admin');

    const counts = await listRepoCountsByPlayIds(db, ['play_1', 'play_2']);
    const byPlayId = new Map(counts.map((item) => [item.playId, item]));

    expect(byPlayId.get('play_1')?.count).toBe(1);
    expect(byPlayId.get('play_2')?.count).toBe(0);
  });

  it('getRepoNoticeSummary 按 readAt 时间点区分已读未读', async () => {
    const root = await createRepo(db, {
      playId: 'play_1',
      nickname: '楼主',
      visitorId: 'visitor_1',
      content: '楼主发言',
    });
    await reviewRepo(db, root.id, 'approve', '', 'admin');
    const reply = await createRepo(db, {
      playId: 'play_1',
      parentId: root.id,
      nickname: '路人',
      visitorId: 'visitor_2',
      content: '回复楼主',
    });
    await reviewRepo(db, reply.id, 'approve', '', 'admin');

    const summaryAllUnread = await getRepoNoticeSummary(db, ['play_1'], 'visitor_1', '');
    expect(summaryAllUnread.receivedCount).toBe(1);
    expect(summaryAllUnread.unreadCount).toBe(1);

    const future = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    const summaryAllRead = await getRepoNoticeSummary(db, ['play_1'], 'visitor_1', future);
    expect(summaryAllRead.unreadCount).toBe(0);
  });

  it('deleteRejectedReposByVisitor 只删除该访客被拒绝的评论，返回删除数量', async () => {
    const repo1 = await createRepo(db, {
      playId: 'play_1',
      nickname: 'a',
      visitorId: 'visitor_1',
      content: 'c1',
    });
    const repo2 = await createRepo(db, {
      playId: 'play_1',
      nickname: 'a',
      visitorId: 'visitor_1',
      content: 'c2',
    });
    await createRepo(db, { playId: 'play_1', nickname: 'b', visitorId: 'visitor_2', content: 'c3' });
    await reviewRepo(db, repo1.id, 'reject', '', 'admin');
    await reviewRepo(db, repo2.id, 'approve', '', 'admin');

    const deletedCount = await deleteRejectedReposByVisitor(db, 'visitor_1');
    expect(deletedCount).toBe(1);

    expect(await listReposByVisitorId(db, 'visitor_1')).toHaveLength(1);
  });

  it('deleteRejectedReposByVisitor 空 visitorId 直接返回 0', async () => {
    expect(await deleteRejectedReposByVisitor(db, '  ')).toBe(0);
  });
});
