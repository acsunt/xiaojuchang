/**
 * mock-db.repos 业务规则切片。
 *
 * 覆盖 mockDb 中 repo 相关的核心方法：
 *   - getReposByPlayId / getMyRepos / getReceivedRepos
 *   - createRepo（嵌套回复的 rootId 计算）
 *   - getRepoCounts / getRepoNoticeSummary
 *   - reviewRepo / updateRepo / deleteRepo
 *   - deleteRejectedReposByVisitor（按 visitorId 删除全部 rejected）
 */
import { describe, expect, it } from 'vitest';
import { mockDb } from '../data/mock-db';
import type { Play, Repo, RepoDraft } from '../types/play';
import { setupMockStorageTest } from './helpers/mock-storage-test';

setupMockStorageTest();

const PLAY_KEY = 'mini-theater.plays';
const REPO_KEY = 'mini-theater.repos';
const REPO_REVIEW_LOG_KEY = 'mini-theater.repo-review-logs';
const SESSION_KEY = 'mini-theater.admin-session';

const seedRepo = (overrides: Partial<Repo> = {}): Repo => ({
  id: 'r1',
  playId: 'p1',
  nickname: 'alice',
  visitorId: 'v1',
  content: 'content',
  status: 'pending',
  createdAt: '2026-01-02T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  ...overrides,
});

const seedPlay = (id: string): Play => ({
  id,
  title: `t-${id}`,
  authorName: 'bob',
  category: 'c',
  summary: 's',
  content: 'content',
  status: 'approved',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  reviewedAt: '2026-01-01T00:00:00.000Z',
  reviewNote: null,
  submissionType: 'original',
  parentPlayId: null,
});

const seedAdminSession = () => {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      token: 'tok',
      username: 'admin',
      expiresAt: '2099-01-01T00:00:00.000Z',
    }),
  );
};

const setStored = <T>(key: string, value: T) => localStorage.setItem(key, JSON.stringify(value));

const seedDraft = (overrides: Partial<RepoDraft> = {}): RepoDraft => ({
  playId: 'p1',
  nickname: 'alice',
  visitorId: 'v1',
  content: 'content',
  ...overrides,
});

describe('mockDb.repos 业务规则', () => {
  describe('getReposByPlayId', () => {
    it('只返回 approved + 按 createdAt 排序', () => {
      setStored<Repo[]>(REPO_KEY, [
        seedRepo({
          id: 'r-pending',
          playId: 'p1',
          status: 'pending',
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
        seedRepo({
          id: 'r-old',
          playId: 'p1',
          status: 'approved',
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
        seedRepo({
          id: 'r-new',
          playId: 'p1',
          status: 'approved',
          createdAt: '2026-02-01T00:00:00.000Z',
        }),
        seedRepo({ id: 'r-other-play', playId: 'p2', status: 'approved' }),
      ]);

      const asc = mockDb.getReposByPlayId('p1', 'asc');
      expect(asc.map((r) => r.id)).toEqual(['r-old', 'r-new']);

      const desc = mockDb.getReposByPlayId('p1', 'desc');
      expect(desc.map((r) => r.id)).toEqual(['r-new', 'r-old']);
    });
  });

  describe('getMyRepos', () => {
    it('只返回当前 visitor 的（不限状态）+ 按 createdAt 排序', () => {
      setStored<Repo[]>(REPO_KEY, [
        seedRepo({ id: 'a', visitorId: 'v1', createdAt: '2026-02-01T00:00:00.000Z' }),
        seedRepo({ id: 'b', visitorId: 'v2' }),
        seedRepo({
          id: 'c',
          visitorId: 'v1',
          status: 'rejected',
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
      ]);

      const result = mockDb.getMyRepos('v1', 'asc');

      expect(result.map((r) => r.id)).toEqual(['c', 'a']);
    });
  });

  describe('getReceivedRepos', () => {
    it('playId 命中 + 不是自己写 + approved/rejected 状态', () => {
      setStored<Repo[]>(REPO_KEY, [
        seedRepo({ id: 'a', playId: 'p1', visitorId: 'other', status: 'approved' }),
        seedRepo({ id: 'b', playId: 'p1', visitorId: 'v1', status: 'approved' }), // 自己的
        seedRepo({ id: 'c', playId: 'p2', visitorId: 'other', status: 'approved' }), // 不在 playIds 里
        seedRepo({ id: 'd', playId: 'p1', visitorId: 'other', status: 'pending' }), // pending 不算
      ]);

      const result = mockDb.getReceivedRepos(['p1'], 'v1', 'asc');

      expect(result.map((r) => r.id)).toEqual(['a']);
    });
  });

  describe('createRepo', () => {
    it('play 不存在时抛 "小剧场不存在，或尚未通过审核"', () => {
      // 默认 PLAY_KEY 是空的（只读 seed），seed 没有 p1
      expect(() => mockDb.createRepo(seedDraft())).toThrow('小剧场不存在，或尚未通过审核');
    });

    it('play 存在时新建 status=pending 的 repo + 关联 play 标题/作者', () => {
      setStored<Play[]>(PLAY_KEY, [seedPlay('p1')]);

      const created = mockDb.createRepo(seedDraft({ playId: 'p1' }));

      expect(created.status).toBe('pending');
      expect(created.playTitle).toBe('t-p1');
      expect(created.playAuthorName).toBe('bob');
      expect(created.id).toMatch(/^repo_/);
    });

    it('回复时 rootId 继承 parent.rootId（多层嵌套）', () => {
      setStored<Play[]>(PLAY_KEY, [seedPlay('p1')]);
      setStored<Repo[]>(REPO_KEY, [
        seedRepo({ id: 'root', playId: 'p1', status: 'approved' }),
        seedRepo({ id: 'mid', playId: 'p1', status: 'approved', parentId: 'root', rootId: 'root' }),
      ]);

      const reply = mockDb.createRepo(seedDraft({ playId: 'p1', parentId: 'mid' }));

      // 回复的 rootId 应该继承 mid.rootId（即 'root'），不是 mid 本身
      expect(reply.parentId).toBe('mid');
      expect(reply.rootId).toBe('root');
      // 回复对象指向 mid
      expect(reply.replyToNickname).toBe('alice');
    });
  });

  describe('getRepoCounts', () => {
    it('只统计 status=approved + 返回 firstCreatedAt/lastCreatedAt', () => {
      setStored<Repo[]>(REPO_KEY, [
        seedRepo({
          id: 'old',
          playId: 'p1',
          status: 'approved',
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
        seedRepo({
          id: 'new',
          playId: 'p1',
          status: 'approved',
          createdAt: '2026-02-01T00:00:00.000Z',
        }),
        seedRepo({ id: 'pending', playId: 'p1', status: 'pending' }),
      ]);

      const result = mockDb.getRepoCounts(['p1']);

      expect(result[0]).toMatchObject({
        playId: 'p1',
        count: 2,
        firstCreatedAt: '2026-01-01T00:00:00.000Z',
        lastCreatedAt: '2026-02-01T00:00:00.000Z',
      });
    });
  });

  describe('getRepoNoticeSummary', () => {
    it('空输入返回零计数', () => {
      const result = mockDb.getRepoNoticeSummary([], '', '2026-01-01T00:00:00.000Z');

      expect(result).toEqual({ receivedCount: 0, unreadCount: 0 });
    });

    it('已读时间之后的算 unread', () => {
      setStored<Repo[]>(REPO_KEY, [
        seedRepo({
          id: 'a',
          playId: 'p1',
          visitorId: 'other',
          status: 'approved',
          createdAt: '2026-02-01T00:00:00.000Z',
        }),
        seedRepo({
          id: 'b',
          playId: 'p1',
          visitorId: 'other',
          status: 'approved',
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
      ]);

      const result = mockDb.getRepoNoticeSummary(
        ['p1'],
        'v1',
        '2026-01-15T00:00:00.000Z', // a 在这之后，b 在这之前
      );

      expect(result.receivedCount).toBe(2);
      expect(result.unreadCount).toBe(1);
    });
  });

  describe('reviewRepo', () => {
    it('未登录抛 "管理员未登录"', () => {
      setStored<Repo[]>(REPO_KEY, [seedRepo({ id: 'r1' })]);

      expect(() => mockDb.reviewRepo('r1', 'approve', '')).toThrow('管理员未登录');
    });

    it('id 不存在抛 "repo 不存在"', () => {
      seedAdminSession();

      expect(() => mockDb.reviewRepo('missing', 'approve', '')).toThrow('repo 不存在');
    });

    it('approve 改 status=approved + 写 audit log', () => {
      seedAdminSession();
      setStored<Repo[]>(REPO_KEY, [seedRepo({ id: 'r1' })]);

      const reviewed = mockDb.reviewRepo('r1', 'approve', 'lgtm');

      expect(reviewed?.status).toBe('approved');
      expect(reviewed?.reviewNote).toBe('lgtm');

      const logs = JSON.parse(localStorage.getItem(REPO_REVIEW_LOG_KEY) ?? '[]');
      expect(logs[0]).toMatchObject({ repoId: 'r1', action: 'approve', operator: 'admin' });
    });

    it('note 为空时写入 "无备注"', () => {
      seedAdminSession();
      setStored<Repo[]>(REPO_KEY, [seedRepo({ id: 'r1' })]);

      mockDb.reviewRepo('r1', 'approve', '');

      const logs = JSON.parse(localStorage.getItem(REPO_REVIEW_LOG_KEY) ?? '[]');
      expect(logs[0]?.note).toBe('无备注');
    });
  });

  describe('updateRepo', () => {
    it('未登录抛 "管理员未登录"', () => {
      setStored<Repo[]>(REPO_KEY, [seedRepo({ id: 'r1' })]);

      expect(() => mockDb.updateRepo('r1', { content: 'new' })).toThrow('管理员未登录');
    });

    it('content 为空抛 "repo 正文不能为空"', () => {
      seedAdminSession();
      setStored<Repo[]>(REPO_KEY, [seedRepo({ id: 'r1' })]);

      expect(() => mockDb.updateRepo('r1', { content: '   ' })).toThrow('repo 正文不能为空');
    });

    it('正常更新 content + note', () => {
      seedAdminSession();
      setStored<Repo[]>(REPO_KEY, [seedRepo({ id: 'r1', content: 'old' })]);

      const updated = mockDb.updateRepo('r1', { content: '  new  ', note: 'admin edit' });

      expect(updated?.content).toBe('new');
      expect(updated?.reviewNote).toBe('admin edit');
    });

    it('只传 note 不传 content 时 content 保持原状', () => {
      seedAdminSession();
      setStored<Repo[]>(REPO_KEY, [seedRepo({ id: 'r1', content: 'old' })]);

      const updated = mockDb.updateRepo('r1', { note: 'just a note' });

      expect(updated?.content).toBe('old');
      expect(updated?.reviewNote).toBe('just a note');
    });
  });

  describe('deleteRepo', () => {
    it('未登录抛 "管理员未登录"', () => {
      expect(() => mockDb.deleteRepo('r1')).toThrow('管理员未登录');
    });

    it('id 不存在抛 "repo 不存在"', () => {
      seedAdminSession();

      expect(() => mockDb.deleteRepo('missing')).toThrow('repo 不存在');
    });

    it('删除时连带 parentId/rootId 指向它的回复一起删（避免悬挂）', () => {
      seedAdminSession();
      setStored<Repo[]>(REPO_KEY, [
        seedRepo({ id: 'root' }),
        seedRepo({ id: 'reply1', parentId: 'root', rootId: 'root' }),
        seedRepo({ id: 'reply2', parentId: 'reply1', rootId: 'root' }),
        seedRepo({ id: 'unrelated' }),
      ]);

      mockDb.deleteRepo('root');

      const stored = JSON.parse(localStorage.getItem(REPO_KEY) ?? '[]') as Repo[];
      expect(stored.map((r) => r.id)).toEqual(['unrelated']);
    });

    it('删除动作追加到 audit log', () => {
      seedAdminSession();
      setStored<Repo[]>(REPO_KEY, [seedRepo({ id: 'r1' })]);

      mockDb.deleteRepo('r1');

      const logs = JSON.parse(localStorage.getItem(REPO_REVIEW_LOG_KEY) ?? '[]');
      expect(logs[0]).toMatchObject({ repoId: 'r1', action: 'delete' });
    });
  });

  describe('deleteRejectedReposByVisitor', () => {
    it('空 visitorId 返回 0', () => {
      expect(mockDb.deleteRejectedReposByVisitor('')).toBe(0);
    });

    it('只删当前 visitor 的 rejected，不动其他 visitor / 其他状态', () => {
      setStored<Repo[]>(REPO_KEY, [
        seedRepo({ id: 'r1', visitorId: 'v1', status: 'rejected' }),
        seedRepo({ id: 'r2', visitorId: 'v1', status: 'approved' }), // 自己 approved 不删
        seedRepo({ id: 'r3', visitorId: 'v2', status: 'rejected' }), // 不是自己
      ]);

      const count = mockDb.deleteRejectedReposByVisitor('v1');

      expect(count).toBe(1);
      const stored = JSON.parse(localStorage.getItem(REPO_KEY) ?? '[]') as Repo[];
      expect(stored.map((r) => r.id).sort()).toEqual(['r2', 'r3']);
    });
  });
});
